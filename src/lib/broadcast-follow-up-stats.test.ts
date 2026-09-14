import { describe, it, expect } from 'vitest';
import { summarizeFollowUp, summarizeNoReply } from './broadcast-follow-up-stats';

describe('summarizeNoReply', () => {
  const sesenta = { no_reply_hide_after_days: 60, follow_up_cancelled_at: null };
  const base = {
    status: 'read' as const,
    sent_at: '2026-09-14T12:00:00Z',
    created_at: '2026-09-14T12:00:00Z',
    no_reply_checked_at: null,
    no_reply_hidden_count: null,
  };

  it('cuenta pendientes y la fecha del primer vencimiento, desde el envío original', () => {
    const stats = summarizeNoReply(
      [base, { ...base, sent_at: '2026-09-15T12:00:00Z' }],
      sesenta
    );

    expect(stats.pending).toBe(2);
    expect(stats.dueAt?.toISOString()).toBe('2026-11-13T12:00:00.000Z');
  });

  it('suma los vehículos ocultados de los ya revisados', () => {
    const stats = summarizeNoReply(
      [
        { ...base, no_reply_checked_at: '2026-11-13T12:05:00Z', no_reply_hidden_count: 2 },
        { ...base, no_reply_checked_at: '2026-11-13T12:05:00Z', no_reply_hidden_count: 0 },
      ],
      sesenta
    );

    expect(stats).toEqual({ pending: 0, checked: 2, hiddenVehicles: 2, dueAt: null });
  });

  it('quien respondió o falló nunca queda pendiente', () => {
    const stats = summarizeNoReply(
      [{ ...base, status: 'replied' }, { ...base, status: 'failed' }],
      sesenta
    );

    expect(stats.pending).toBe(0);
  });

  it('cancelado, no queda nada pendiente', () => {
    const stats = summarizeNoReply([base], {
      no_reply_hide_after_days: 60,
      follow_up_cancelled_at: '2026-10-01T00:00:00Z',
    });

    expect(stats).toMatchObject({ pending: 0, dueAt: null });
  });
});

const AHORA = new Date('2026-09-17T12:00:00Z');
const HACE_3_DIAS = '2026-09-14T12:00:00Z';
const HACE_1_DIA = '2026-09-16T12:00:00Z';

type Fila = Parameters<typeof summarizeFollowUp>[0][number];

function fila(extra: Partial<Fila>): Fila {
  return {
    status: 'read',
    sent_at: HACE_3_DIAS,
    replied_at: undefined,
    created_at: HACE_3_DIAS,
    follow_up_status: null,
    follow_up_sent_at: null,
    ...extra,
  };
}

const plazo48 = { follow_up_delay_hours: 48, follow_up_cancelled_at: null };

describe('summarizeFollowUp', () => {
  it('cuenta pendientes y, de esos, los vencidos', () => {
    const stats = summarizeFollowUp(
      [fila({ sent_at: HACE_3_DIAS }), fila({ sent_at: HACE_1_DIA })],
      plazo48,
      AHORA
    );

    expect(stats).toMatchObject({ pending: 2, overdue: 1 });
  });

  it('un respondido o un fallido en el original nunca queda pendiente', () => {
    const stats = summarizeFollowUp(
      [fila({ status: 'replied' }), fila({ status: 'failed' }), fila({ status: 'pending' })],
      plazo48,
      AHORA
    );

    expect(stats.pending).toBe(0);
  });

  it('cuenta como respuesta al recordatorio solo la que llegó después de él', () => {
    const stats = summarizeFollowUp(
      [
        fila({
          status: 'replied',
          follow_up_status: 'sent',
          follow_up_sent_at: '2026-09-16T12:00:00Z',
          replied_at: '2026-09-16T15:00:00Z',
        }),
        fila({ follow_up_status: 'sent', follow_up_sent_at: '2026-09-16T12:00:00Z' }),
      ],
      plazo48,
      AHORA
    );

    expect(stats).toMatchObject({ sent: 2, repliedAfter: 1, pending: 0 });
  });

  it('separa fallidos, omitidos y los que están saliendo', () => {
    const stats = summarizeFollowUp(
      [
        fila({ follow_up_status: 'failed' }),
        fila({ follow_up_status: 'skipped' }),
        fila({ follow_up_status: 'sending' }),
      ],
      plazo48,
      AHORA
    );

    expect(stats).toMatchObject({ failed: 1, skipped: 1, pending: 1, overdue: 0 });
  });

  it('cancelado, lo que no salió deja de estar pendiente', () => {
    const stats = summarizeFollowUp(
      [fila({}), fila({ follow_up_status: 'sent', follow_up_sent_at: HACE_1_DIA })],
      { follow_up_delay_hours: 48, follow_up_cancelled_at: HACE_1_DIA },
      AHORA
    );

    expect(stats).toMatchObject({ pending: 0, overdue: 0, sent: 1 });
  });
});
