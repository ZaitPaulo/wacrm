// ============================================================
// El cliente tocó un botón del recordatorio de su cita.
//
// Se atiende en el núcleo de entrada ANTES de flujos, automatizaciones
// y bot (`inbound/core.ts`): la respuesta es determinista y no tiene
// nada que interpretar. Si el mensaje no es de una cita, no se toca y
// sigue su camino normal.
//
// El payload trae el inicio de la cita en segundos (`messages.ts`): si
// la cita se movió después del recordatorio, el botón viejo no confirma
// una hora que ya no es la vigente.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { formatAppointmentWhen } from './format';
import {
  STALE_REMINDER_REPLY_TEXT,
  changeRequestedReplyText,
  confirmedReplyText,
  isAppointmentPayload,
  parseReminderPayload,
  startsAtEpoch,
} from './messages';
import { sendAppointmentMessage, type AppointmentSend, type SendOutcome } from './send';
import { isActiveStatus, type Appointment } from './types';

export interface AppointmentReplyInput {
  accountId: string;
  contactId: string;
  conversationId: string;
  /** `interactiveReplyId` del mensaje entrante: el payload del botón. */
  replyId: string | null | undefined;
}

export interface AppointmentReplyDeps {
  send?: (
    db: SupabaseClient,
    accountId: string,
    conversationId: string,
    message: AppointmentSend
  ) => Promise<SendOutcome>;
  now?: () => Date;
}

export type AppointmentReplyResult =
  /** No era un botón de cita: el mensaje sigue su camino normal. */
  | { consumed: false }
  | { consumed: true; outcome: 'confirmed' | 'change_requested' | 'stale' };

type Row = Pick<
  Appointment,
  'id' | 'account_id' | 'contact_id' | 'conversation_id' | 'assigned_agent_id' | 'starts_at' | 'status'
>;

export async function handleAppointmentReply(
  db: SupabaseClient,
  input: AppointmentReplyInput,
  deps: AppointmentReplyDeps = {}
): Promise<AppointmentReplyResult> {
  if (!isAppointmentPayload(input.replyId)) return { consumed: false };
  const send = deps.send ?? sendAppointmentMessage;
  const now = (deps.now ?? (() => new Date()))();

  const reply = (text: string) =>
    send(db, input.accountId, input.conversationId, { kind: 'text', text, initiative: 'reply' }).then(
      (r) => {
        if (!r.ok) console.error('[appointments] no se pudo responder al botón:', r.reason, r.error);
      }
    );

  const parsed = parseReminderPayload(input.replyId);
  let appointment: Row | null = null;
  if (parsed) {
    const { data } = await db
      .from('appointments')
      .select('id, account_id, contact_id, conversation_id, assigned_agent_id, starts_at, status')
      .eq('id', parsed.appointmentId)
      .eq('account_id', input.accountId)
      .eq('contact_id', input.contactId)
      .maybeSingle<Row>();
    appointment = data ?? null;
  }

  const vigente =
    !!parsed &&
    !!appointment &&
    isActiveStatus(appointment.status) &&
    startsAtEpoch(appointment.starts_at) === parsed.epoch &&
    new Date(appointment.starts_at).getTime() > now.getTime();

  if (!parsed || !appointment || !vigente) {
    await reply(STALE_REMINDER_REPLY_TEXT);
    return { consumed: true, outcome: 'stale' };
  }

  const respondedAt = now.toISOString();

  if (parsed.action === 'confirmar') {
    const { error } = await db
      .from('appointments')
      .update({ status: 'confirmed', customer_response: 'confirmed', customer_responded_at: respondedAt })
      .eq('id', appointment.id);
    if (error) console.error('[appointments] no se pudo confirmar la cita:', error.message);
    await reply(confirmedReplyText(appointment.starts_at));
    return { consumed: true, outcome: 'confirmed' };
  }

  const { error } = await db
    .from('appointments')
    .update({ customer_response: 'change_requested', customer_responded_at: respondedAt })
    .eq('id', appointment.id);
  if (error) console.error('[appointments] no se pudo registrar el pedido de cambio:', error.message);

  const [{ data: contact }, { data: agent }] = await Promise.all([
    db.from('contacts').select('name').eq('id', appointment.contact_id).maybeSingle<{ name: string | null }>(),
    db
      .from('profiles')
      .select('full_name')
      .eq('user_id', appointment.assigned_agent_id)
      .maybeSingle<{ full_name: string | null }>(),
  ]);

  // El push sale solo, por el trigger de despacho de `notifications`.
  const { error: notifyError } = await db.from('notifications').insert({
    account_id: appointment.account_id,
    user_id: appointment.assigned_agent_id,
    type: 'appointment_change_requested',
    appointment_id: appointment.id,
    conversation_id: appointment.conversation_id ?? input.conversationId,
    contact_id: appointment.contact_id,
    title: `${contact?.name?.trim() || 'Un cliente'} pidió cambiar su cita`,
    body: formatAppointmentWhen(appointment.starts_at),
  });
  if (notifyError) console.error('[appointments] no se pudo avisar al asesor:', notifyError.message);

  await reply(changeRequestedReplyText(agent?.full_name ?? null));
  return { consumed: true, outcome: 'change_requested' };
}
