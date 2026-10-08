// ============================================================
// Envío de los mensajes de una cita (confirmación, recordatorio y
// acuses) por la puerta de salida, con el cliente service-role.
//
// Es el mismo camino que `automations/meta-send.ts` —puerta, variantes
// de teléfono, mensaje guardado con `sender_type = 'bot'`— con una
// diferencia que justifica no reutilizarlo: el recordatorio necesita
// fijar el payload de cada botón (`buttonParams`), y ese envío no lo
// admite. Tocar el de las automatizaciones para esto arriesgaba un
// camino que funciona.
//
// No lanza: devuelve un resultado descrito, porque el cron decide qué
// hacer con cada motivo (esperar al horario, marcar omitida, fallida).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MessageTemplate } from '@/types';
import { sendTemplateMessage, sendTextMessage } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';
import { isRecipientNotAllowedError, phoneVariants } from '@/lib/whatsapp/phone-utils';
import { templateContentText } from '@/lib/whatsapp/template-body';
import { resolveOutboundTarget, type Initiative } from '@/lib/outbound/gate';

export type AppointmentSend =
  | { kind: 'text'; text: string; initiative: Initiative }
  | {
      kind: 'template';
      template: MessageTemplate;
      body: string[];
      /** Payloads de los botones de respuesta rápida, por índice. */
      buttonParams?: Record<number, string>;
    };

export type SendFailureReason =
  /** Fuera del horario de atención: reintentar más tarde. */
  | 'quiet_hours'
  /** Ventana de 24 h cerrada y no es una plantilla. */
  | 'outside_window'
  /** El canal de la conversación no sabe enviar (hoy: no es WhatsApp). */
  | 'channel_unsupported'
  /** Sin conversación, contacto o destino alcanzable. */
  | 'no_recipient'
  | 'not_configured'
  | 'error';

export type SendOutcome =
  | { ok: true; messageId: string }
  | { ok: false; reason: SendFailureReason; error?: string };

export async function sendAppointmentMessage(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  message: AppointmentSend
): Promise<SendOutcome> {
  const isTemplate = message.kind === 'template';
  const resolution = await resolveOutboundTarget(db, accountId, conversationId, {
    senderKind: 'automated',
    // Una plantilla siempre la manda el sistema por su cuenta; un texto
    // puede ser respuesta (el acuse a un botón) o no.
    initiative: isTemplate ? 'unprompted' : message.initiative,
    isTemplate,
  });
  if (!resolution.ok) {
    switch (resolution.reason) {
      case 'quiet_hours':
        return { ok: false, reason: 'quiet_hours' };
      case 'outside_window':
        return { ok: false, reason: 'outside_window' };
      case 'channel_unsupported':
        return { ok: false, reason: 'channel_unsupported', error: resolution.detail };
      default:
        return { ok: false, reason: 'no_recipient', error: resolution.reason };
    }
  }

  const { data: config } = await db
    .from('whatsapp_config')
    .select('phone_number_id, access_token')
    .eq('account_id', accountId)
    .maybeSingle();
  if (!config) return { ok: false, reason: 'not_configured' };

  try {
    const accessToken = decrypt(config.access_token);
    const attempt = async (to: string): Promise<string> => {
      if (message.kind === 'template') {
        const r = await sendTemplateMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to,
          templateName: message.template.name,
          language: message.template.language,
          template: message.template,
          messageParams: { body: message.body, buttonParams: message.buttonParams },
        });
        return r.messageId;
      }
      const r = await sendTextMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to,
        text: message.text,
      });
      return r.messageId;
    };

    const recipient = resolution.target.recipientId;
    let messageId = '';
    let lastError: unknown = null;
    for (const v of phoneVariants(recipient)) {
      try {
        messageId = await attempt(v);
        lastError = null;
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!isRecipientNotAllowedError(msg)) throw err;
        lastError = err;
      }
    }
    if (lastError) throw lastError;

    const contentText =
      message.kind === 'text'
        ? message.text
        : templateContentText(message.template, message.body);
    const { error: msgErr } = await db.from('messages').insert({
      conversation_id: conversationId,
      sender_type: 'bot',
      content_type: message.kind === 'template' ? 'template' : 'text',
      content_text: contentText,
      template_name: message.kind === 'template' ? message.template.name : null,
      message_id: messageId,
      status: 'sent',
    });
    if (msgErr) {
      // Meta ya lo entregó: el envío cuenta como hecho.
      console.error('[appointments] enviado pero no se guardó el mensaje:', msgErr.message);
    }
    const now = new Date().toISOString();
    await db
      .from('conversations')
      .update({ last_message_text: contentText, last_message_at: now, updated_at: now })
      .eq('id', conversationId);

    return { ok: true, messageId };
  } catch (err) {
    return { ok: false, reason: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}
