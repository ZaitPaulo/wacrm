import type { SupabaseClient } from '@supabase/supabase-js';

import type { MessageChannel } from '@/lib/contacts/channel-identity';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';

// ============================================================
// La puerta de salida: por dónde y a quién sale una respuesta.
//
// EL CANAL SE LEE DE LA CONVERSACIÓN Y NUNCA SE INFIERE NI SE RECIBE
// COMO PARÁMETRO. Ese es el punto entero de este módulo. Contestarle por
// Instagram a quien escribió por WhatsApp —o peor, contestarle a otra
// persona— es el peor fallo posible de todo el multicanal, y la única
// defensa que no depende de que cada camino de envío se acuerde es que
// no exista forma de decirle el canal desde afuera.
//
// Hoy conviven tres caminos de envío (`whatsapp/send-message.ts`,
// `automations/meta-send.ts`, `flows/meta-send.ts`). No se unifican por
// dentro en este cambio —es un refactor propio— pero los tres resuelven
// su destino acá en vez de asumir que el destinatario es un teléfono.
// ============================================================

/** A quién hay que hablarle, en los términos de su canal. */
export interface OutboundTarget {
  channel: MessageChannel;
  /**
   * El identificador de destino: el teléfono saneado en WhatsApp, el
   * identificador de Meta en Instagram y Messenger.
   */
  recipientId: string;
  conversationId: string;
  contactId: string;
}

export type OutboundFailure =
  /** La conversación no existe en esta cuenta. */
  | 'conversation_not_found'
  /** El contacto no tiene identidad en el canal del hilo. */
  | 'no_recipient'
  /** La tiene, pero no sirve para enviar (un teléfono mal formado). */
  | 'invalid_recipient'
  /** El canal existe en la base pero todavía no tiene cómo enviar. */
  | 'channel_unsupported';

export type OutboundResolution =
  | { ok: true; target: OutboundTarget }
  | { ok: false; reason: OutboundFailure; detail?: string };

/** Canales que hoy saben enviar. Instagram y Messenger se suman luego. */
const SENDABLE_CHANNELS: readonly MessageChannel[] = ['whatsapp'];

interface ConversationRow {
  id: string;
  contact_id: string;
  channel: MessageChannel;
}

/**
 * Resuelve el destino de una respuesta a partir de su conversación.
 *
 * Devuelve un resultado descrito en vez de lanzar: cada camino de envío
 * tiene su propia familia de errores —`SendMessageError` en el manual,
 * excepciones planas en los motores— y traduce este resultado a la
 * suya, conservando los mensajes que ya devolvía.
 */
export async function resolveOutboundTarget(
  db: SupabaseClient,
  accountId: string,
  conversationId: string
): Promise<OutboundResolution> {
  const { data: conversation, error } = await db
    .from('conversations')
    .select('id, contact_id, channel')
    .eq('account_id', accountId)
    .eq('id', conversationId)
    .maybeSingle<ConversationRow>();

  if (error) {
    console.error('[outbound] conversation lookup error:', error.message);
    return { ok: false, reason: 'conversation_not_found' };
  }
  if (!conversation) {
    return { ok: false, reason: 'conversation_not_found' };
  }

  // El canal viaja en la fila desde que se creó (migración 513). Las
  // conversaciones anteriores al multicanal quedaron en `whatsapp`.
  const channel = conversation.channel ?? 'whatsapp';

  if (!SENDABLE_CHANNELS.includes(channel)) {
    return {
      ok: false,
      reason: 'channel_unsupported',
      detail: `todavía no se puede enviar por ${channel}`,
    };
  }

  const recipient = await resolveRecipientId(
    db,
    accountId,
    conversation.contact_id,
    channel
  );
  if (!recipient.ok) return recipient;

  return {
    ok: true,
    target: {
      channel,
      recipientId: recipient.recipientId,
      conversationId: conversation.id,
      contactId: conversation.contact_id,
    },
  };
}

/**
 * El identificador de destino del contacto en ese canal.
 *
 * En WhatsApp se toma de `contacts.phone` y no de `contact_channels`: es
 * la columna que los tres caminos de envío ya usaban, la que el
 * formulario y la importación mantienen, y la que puede corregirse a
 * mano cuando un número está mal escrito. La identidad de canal existe
 * para RECONOCER a quien escribe; para escribirle, el teléfono editable
 * sigue siendo la fuente.
 */
async function resolveRecipientId(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  channel: MessageChannel
): Promise<
  { ok: true; recipientId: string } | { ok: false; reason: OutboundFailure }
> {
  if (channel === 'whatsapp') {
    const { data: contact } = await db
      .from('contacts')
      .select('id, phone')
      .eq('account_id', accountId)
      .eq('id', contactId)
      .maybeSingle<{ id: string; phone: string | null }>();

    if (!contact?.phone) return { ok: false, reason: 'no_recipient' };

    const sanitized = sanitizePhoneForMeta(contact.phone);
    if (!isValidE164(sanitized)) {
      return { ok: false, reason: 'invalid_recipient' };
    }
    return { ok: true, recipientId: sanitized };
  }

  const { data: identity } = await db
    .from('contact_channels')
    .select('external_id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('channel', channel)
    .maybeSingle<{ external_id: string }>();

  if (!identity?.external_id) return { ok: false, reason: 'no_recipient' };
  return { ok: true, recipientId: identity.external_id };
}

/** True si ese canal ya sabe enviar. Para la UI, que oculta lo que no. */
export function isSendableChannel(channel: MessageChannel): boolean {
  return SENDABLE_CHANNELS.includes(channel);
}
