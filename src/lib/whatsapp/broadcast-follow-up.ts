// ============================================================
// Recordatorio automático de difusiones (migración 524).
//
// Una difusión con seguimiento le manda UNA plantilla de recordatorio a
// cada destinatario que recibió el mensaje y no escribió después, pasado
// el plazo configurado. Lo corre el cron del VPS (/api/broadcasts/cron),
// sin nadie delante: por eso todo lo que el envío necesita tiene que
// estar ya en la base — la plantilla en la difusión, los parámetros
// congelados en el destinatario (migración 038).
//
// Qué decide quién recibe el recordatorio NO está acá: está en
// `claim_due_broadcast_follow_ups`, que lo resuelve y lo reclama en una
// sola transacción para que dos pasadas solapadas nunca le escriban dos
// veces a la misma persona. Este módulo solo filtra por horario, pide
// los reclamados y los envía.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { sendTemplateWithVariants } from '@/lib/whatsapp/broadcast-core';
import { decrypt } from '@/lib/whatsapp/encryption';
import { resolveTemplateRow } from '@/lib/whatsapp/template-body';
import { extractVariableIndices } from '@/lib/whatsapp/template-validators';
import { fueraDeHorario, resolveRecipientId } from '@/lib/outbound/gate';

/** Recordatorios por pasada. Con el cron cada 5 minutos, 1 200 por hora. */
export const FOLLOW_UP_MAX_PER_PASS = 100;

/** Mismo ritmo que el asistente: 10 envíos y un segundo de pausa. */
const SEND_BATCH_SIZE = 10;
const SEND_BATCH_DELAY_MS = 1000;

export interface FollowUpPassResult {
  /** Recordatorios reclamados en esta pasada. */
  claimed: number;
  sent: number;
  failed: number;
}

/** Lo que devuelve `claim_due_broadcast_follow_ups`, fila por fila. */
interface ClaimedFollowUp {
  recipient_id: string;
  broadcast_id: string;
  account_id: string;
  contact_id: string;
  template_params: unknown;
  template_name: string;
  template_language: string | null;
}

interface SenderConfig {
  phoneNumberId: string;
  accessToken: string;
}

export interface FollowUpDeps {
  /** Inyectable para que las pruebas no esperen de verdad. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Una pasada del recordatorio. Lanza solo si no puede ni empezar (no
 * lee las difusiones, falla el reclamo); un envío que falla queda
 * registrado en su fila y la pasada sigue con los demás.
 */
export async function runBroadcastFollowUps(
  db: SupabaseClient,
  deps: FollowUpDeps = {}
): Promise<FollowUpPassResult> {
  const sleep = deps.sleep ?? defaultSleep;
  const result: FollowUpPassResult = { claimed: 0, sent: 0, failed: 0 };

  const cuentas = await cuentasEnHorario(db);
  if (cuentas.length === 0) return result;

  const { data, error } = await db.rpc('claim_due_broadcast_follow_ups', {
    p_account_ids: cuentas,
    p_limit: FOLLOW_UP_MAX_PER_PASS,
  });
  if (error) {
    throw new Error(`claim_due_broadcast_follow_ups failed: ${error.message}`);
  }
  const reclamados = (data ?? []) as ClaimedFollowUp[];
  result.claimed = reclamados.length;

  // Configuración y plantilla se leen una vez por cuenta / plantilla, no
  // una por destinatario.
  const senders = new Map<string, SenderConfig | null>();
  const plantillas = new Map<string, Awaited<ReturnType<typeof resolveTemplateRow>>>();

  for (let i = 0; i < reclamados.length; i += SEND_BATCH_SIZE) {
    if (i > 0) await sleep(SEND_BATCH_DELAY_MS);

    for (const fila of reclamados.slice(i, i + SEND_BATCH_SIZE)) {
      const outcome = await enviarRecordatorio(db, fila, senders, plantillas);
      if (outcome.ok) {
        result.sent++;
        await db
          .from('broadcast_recipients')
          .update({
            follow_up_status: 'sent',
            follow_up_sent_at: new Date().toISOString(),
            follow_up_message_id: outcome.messageId,
            follow_up_error: null,
          })
          .eq('id', fila.recipient_id);
      } else {
        result.failed++;
        await db
          .from('broadcast_recipients')
          .update({ follow_up_status: 'failed', follow_up_error: outcome.error })
          .eq('id', fila.recipient_id);
      }
    }
  }

  return result;
}

/**
 * Las cuentas con algún seguimiento activo que ahora están en horario.
 *
 * Lo de una cuenta fuera de horario ni se reclama: sigue vencido y sale
 * en la primera pasada dentro del horario, sin calcular la próxima
 * apertura y sin quedar en `sending` esperando.
 */
async function cuentasEnHorario(db: SupabaseClient): Promise<string[]> {
  const { data, error } = await db
    .from('broadcasts')
    .select('account_id')
    .not('follow_up_template_name', 'is', null)
    .is('follow_up_cancelled_at', null);
  if (error) {
    throw new Error(`follow-up accounts lookup failed: ${error.message}`);
  }

  const todas = [
    ...new Set(
      ((data ?? []) as { account_id: string | null }[])
        .map((r) => r.account_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  const enHorario: string[] = [];
  for (const cuenta of todas) {
    if (!(await fueraDeHorario(db, cuenta))) enHorario.push(cuenta);
  }
  return enHorario;
}

async function enviarRecordatorio(
  db: SupabaseClient,
  fila: ClaimedFollowUp,
  senders: Map<string, SenderConfig | null>,
  plantillas: Map<string, Awaited<ReturnType<typeof resolveTemplateRow>>>
): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  if (!senders.has(fila.account_id)) {
    senders.set(fila.account_id, await leerSender(db, fila.account_id));
  }
  const sender = senders.get(fila.account_id);
  if (!sender) return { ok: false, error: 'WhatsApp no está configurado en la cuenta' };

  const clave = `${fila.account_id}|${fila.template_name}|${fila.template_language ?? ''}`;
  if (!plantillas.has(clave)) {
    plantillas.set(
      clave,
      await resolveTemplateRow(db, fila.account_id, fila.template_name, fila.template_language)
    );
  }
  const plantilla = plantillas.get(clave)!;
  // Sin fila local no se sabe cuántas variables lleva, y el asistente la
  // validó contra una que existía: si ya no está, se dice claro en vez de
  // dejar que Meta devuelva un error opaco.
  if (!plantilla.row || plantilla.malformed) {
    return {
      ok: false,
      error: `La plantilla ${fila.template_name} no está disponible en la cuenta`,
    };
  }

  // El destino se resuelve AHORA: si el teléfono se corrigió desde el
  // envío original, vale el corregido.
  const destino = await resolveRecipientId(db, fila.account_id, fila.contact_id, 'whatsapp');
  if (!destino.ok) return { ok: false, error: `Sin destino alcanzable (${destino.reason})` };

  // Los valores del original solo si el recordatorio tiene variables: el
  // asistente garantiza que entonces son las mismas. Mandarlos a una
  // plantilla sin variables arma un cuerpo vacío que Meta rechaza.
  const lleva = extractVariableIndices(plantilla.row.body_text).length > 0;
  const params =
    lleva && Array.isArray(fila.template_params)
      ? fila.template_params.filter((p): p is string => typeof p === 'string')
      : [];

  return sendTemplateWithVariants({
    phoneNumberId: sender.phoneNumberId,
    accessToken: sender.accessToken,
    recipientId: destino.recipientId,
    templateName: fila.template_name,
    language: plantilla.language,
    templateRow: plantilla.row,
    params,
  });
}

async function leerSender(
  db: SupabaseClient,
  accountId: string
): Promise<SenderConfig | null> {
  const { data } = await db
    .from('whatsapp_config')
    .select('phone_number_id, access_token')
    .eq('account_id', accountId)
    .maybeSingle<{ phone_number_id: string | null; access_token: string | null }>();
  if (!data?.phone_number_id || !data.access_token) return null;
  return {
    phoneNumberId: data.phone_number_id,
    accessToken: decrypt(data.access_token),
  };
}
