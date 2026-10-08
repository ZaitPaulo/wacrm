import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { handleAppointmentReply } from './customer-reply';
import { buildReminderPayload, STALE_REMINDER_REPLY_TEXT } from './messages';
import type { AppointmentSend } from './send';

const ID = '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90';
const STARTS = new Date(2026, 9, 7, 14, 0);
const NOW = new Date(2026, 9, 6, 10, 0);

/** Base falsa: una fila por tabla para `maybeSingle` y registro de escrituras. */
function fakeDb(appointment: Record<string, unknown> | null) {
  const updates: { table: string; payload: Record<string, unknown> }[] = [];
  const inserts: { table: string; rows: Record<string, unknown> }[] = [];
  const singles: Record<string, unknown> = {
    appointments: appointment,
    contacts: { name: 'Jorge Castro' },
    profiles: { full_name: 'Angélica Rodríguez' },
  };
  function chain(table: string) {
    const c: Record<string, unknown> = {};
    const self = () => c;
    Object.assign(c, {
      select: self,
      eq: self,
      maybeSingle: () => Promise.resolve({ data: singles[table] ?? null, error: null }),
      update: (payload: Record<string, unknown>) => {
        updates.push({ table, payload });
        return { eq: () => Promise.resolve({ error: null }) };
      },
      insert: (rows: Record<string, unknown>) => {
        inserts.push({ table, rows });
        return Promise.resolve({ error: null });
      },
    });
    return c;
  }
  const db = { from: (t: string) => chain(t) } as unknown as SupabaseClient;
  return { db, updates, inserts };
}

const appointmentRow = (overrides: Record<string, unknown> = {}) => ({
  id: ID,
  account_id: 'acct-1',
  contact_id: 'contact-1',
  conversation_id: 'conv-1',
  assigned_agent_id: 'u-angelica',
  starts_at: STARTS.toISOString(),
  status: 'scheduled',
  ...overrides,
});

function run(db: SupabaseClient, replyId: string | null) {
  const sent: AppointmentSend[] = [];
  const send = vi.fn(async (_db: SupabaseClient, _a: string, _c: string, m: AppointmentSend) => {
    sent.push(m);
    return { ok: true as const, messageId: 'wamid.x' };
  });
  const promise = handleAppointmentReply(
    db,
    { accountId: 'acct-1', contactId: 'contact-1', conversationId: 'conv-1', replyId },
    { send, now: () => NOW }
  );
  return { promise, sent, send };
}

describe('handleAppointmentReply', () => {
  it('ignora lo que no es un botón de cita', async () => {
    const { db } = fakeDb(appointmentRow());
    const { promise, send } = run(db, 'YES_INTERESTED');
    expect(await promise).toEqual({ consumed: false });
    expect(send).not.toHaveBeenCalled();
    expect((await run(db, null).promise).consumed).toBe(false);
  });

  it('confirmar: pasa la cita a confirmada y responde con la hora', async () => {
    const { db, updates } = fakeDb(appointmentRow());
    const { promise, sent } = run(db, buildReminderPayload(ID, 'confirmar', STARTS));
    expect(await promise).toEqual({ consumed: true, outcome: 'confirmed' });
    expect(updates[0]).toMatchObject({
      table: 'appointments',
      payload: { status: 'confirmed', customer_response: 'confirmed' },
    });
    expect(sent[0]).toMatchObject({ kind: 'text', initiative: 'reply' });
    expect(sent[0].kind === 'text' && sent[0].text).toContain('miércoles 7 de octubre a las 2:00 p. m.');
  });

  it('cambiar: registra el pedido, avisa al asesor y responde con su nombre', async () => {
    const { db, updates, inserts } = fakeDb(appointmentRow({ status: 'confirmed' }));
    const { promise, sent } = run(db, buildReminderPayload(ID, 'cambiar', STARTS));
    expect(await promise).toEqual({ consumed: true, outcome: 'change_requested' });
    expect(updates[0].payload).toMatchObject({ customer_response: 'change_requested' });
    expect(updates[0].payload).not.toHaveProperty('status');
    expect(inserts[0]).toMatchObject({
      table: 'notifications',
      rows: {
        user_id: 'u-angelica',
        type: 'appointment_change_requested',
        appointment_id: ID,
        title: 'Jorge Castro pidió cambiar su cita',
      },
    });
    expect(sent[0].kind === 'text' && sent[0].text).toContain('Angélica Rodríguez');
  });

  it('botón de un recordatorio viejo: no toca la cita', async () => {
    const { db, updates } = fakeDb(appointmentRow({ starts_at: new Date(2026, 9, 7, 16, 0).toISOString() }));
    const { promise, sent } = run(db, buildReminderPayload(ID, 'confirmar', STARTS));
    expect(await promise).toEqual({ consumed: true, outcome: 'stale' });
    expect(updates).toHaveLength(0);
    expect(sent[0]).toMatchObject({ kind: 'text', text: STALE_REMINDER_REPLY_TEXT });
  });

  it('cita cancelada: no la confirma', async () => {
    const { db, updates } = fakeDb(appointmentRow({ status: 'cancelled' }));
    const { promise } = run(db, buildReminderPayload(ID, 'confirmar', STARTS));
    expect((await promise).consumed).toBe(true);
    expect(updates).toHaveLength(0);
  });

  it('cita de otro contacto o inexistente: respuesta genérica', async () => {
    const { db, updates } = fakeDb(null);
    const { promise } = run(db, buildReminderPayload(ID, 'confirmar', STARTS));
    expect(await promise).toEqual({ consumed: true, outcome: 'stale' });
    expect(updates).toHaveLength(0);
  });

  it('payload de cita mal formado: se consume sin tocar nada', async () => {
    const { db, updates } = fakeDb(appointmentRow());
    const { promise } = run(db, 'cita:roto');
    expect(await promise).toEqual({ consumed: true, outcome: 'stale' });
    expect(updates).toHaveLength(0);
  });
});
