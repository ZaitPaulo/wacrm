/**
 * Conteos del seguimiento de una difusión, para su página de detalle.
 *
 * Se calculan al leer, sobre las filas de `broadcast_recipients`, y no
 * como columnas de `broadcasts`: las de hoy son propiedad del trigger de
 * las migraciones 003/005, y mezclarlas con estas complicaría ese trigger
 * sin necesidad. Ver migración 524.
 */

import type { Broadcast, BroadcastRecipient } from '@/types';

export interface FollowUpStats {
  /** Todavía no salió: en espera, o reclamado y saliendo. */
  pending: number;
  /** De esos, los que ya vencieron y siguen sin salir. */
  overdue: number;
  sent: number;
  failed: number;
  skipped: number;
  /** Respondieron después de recibir el recordatorio. */
  repliedAfter: number;
}

/** Estados en los que el original llegó y todavía no hay respuesta. */
const AWAITING_REPLY = new Set(['sent', 'delivered', 'read']);

/**
 * Margen antes de llamar "vencido" a un recordatorio. El cron corre cada
 * 5 minutos: sin margen, todo recordatorio pasaría unos minutos marcado
 * como atrasado aunque todo funcione.
 */
export const OVERDUE_GRACE_MS = 15 * 60 * 1000;

type Recipient = Pick<
  BroadcastRecipient,
  'status' | 'sent_at' | 'replied_at' | 'created_at' | 'follow_up_status' | 'follow_up_sent_at'
>;

export interface NoReplyStats {
  /** Destinatarios que todavía se revisarán cuando venza su plazo. */
  pending: number;
  /** Destinatarios ya revisados (con o sin vehículos ocultados). */
  checked: number;
  /** Vehículos ocultados por la baja por silencio en esta difusión. */
  hiddenVehicles: number;
  /** Cuándo vence el plazo del primer pendiente, o null si no queda ninguno. */
  dueAt: Date | null;
}

/**
 * Conteos de la baja por silencio (migración 525). Mismo criterio que
 * `apply_due_no_reply_hides`: el plazo cuenta desde el envío original, y
 * solo queda pendiente quien recibió el mensaje y no respondió.
 */
export function summarizeNoReply(
  recipients: Pick<
    BroadcastRecipient,
    'status' | 'sent_at' | 'created_at' | 'no_reply_checked_at' | 'no_reply_hidden_count'
  >[],
  broadcast: Pick<Broadcast, 'no_reply_hide_after_days' | 'follow_up_cancelled_at'>
): NoReplyStats {
  const stats: NoReplyStats = { pending: 0, checked: 0, hiddenVehicles: 0, dueAt: null };
  const days = broadcast.no_reply_hide_after_days ?? 0;
  const cancelled = Boolean(broadcast.follow_up_cancelled_at);
  let earliest: number | null = null;

  for (const r of recipients) {
    if (r.no_reply_checked_at) {
      stats.checked++;
      stats.hiddenVehicles += r.no_reply_hidden_count ?? 0;
      continue;
    }
    if (cancelled || !AWAITING_REPLY.has(r.status)) continue;
    stats.pending++;
    const base = new Date(r.sent_at ?? r.created_at).getTime();
    earliest = earliest === null ? base : Math.min(earliest, base);
  }

  if (earliest !== null) stats.dueAt = new Date(earliest + days * 24 * 60 * 60 * 1000);
  return stats;
}

export function summarizeFollowUp(
  recipients: Recipient[],
  broadcast: Pick<Broadcast, 'follow_up_delay_hours' | 'follow_up_cancelled_at'>,
  now: Date = new Date()
): FollowUpStats {
  const stats: FollowUpStats = {
    pending: 0,
    overdue: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    repliedAfter: 0,
  };
  const delayMs = (broadcast.follow_up_delay_hours ?? 0) * 60 * 60 * 1000;
  const cancelled = Boolean(broadcast.follow_up_cancelled_at);

  for (const r of recipients) {
    switch (r.follow_up_status) {
      case 'sent':
        stats.sent++;
        if (
          r.status === 'replied' &&
          r.replied_at &&
          r.follow_up_sent_at &&
          new Date(r.replied_at) > new Date(r.follow_up_sent_at)
        ) {
          stats.repliedAfter++;
        }
        break;
      case 'failed':
        stats.failed++;
        break;
      case 'skipped':
        stats.skipped++;
        break;
      case 'sending':
        stats.pending++;
        break;
      default: {
        // Sin recordatorio todavía. Cancelado, ya no le va a llegar; y si
        // el original falló o ya respondió, nunca le tocaba.
        if (cancelled || !AWAITING_REPLY.has(r.status)) break;
        stats.pending++;
        const base = new Date(r.sent_at ?? r.created_at).getTime();
        if (base + delayMs + OVERDUE_GRACE_MS <= now.getTime()) stats.overdue++;
      }
    }
  }

  return stats;
}
