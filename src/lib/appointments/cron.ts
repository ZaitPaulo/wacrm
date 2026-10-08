// ============================================================
// El cron de la Agenda (/api/appointments/cron, cada minuto).
//
// Tres pasadas independientes; si una falla, las otras siguen:
//
//   1. Confirmaciones: drena las citas en `confirmation_status =
//      'pending'`. Con la ventana de 24 h abierta va texto libre; si no,
//      la plantilla de confirmación, solo en horario de atención.
//   2. Recordatorios: el día anterior, desde `reminder_time` y en
//      horario, la plantilla con los botones "Confirmo" / "Necesito
//      cambiar la hora".
//   3. Resumen diario: desde `digest_time`, una notificación por asesor
//      con sus visitas de hoy y las de ayer sin marcar asistencia.
//
// Quién se reclama lo deciden las RPC de la migración 548, con SKIP
// LOCKED: dos pasadas solapadas nunca mandan dos veces lo mismo. Las
// horas del día se calculan con el reloj del proceso (TZ del
// contenedor), como el horario de atención.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MessageTemplate } from '@/types';
import { fueraDeHorario } from '@/lib/outbound/gate';
import { formatVehicleLabel } from '@/lib/pipelines/deal-vehicle';
import { formatAppointmentDay, formatAppointmentTime, toDayKey } from './format';
import {
  buildConfirmationText,
  buildTemplateVariables,
  attendanceNotice,
  preVisitNotice,
  reminderButtonParams,
  type AppointmentMessageContext,
} from './messages';
import { sendAppointmentMessage, type SendOutcome } from './send';
import { openingOf, resolveAgendaHours, type AgendaHours } from './slots';
import { checkAppointmentTemplate, type AppointmentTemplateKind } from './templates';
import {
  DEFAULT_APPOINTMENT_SETTINGS,
  isActiveStatus,
  type Appointment,
  type AppointmentSettings,
} from './types';

export const APPOINTMENT_CRON_LIMIT = 50;

/** Hasta cuántos días atrás se recuerda marcar asistencia. */
export const ATTENDANCE_LOOKBACK_DAYS = 7;

/** Cierre usado cuando el día no tiene horario configurado. */
const DEFAULT_CLOSING_HOUR = 18;

export interface AppointmentCronDeps {
  now?: () => Date;
  send?: typeof sendAppointmentMessage;
  /** Inyectable para las pruebas: ¿la cuenta está fuera de horario? */
  outOfHours?: (db: SupabaseClient, accountId: string) => Promise<boolean>;
}

export interface PassCount {
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
  deferred: number;
}

export interface AppointmentCronResult {
  confirmations: PassCount;
  reminders: PassCount;
  digests: number;
  /** Avisos de visita próxima creados (agenda-citas-avisos). */
  preVisits: number;
  /** Avisos de asistencia sin marcar creados, uno por asesor y día. */
  attendanceReminders: number;
  errors: string[];
}

const emptyPass = (): PassCount => ({ claimed: 0, sent: 0, skipped: 0, failed: 0, deferred: 0 });

// ------------------------------------------------------------
// Horas del día (puras)
// ------------------------------------------------------------

export function startOfDay(d: Date, offsetDays = 0): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offsetDays);
}

/** "10:00:00" del día de `d`, en hora local. Una hora inválida da medianoche. */
export function atTimeOf(d: Date, time: string): Date {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? '');
  const h = m ? Math.min(23, Number(m[1])) : 0;
  const min = m ? Math.min(59, Number(m[2])) : 0;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, min);
}

export type MessageState = 'sent' | 'deferred' | 'skipped' | 'failed';

/** Qué hacer con la cita según cómo salió el envío. */
export function stateFor(outcome: SendOutcome): MessageState {
  if (outcome.ok) return 'sent';
  switch (outcome.reason) {
    case 'quiet_hours':
      return 'deferred';
    case 'channel_unsupported':
    case 'no_recipient':
      return 'skipped';
    default:
      return 'failed';
  }
}

// ------------------------------------------------------------
// Resumen diario (puro)
// ------------------------------------------------------------

export interface DigestInput {
  today: { starts_at: string; contactName: string | null }[];
  pendingYesterday: number;
}

export function buildDigest({ today, pendingYesterday }: DigestInput): { title: string; body: string } | null {
  if (today.length === 0 && pendingYesterday === 0) return null;
  const sorted = [...today].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const parts: string[] = sorted.map(
    (a) => `${formatAppointmentTime(a.starts_at)} ${a.contactName?.trim() || 'Cliente'}`
  );
  if (pendingYesterday > 0) {
    parts.push(
      pendingYesterday === 1
        ? 'Marca la asistencia de 1 cita de ayer'
        : `Marca la asistencia de ${pendingYesterday} citas de ayer`
    );
  }
  const title =
    today.length > 0 ? `Tus visitas de hoy: ${today.length}` : 'Tienes citas de ayer sin marcar';
  return { title, body: parts.join(' · ') };
}

// ------------------------------------------------------------
// La pasada completa
// ------------------------------------------------------------

type Settings = Omit<AppointmentSettings, 'account_id'>;

interface AccountContext {
  settings: Settings;
  agenda: AgendaHours;
  businessName: string | null;
  address: string | null;
  templates: Map<string, MessageTemplate | null>;
}

export async function runAppointmentCron(
  db: SupabaseClient,
  deps: AppointmentCronDeps = {}
): Promise<AppointmentCronResult> {
  const now = (deps.now ?? (() => new Date()))();
  const send = deps.send ?? sendAppointmentMessage;
  const outOfHours = deps.outOfHours ?? fueraDeHorario;
  const result: AppointmentCronResult = {
    confirmations: emptyPass(),
    reminders: emptyPass(),
    digests: 0,
    preVisits: 0,
    attendanceReminders: 0,
    errors: [],
  };

  let accounts: string[];
  try {
    accounts = await accountsWithWork(db, now);
  } catch (err) {
    result.errors.push(`cuentas: ${errMsg(err)}`);
    return result;
  }

  for (const accountId of accounts) {
    let ctx: AccountContext;
    let closed: boolean;
    try {
      ctx = await loadAccountContext(db, accountId);
      closed = await outOfHours(db, accountId);
    } catch (err) {
      result.errors.push(`${accountId}: ${errMsg(err)}`);
      continue;
    }

    const passes: [string, () => Promise<void>][] = [
      ['confirmaciones', () => confirmationsPass(db, accountId, ctx, closed, now, send, result.confirmations)],
      ['recordatorios', () => remindersPass(db, accountId, ctx, closed, now, send, result.reminders)],
      [
        'resumen',
        async () => {
          result.digests += await digestPass(db, accountId, ctx.settings, now);
        },
      ],
      [
        'visita próxima',
        async () => {
          result.preVisits += await preVisitPass(db, accountId, ctx, now);
        },
      ],
      [
        'asistencia',
        async () => {
          result.attendanceReminders += await attendancePass(db, accountId, ctx, now);
        },
      ],
    ];
    for (const [name, pass] of passes) {
      try {
        await pass();
      } catch (err) {
        result.errors.push(`${accountId} ${name}: ${errMsg(err)}`);
      }
    }
  }
  return result;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Cuentas con configuración guardada o con citas entre ayer y mañana. */
async function accountsWithWork(db: SupabaseClient, now: Date): Promise<string[]> {
  const [settings, recent] = await Promise.all([
    db.from('appointment_settings').select('account_id'),
    db
      .from('appointments')
      .select('account_id')
      // 7 días atrás: el aviso de asistencia sin marcar mira hasta ahí.
      .gte('starts_at', startOfDay(now, -ATTENDANCE_LOOKBACK_DAYS).toISOString())
      .lt('starts_at', startOfDay(now, 2).toISOString())
      .limit(1000),
  ]);
  if (settings.error) throw new Error(settings.error.message);
  if (recent.error) throw new Error(recent.error.message);
  const ids = [...(settings.data ?? []), ...(recent.data ?? [])].map(
    (r: { account_id: string }) => r.account_id
  );
  return [...new Set(ids)];
}

async function loadAccountContext(db: SupabaseClient, accountId: string): Promise<AccountContext> {
  const [s, a] = await Promise.all([
    db.from('appointment_settings').select('*').eq('account_id', accountId).maybeSingle(),
    db
      .from('accounts')
      .select('public_name, public_address, business_hours, holiday_calendar')
      .eq('id', accountId)
      .maybeSingle(),
  ]);
  return {
    settings: { ...DEFAULT_APPOINTMENT_SETTINGS, ...(s.data ?? {}) },
    agenda: resolveAgendaHours(a.data ?? null),
    businessName: a.data?.public_name ?? null,
    address: a.data?.public_address ?? null,
    templates: new Map(),
  };
}

async function templateFor(
  db: SupabaseClient,
  ctx: AccountContext,
  id: string | null,
  kind: AppointmentTemplateKind
): Promise<{ template: MessageTemplate; variableCount: number } | null> {
  if (!id) return null;
  if (!ctx.templates.has(id)) {
    const { data } = await db.from('message_templates').select('*').eq('id', id).maybeSingle();
    ctx.templates.set(id, (data as MessageTemplate | null) ?? null);
  }
  const template = ctx.templates.get(id);
  if (!template) return null;
  const check = checkAppointmentTemplate(template, kind);
  return check.ok ? { template, variableCount: check.variableCount } : null;
}

/** Nombre del cliente, del asesor y vehículos de una cita. */
async function messageContext(
  db: SupabaseClient,
  ctx: AccountContext,
  a: Appointment
): Promise<AppointmentMessageContext> {
  const [contact, agent, vehicles] = await Promise.all([
    db.from('contacts').select('name').eq('id', a.contact_id).maybeSingle(),
    db.from('profiles').select('full_name').eq('user_id', a.assigned_agent_id).maybeSingle(),
    db
      .from('appointment_vehicles')
      .select('vehicle:inventory_vehicles(brand, model, year, license_plate)')
      .eq('appointment_id', a.id),
  ]);
  type V = { brand: string; model: string; year: number; license_plate: string | null };
  const list = ((vehicles.data ?? []) as unknown as { vehicle: V | null }[])
    .map((r) => r.vehicle)
    .filter((v): v is V => !!v)
    .map((v) => formatVehicleLabel({ ...v, license_plate: null }));
  return {
    contactName: contact.data?.name ?? null,
    agentName: agent.data?.full_name ?? null,
    startsAt: a.starts_at,
    vehicles: list,
    businessName: ctx.businessName,
    address: ctx.address,
  };
}

async function confirmationsPass(
  db: SupabaseClient,
  accountId: string,
  ctx: AccountContext,
  closed: boolean,
  now: Date,
  send: typeof sendAppointmentMessage,
  count: PassCount
): Promise<void> {
  if (!ctx.settings.customer_messages_enabled) {
    // Con los mensajes apagados no queda nada en cola: si algo quedó
    // pendiente de antes, se cierra como omitido en vez de salir de
    // golpe el día que se vuelvan a activar.
    await db
      .from('appointments')
      .update({ confirmation_status: 'skipped' })
      .eq('account_id', accountId)
      .eq('confirmation_status', 'pending');
    return;
  }

  const { data, error } = await db.rpc('claim_pending_appointment_confirmations', {
    p_account_id: accountId,
    p_window_only: closed,
    p_limit: APPOINTMENT_CRON_LIMIT,
  });
  if (error) throw new Error(error.message);
  const claimed = (data ?? []) as Appointment[];
  count.claimed += claimed.length;

  for (const a of claimed) {
    let state: MessageState;
    // Sin conversación, ya pasada o cancelada mientras esperaba: no se avisa.
    if (
      !a.conversation_id ||
      !isActiveStatus(a.status) ||
      new Date(a.starts_at).getTime() <= now.getTime()
    ) {
      state = 'skipped';
    } else {
      const mctx = await messageContext(db, ctx, a);
      // Primero texto libre, como respuesta: si la ventana está abierta
      // sale a cualquier hora, igual que contestarle al cliente.
      let outcome = await send(db, accountId, a.conversation_id, {
        kind: 'text',
        text: buildConfirmationText(mctx),
        initiative: 'reply',
      });
      if (!outcome.ok && outcome.reason === 'outside_window') {
        const tpl = await templateFor(db, ctx, ctx.settings.confirmation_template_id, 'confirmation');
        outcome = tpl
          ? await send(db, accountId, a.conversation_id, {
              kind: 'template',
              template: tpl.template,
              body: buildTemplateVariables(mctx, tpl.variableCount),
            })
          : { ok: false, reason: 'error', error: 'plantilla de confirmación no disponible' };
      }
      state = stateFor(outcome);
      if (!outcome.ok && state === 'failed') {
        console.error('[appointments] confirmación falló:', a.id, outcome.reason, outcome.error);
      }
    }

    if (state === 'deferred') {
      count.deferred++;
      await db
        .from('appointments')
        .update({ confirmation_status: 'pending', confirmation_claimed_at: null })
        .eq('id', a.id);
      continue;
    }
    count[state]++;
    await db
      .from('appointments')
      .update({
        confirmation_status: state,
        ...(state === 'sent' ? { confirmation_sent_at: new Date().toISOString() } : {}),
      })
      .eq('id', a.id);
  }
}

async function remindersPass(
  db: SupabaseClient,
  accountId: string,
  ctx: AccountContext,
  closed: boolean,
  now: Date,
  send: typeof sendAppointmentMessage,
  count: PassCount
): Promise<void> {
  if (!ctx.settings.customer_messages_enabled || closed) return;
  if (now.getTime() < atTimeOf(now, ctx.settings.reminder_time).getTime()) return;

  const { data, error } = await db.rpc('claim_due_appointment_reminders', {
    p_account_id: accountId,
    p_today_start: startOfDay(now).toISOString(),
    p_tomorrow_start: startOfDay(now, 1).toISOString(),
    p_tomorrow_end: startOfDay(now, 2).toISOString(),
    p_limit: APPOINTMENT_CRON_LIMIT,
  });
  if (error) throw new Error(error.message);
  const claimed = (data ?? []) as Appointment[];
  count.claimed += claimed.length;

  const tpl = await templateFor(db, ctx, ctx.settings.reminder_template_id, 'reminder');

  for (const a of claimed) {
    let outcome: SendOutcome;
    if (!a.conversation_id) {
      outcome = { ok: false, reason: 'no_recipient' };
    } else if (!tpl) {
      outcome = { ok: false, reason: 'error', error: 'plantilla de recordatorio no disponible' };
    } else {
      const mctx = await messageContext(db, ctx, a);
      outcome = await send(db, accountId, a.conversation_id, {
        kind: 'template',
        template: tpl.template,
        body: buildTemplateVariables(mctx, tpl.variableCount),
        buttonParams: reminderButtonParams(a.id, a.starts_at),
      });
    }
    const state = stateFor(outcome);
    if (state === 'deferred') {
      count.deferred++;
      await db
        .from('appointments')
        .update({ reminder_status: null, reminder_claimed_at: null })
        .eq('id', a.id);
      continue;
    }
    if (!outcome.ok && state === 'failed') {
      console.error('[appointments] recordatorio falló:', a.id, outcome.reason, outcome.error);
    }
    count[state]++;
    await db
      .from('appointments')
      .update({
        reminder_status: state,
        ...(state === 'sent' ? { reminder_sent_at: new Date().toISOString() } : {}),
      })
      .eq('id', a.id);
  }
}

async function digestPass(
  db: SupabaseClient,
  accountId: string,
  settings: Settings,
  now: Date
): Promise<number> {
  if (now.getTime() < atTimeOf(now, settings.digest_time).getTime()) return 0;

  const today = startOfDay(now);
  const { data, error } = await db
    .from('appointments')
    .select('id, assigned_agent_id, starts_at, contact:contacts(name)')
    .eq('account_id', accountId)
    .in('status', ['scheduled', 'confirmed'])
    .gte('starts_at', startOfDay(now, -1).toISOString())
    .lt('starts_at', startOfDay(now, 1).toISOString());
  if (error) throw new Error(error.message);

  type Row = { id: string; assigned_agent_id: string; starts_at: string; contact: { name: string | null } | null };
  const byAgent = new Map<string, DigestInput>();
  for (const r of (data ?? []) as unknown as Row[]) {
    const entry = byAgent.get(r.assigned_agent_id) ?? { today: [], pendingYesterday: 0 };
    if (new Date(r.starts_at).getTime() >= today.getTime()) {
      entry.today.push({ starts_at: r.starts_at, contactName: r.contact?.name ?? null });
    } else {
      entry.pendingYesterday++;
    }
    byAgent.set(r.assigned_agent_id, entry);
  }

  const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  let created = 0;
  for (const [userId, input] of byAgent) {
    const digest = buildDigest(input);
    if (!digest) continue;
    // Una vez por asesor y día: solo quien gana el INSERT crea el aviso.
    const { data: claimed, error: claimErr } = await db
      .from('appointment_digests')
      .upsert({ account_id: accountId, user_id: userId, day }, { onConflict: 'account_id,user_id,day', ignoreDuplicates: true })
      .select('user_id');
    if (claimErr) throw new Error(claimErr.message);
    if (!claimed || claimed.length === 0) continue;

    const { error: notifyErr } = await db.from('notifications').insert({
      account_id: accountId,
      user_id: userId,
      type: 'appointment_digest',
      title: digest.title,
      body: digest.body,
    });
    if (notifyErr) throw new Error(notifyErr.message);
    created++;
  }
  return created;
}

// ------------------------------------------------------------
// Avisos al asesor (agenda-citas-avisos)
// ------------------------------------------------------------

/**
 * Hasta qué instante se pueden recordar las asistencias: si el horario
 * de hoy ya cerró, ahora; si no, el inicio de hoy (solo días pasados).
 * El cierre es el del horario de atención, o las 18:00 sin horario.
 */
export function attendanceCutoff(now: Date, agenda: AgendaHours): Date {
  const opening = openingOf(startOfDay(now), agenda);
  const closing = opening?.end ?? atTimeOf(now, `${DEFAULT_CLOSING_HOUR}:00`);
  return now.getTime() >= closing.getTime() ? now : startOfDay(now);
}

async function contactNames(db: SupabaseClient, ids: string[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { data } = await db.from('contacts').select('id, name').in('id', unique);
  return new Map(((data ?? []) as { id: string; name: string | null }[]).map((c) => [c.id, c.name]));
}

async function preVisitPass(
  db: SupabaseClient,
  accountId: string,
  ctx: AccountContext,
  now: Date
): Promise<number> {
  const minutes = ctx.settings.pre_visit_alert_minutes;
  if (!minutes) return 0;

  const { data, error } = await db.rpc('claim_due_pre_visit_alerts', {
    p_account_id: accountId,
    p_minutes: minutes,
    p_limit: APPOINTMENT_CRON_LIMIT,
  });
  if (error) throw new Error(error.message);
  const claimed = (data ?? []) as Appointment[];

  let created = 0;
  for (const a of claimed) {
    const mctx = await messageContext(db, ctx, a);
    const notice = preVisitNotice({
      contactName: mctx.contactName,
      startsAt: a.starts_at,
      now,
      purpose: a.purpose,
      vehicles: mctx.vehicles,
    });
    const { error: notifyErr } = await db.from('notifications').insert({
      account_id: accountId,
      user_id: a.assigned_agent_id,
      type: 'appointment_pre_visit',
      appointment_id: a.id,
      conversation_id: a.conversation_id,
      contact_id: a.contact_id,
      title: notice.title,
      body: notice.body,
    });
    if (notifyErr) {
      console.error('[appointments] aviso de visita próxima falló:', a.id, notifyErr.message);
      continue;
    }
    created++;
  }
  return created;
}

async function attendancePass(
  db: SupabaseClient,
  accountId: string,
  ctx: AccountContext,
  now: Date
): Promise<number> {
  const since = startOfDay(now, -ATTENDANCE_LOOKBACK_DAYS);
  const until = attendanceCutoff(now, ctx.agenda);
  if (until.getTime() <= since.getTime()) return 0;

  const { data, error } = await db.rpc('claim_pending_attendance_reminders', {
    p_account_id: accountId,
    p_since: since.toISOString(),
    p_until: until.toISOString(),
    p_limit: 500,
  });
  if (error) throw new Error(error.message);
  const claimed = (data ?? []) as Appointment[];
  if (claimed.length === 0) return 0;

  const names = await contactNames(db, claimed.map((a) => a.contact_id));
  const groups = new Map<string, Appointment[]>();
  for (const a of claimed) {
    const key = `${a.assigned_agent_id}|${toDayKey(a.starts_at)}`;
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }

  const todayKey = toDayKey(now);
  let created = 0;
  for (const [key, list] of groups) {
    const [agentId, dayKey] = key.split('|');
    const notice = attendanceNotice({
      dayLabel: formatAppointmentDay(list[0].starts_at),
      isToday: dayKey === todayKey,
      items: list.map((a) => ({ startsAt: a.starts_at, contactName: names.get(a.contact_id) ?? null })),
    });
    const { error: notifyErr } = await db.from('notifications').insert({
      account_id: accountId,
      user_id: agentId,
      type: 'appointment_attendance_pending',
      // Una sola cita: el aviso abre esa cita. Varias: la vista Día.
      appointment_id: list.length === 1 ? list[0].id : null,
      link_path: `/agenda?vista=dia&fecha=${dayKey}`,
      title: notice.title,
      body: notice.body,
    });
    if (notifyErr) throw new Error(notifyErr.message);
    created++;
  }
  return created;
}
