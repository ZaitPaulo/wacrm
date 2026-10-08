import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { atTimeOf, attendanceCutoff, buildDigest, runAppointmentCron, startOfDay, stateFor } from './cron';
import { attendanceNotice, minutesLabel, preVisitNotice } from './messages';
import { DEFAULT_AGENDA_HOURS } from './slots';
import type { AppointmentSend } from './send';

describe('horas del día', () => {
  it('atTimeOf fija la hora local del mismo día', () => {
    const d = atTimeOf(new Date(2026, 9, 6, 15, 40), '10:00:00');
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([6, 10, 0]);
    expect(atTimeOf(new Date(2026, 9, 6), '07:30').getMinutes()).toBe(30);
    expect(atTimeOf(new Date(2026, 9, 6), 'basura').getHours()).toBe(0);
  });

  it('startOfDay con desplazamiento', () => {
    expect(startOfDay(new Date(2026, 9, 31, 12), 1).getTime()).toBe(new Date(2026, 10, 1).getTime());
  });
});

describe('stateFor', () => {
  it('traduce el resultado del envío', () => {
    expect(stateFor({ ok: true, messageId: 'x' })).toBe('sent');
    expect(stateFor({ ok: false, reason: 'quiet_hours' })).toBe('deferred');
    expect(stateFor({ ok: false, reason: 'channel_unsupported' })).toBe('skipped');
    expect(stateFor({ ok: false, reason: 'no_recipient' })).toBe('skipped');
    expect(stateFor({ ok: false, reason: 'outside_window' })).toBe('failed');
    expect(stateFor({ ok: false, reason: 'error', error: 'x' })).toBe('failed');
  });
});

describe('buildDigest', () => {
  it('lista las visitas de hoy en orden', () => {
    expect(
      buildDigest({
        today: [
          { starts_at: new Date(2026, 9, 6, 14).toISOString(), contactName: 'Jorge Castro' },
          { starts_at: new Date(2026, 9, 6, 9).toISOString(), contactName: 'Sandra Pérez' },
        ],
        pendingYesterday: 0,
      })
    ).toEqual({
      title: 'Tus visitas de hoy: 2',
      body: '9:00 a. m. Sandra Pérez · 2:00 p. m. Jorge Castro',
    });
  });

  it('recuerda la asistencia de ayer', () => {
    expect(buildDigest({ today: [], pendingYesterday: 1 })).toEqual({
      title: 'Tienes citas de ayer sin marcar',
      body: 'Marca la asistencia de 1 cita de ayer',
    });
    expect(
      buildDigest({
        today: [{ starts_at: new Date(2026, 9, 6, 9).toISOString(), contactName: null }],
        pendingYesterday: 2,
      })?.body
    ).toBe('9:00 a. m. Cliente · Marca la asistencia de 2 citas de ayer');
  });

  it('sin nada no hay resumen', () => {
    expect(buildDigest({ today: [], pendingYesterday: 0 })).toBeNull();
  });
});

// ------------------------------------------------------------
// La pasada completa, con una base falsa
// ------------------------------------------------------------

const ACCT = 'acct-1';
const NOW = new Date(2026, 9, 6, 10, 30); // lunes 10:30

interface FakeOpts {
  settings: Record<string, unknown> | null;
  pendingConfirmations?: Record<string, unknown>[];
  dueReminders?: Record<string, unknown>[];
  digestRows?: Record<string, unknown>[];
  digestAlreadySent?: boolean;
  preVisit?: Record<string, unknown>[];
  attendance?: Record<string, unknown>[];
  account?: Record<string, unknown>;
}

function fakeDb(opts: FakeOpts) {
  const updates: { table: string; payload: Record<string, unknown> }[] = [];
  const inserts: { table: string; rows: Record<string, unknown> }[] = [];
  const rpcs: { fn: string; args: Record<string, unknown> }[] = [];

  function chain(table: string) {
    let isSelectList = false;
    const c: Record<string, unknown> = {};
    const resolveList = () => {
      if (table === 'appointment_settings') return { data: opts.settings ? [{ account_id: ACCT }] : [], error: null };
      if (table === 'appointments') {
        return { data: isSelectList ? (opts.digestRows ?? []) : [{ account_id: ACCT }], error: null };
      }
      if (table === 'appointment_vehicles') return { data: [], error: null };
      return { data: [], error: null };
    };
    Object.assign(c, {
      select: (cols?: string) => {
        if (cols?.includes('contact:contacts')) isSelectList = true;
        return c;
      },
      eq: () => c,
      gte: () => c,
      in: () => c,
      lt: () => c,
      limit: () => Promise.resolve(resolveList()),
      then: (fn: (v: unknown) => unknown) => Promise.resolve(resolveList()).then(fn),
      maybeSingle: () => {
        if (table === 'appointment_settings') return Promise.resolve({ data: opts.settings, error: null });
        if (table === 'accounts') {
          return Promise.resolve({
            data: { public_name: 'Lora Motors', public_address: null, ...(opts.account ?? {}) },
            error: null,
          });
        }
        if (table === 'contacts') return Promise.resolve({ data: { name: 'Jorge Castro' }, error: null });
        if (table === 'profiles') return Promise.resolve({ data: { full_name: 'Angélica Rodríguez' }, error: null });
        if (table === 'message_templates') {
          return Promise.resolve({
            data: {
              id: 'tpl',
              name: 'recordatorio_cita',
              language: 'es',
              status: 'APPROVED',
              body_text: 'Hola {{1}}, te esperamos el {{2}}.',
              buttons: [
                { type: 'QUICK_REPLY', text: 'Confirmo' },
                { type: 'QUICK_REPLY', text: 'Necesito cambiar la hora' },
              ],
            },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      update: (payload: Record<string, unknown>) => {
        updates.push({ table, payload });
        const u: Record<string, unknown> = {};
        Object.assign(u, { eq: () => u, then: (fn: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(fn) });
        return u;
      },
      upsert: () => ({
        select: () =>
          Promise.resolve({ data: opts.digestAlreadySent ? [] : [{ user_id: 'u-a' }], error: null }),
      }),
      insert: (rows: Record<string, unknown>) => {
        inserts.push({ table, rows });
        return Promise.resolve({ error: null });
      },
    });
    return c;
  }

  const db = {
    from: (t: string) => chain(t),
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      if (fn === 'claim_due_pre_visit_alerts') return Promise.resolve({ data: opts.preVisit ?? [], error: null });
      if (fn === 'claim_pending_attendance_reminders') {
        return Promise.resolve({ data: opts.attendance ?? [], error: null });
      }
      if (fn === 'claim_pending_appointment_confirmations') {
        return Promise.resolve({ data: opts.pendingConfirmations ?? [], error: null });
      }
      return Promise.resolve({ data: opts.dueReminders ?? [], error: null });
    },
  } as unknown as SupabaseClient;
  return { db, updates, inserts, rpcs };
}

const appt = (overrides: Record<string, unknown> = {}) => ({
  id: '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90',
  account_id: ACCT,
  contact_id: 'c-1',
  conversation_id: 'conv-1',
  assigned_agent_id: 'u-a',
  starts_at: new Date(2026, 9, 7, 14).toISOString(),
  status: 'scheduled',
  ...overrides,
});

const ENABLED = {
  account_id: ACCT,
  customer_messages_enabled: true,
  confirmation_template_id: 'tpl-conf',
  reminder_template_id: 'tpl',
  reminder_time: '10:00:00',
  digest_time: '07:30:00',
  default_duration_minutes: 30,
};

function sender(results: Record<string, unknown>[] = []) {
  const sent: AppointmentSend[] = [];
  const send = vi.fn(async (_db: SupabaseClient, _a: string, _c: string, m: AppointmentSend) => {
    sent.push(m);
    return (results.shift() ?? { ok: true, messageId: 'wamid' }) as never;
  });
  return { send, sent };
}

describe('runAppointmentCron', () => {
  it('confirmación con ventana abierta: texto libre y queda enviada', async () => {
    const { db, updates } = fakeDb({ settings: ENABLED, pendingConfirmations: [appt()] });
    const { send, sent } = sender();
    const r = await runAppointmentCron(db, { now: () => NOW, send, outOfHours: async () => false });
    expect(sent[0]).toMatchObject({ kind: 'text', initiative: 'reply' });
    expect(r.confirmations.sent).toBe(1);
    expect(updates).toContainEqual(
      expect.objectContaining({ payload: expect.objectContaining({ confirmation_status: 'sent' }) })
    );
  });

  it('confirmación con ventana cerrada fuera de horario: vuelve a la cola', async () => {
    const { db, updates } = fakeDb({ settings: ENABLED, pendingConfirmations: [appt()] });
    const { send } = sender([
      { ok: false, reason: 'outside_window' },
      { ok: false, reason: 'quiet_hours' },
    ]);
    const r = await runAppointmentCron(db, { now: () => NOW, send, outOfHours: async () => true });
    expect(r.confirmations.deferred).toBe(1);
    expect(updates).toContainEqual(
      expect.objectContaining({ payload: { confirmation_status: 'pending', confirmation_claimed_at: null } })
    );
  });

  it('con los mensajes apagados no reclama y cierra lo pendiente', async () => {
    const { db, rpcs, updates } = fakeDb({ settings: { ...ENABLED, customer_messages_enabled: false } });
    const { send } = sender();
    await runAppointmentCron(db, { now: () => NOW, send, outOfHours: async () => false });
    // Los avisos al asesor siguen corriendo; los mensajes al cliente no.
    const fns = rpcs.map((x) => x.fn);
    expect(fns).not.toContain('claim_pending_appointment_confirmations');
    expect(fns).not.toContain('claim_due_appointment_reminders');
    expect(send).not.toHaveBeenCalled();
    expect(updates[0].payload).toEqual({ confirmation_status: 'skipped' });
  });

  it('recordatorio: plantilla con los dos payloads de botón', async () => {
    const { db, rpcs } = fakeDb({ settings: ENABLED, dueReminders: [appt()] });
    const { send, sent } = sender();
    const r = await runAppointmentCron(db, { now: () => NOW, send, outOfHours: async () => false });
    expect(rpcs.map((x) => x.fn)).toContain('claim_due_appointment_reminders');
    expect(r.reminders.sent).toBe(1);
    const msg = sent.find((m) => m.kind === 'template');
    expect(msg?.kind === 'template' && msg.buttonParams?.[0]).toMatch(/^cita:.*:confirmar:\d+$/);
    expect(msg?.kind === 'template' && msg.buttonParams?.[1]).toMatch(/^cita:.*:cambiar:\d+$/);
    expect(msg?.kind === 'template' && msg.body).toEqual(['Jorge', 'miércoles 7 de octubre, 2:00 p. m.']);
  });

  it('antes de la hora del recordatorio no reclama', async () => {
    const { db, rpcs } = fakeDb({ settings: ENABLED, dueReminders: [appt()] });
    const { send } = sender();
    await runAppointmentCron(db, { now: () => new Date(2026, 9, 6, 9, 0), send, outOfHours: async () => false });
    expect(rpcs.map((x) => x.fn)).not.toContain('claim_due_appointment_reminders');
  });

  it('fuera de horario no manda recordatorios', async () => {
    const { db, rpcs } = fakeDb({ settings: ENABLED, dueReminders: [appt()] });
    const { send } = sender();
    await runAppointmentCron(db, { now: () => NOW, send, outOfHours: async () => true });
    expect(rpcs.map((x) => x.fn)).not.toContain('claim_due_appointment_reminders');
  });

  it('resumen diario: una notificación para el asesor con visitas', async () => {
    const { db, inserts } = fakeDb({
      settings: ENABLED,
      digestRows: [
        { id: 'a', assigned_agent_id: 'u-a', starts_at: new Date(2026, 9, 6, 14).toISOString(), contact: { name: 'Jorge Castro' } },
      ],
    });
    const { send } = sender();
    const r = await runAppointmentCron(db, { now: () => NOW, send, outOfHours: async () => false });
    expect(r.digests).toBe(1);
    expect(inserts).toContainEqual({
      table: 'notifications',
      rows: expect.objectContaining({ user_id: 'u-a', type: 'appointment_digest', title: 'Tus visitas de hoy: 1' }),
    });
  });

  it('resumen ya enviado hoy: no repite', async () => {
    const { db, inserts } = fakeDb({
      settings: ENABLED,
      digestAlreadySent: true,
      digestRows: [
        { id: 'a', assigned_agent_id: 'u-a', starts_at: new Date(2026, 9, 6, 14).toISOString(), contact: null },
      ],
    });
    const { send } = sender();
    const r = await runAppointmentCron(db, { now: () => NOW, send, outOfHours: async () => false });
    expect(r.digests).toBe(0);
    expect(inserts.filter((i) => i.table === 'notifications')).toHaveLength(0);
  });
});

describe('textos de los avisos al asesor', () => {
  it('minutesLabel', () => {
    expect(minutesLabel(60)).toBe('1 hora');
    expect(minutesLabel(40.2)).toBe('40 min');
    expect(minutesLabel(90)).toBe('1 h 30 min');
    expect(minutesLabel(120)).toBe('2 horas');
    expect(minutesLabel(0)).toBe('1 min');
  });

  it('visita próxima', () => {
    expect(
      preVisitNotice({
        contactName: 'Jorge Castro',
        startsAt: new Date(2026, 9, 7, 15),
        now: new Date(2026, 9, 7, 14),
        purpose: 'view_vehicle',
        vehicles: ['Chevrolet Tracker 2021'],
      })
    ).toEqual({ title: 'En 1 hora: Jorge Castro', body: '3:00 p. m. · Ver un carro · Chevrolet Tracker 2021' });
  });

  it('asistencia sin marcar, de hoy y de otro día', () => {
    const items = [
      { startsAt: new Date(2026, 9, 7, 15), contactName: 'Jorge Castro' },
      { startsAt: new Date(2026, 9, 7, 9), contactName: null },
    ];
    expect(attendanceNotice({ dayLabel: 'martes 7 de octubre', isToday: true, items })).toEqual({
      title: 'Tienes 2 citas de hoy sin marcar asistencia',
      body: '9:00 a. m. Cliente · 3:00 p. m. Jorge Castro',
    });
    expect(
      attendanceNotice({ dayLabel: 'martes 7 de octubre', isToday: false, items: items.slice(0, 1) }).title
    ).toBe('Tienes 1 cita del martes 7 de octubre sin marcar asistencia');
  });
});

describe('attendanceCutoff', () => {
  const agenda = { hours: DEFAULT_AGENDA_HOURS, holidayCalendar: null };
  it('antes del cierre solo cuenta los días pasados', () => {
    const now = new Date(2026, 9, 6, 17, 0); // martes, cierra 18:00
    expect(attendanceCutoff(now, agenda).getTime()).toBe(new Date(2026, 9, 6).getTime());
  });
  it('después del cierre incluye hoy', () => {
    const now = new Date(2026, 9, 6, 18, 5);
    expect(attendanceCutoff(now, agenda)).toBe(now);
  });
  it('día cerrado: usa las 18:00', () => {
    const domingo = new Date(2026, 9, 4, 19, 0);
    expect(attendanceCutoff(domingo, agenda)).toBe(domingo);
  });
});

describe('pasadas de avisos al asesor', () => {
  it('visita próxima: un aviso por cita reclamada', async () => {
    const { db, inserts, rpcs } = fakeDb({
      settings: ENABLED,
      preVisit: [appt({ starts_at: new Date(2026, 9, 6, 11, 30).toISOString(), purpose: 'test_drive' })],
    });
    const { send } = sender();
    const r = await runAppointmentCron(db, { now: () => NOW, send, outOfHours: async () => false });
    expect(rpcs.find((x) => x.fn === 'claim_due_pre_visit_alerts')?.args.p_minutes).toBe(60);
    expect(r.preVisits).toBe(1);
    expect(inserts).toContainEqual({
      table: 'notifications',
      rows: expect.objectContaining({
        type: 'appointment_pre_visit',
        user_id: 'u-a',
        title: 'En 1 hora: Jorge Castro',
      }),
    });
  });

  it('visita próxima apagada: no reclama', async () => {
    const { db, rpcs } = fakeDb({ settings: { ...ENABLED, pre_visit_alert_minutes: null } });
    const { send } = sender();
    await runAppointmentCron(db, { now: () => NOW, send, outOfHours: async () => false });
    expect(rpcs.map((x) => x.fn)).not.toContain('claim_due_pre_visit_alerts');
  });

  it('asistencia: un aviso por asesor y día, con enlace a la vista Día', async () => {
    const day = new Date(2026, 9, 5); // ayer
    const { db, inserts, rpcs } = fakeDb({
      settings: ENABLED,
      attendance: [
        appt({ id: 'a1', starts_at: new Date(2026, 9, 5, 9).toISOString() }),
        appt({ id: 'a2', starts_at: new Date(2026, 9, 5, 15).toISOString() }),
        appt({ id: 'a3', assigned_agent_id: 'u-b', starts_at: new Date(2026, 9, 5, 10).toISOString() }),
      ],
    });
    const { send } = sender();
    const r = await runAppointmentCron(db, { now: () => NOW, send, outOfHours: async () => false });
    // A las 10:30 todavía no cerró hoy: solo días pasados.
    expect(rpcs.find((x) => x.fn === 'claim_pending_attendance_reminders')?.args.p_until).toBe(
      startOfDay(NOW).toISOString()
    );
    expect(r.attendanceReminders).toBe(2);
    const notices = inserts.filter((i) => i.rows.type === 'appointment_attendance_pending');
    expect(notices).toHaveLength(2);
    expect(notices[0].rows).toMatchObject({
      user_id: 'u-a',
      appointment_id: null,
      link_path: `/agenda?vista=dia&fecha=2026-10-0${day.getDate()}`,
      title: 'Tienes 2 citas del lunes 5 de octubre sin marcar asistencia',
    });
    expect(notices[1].rows).toMatchObject({ user_id: 'u-b', appointment_id: 'a3' });
  });
});
