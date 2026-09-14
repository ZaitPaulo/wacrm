import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const gate = vi.hoisted(() => ({
  fueraDeHorario: vi.fn<(db: unknown, cuenta: string) => Promise<boolean>>(
    async () => false
  ),
  resolveRecipientId: vi.fn(
    async (...[, , contacto]: [unknown, string, string, string]) => ({
      ok: true as const,
      recipientId: `57300${contacto}`,
    })
  ),
}));
const core = vi.hoisted(() => ({
  sendTemplateWithVariants: vi.fn<
    (t: { recipientId: string }) => Promise<{ ok: true; messageId: string }>
  >(async () => ({ ok: true, messageId: 'wamid.1' })),
}));
const templates = vi.hoisted(() => ({
  resolveTemplateRow: vi.fn(async () => ({
    row: { body_text: 'Seguimos atentos' },
    malformed: false,
    language: 'es_CO',
  })),
}));

vi.mock('@/lib/outbound/gate', () => gate);
vi.mock('@/lib/whatsapp/broadcast-core', () => core);
vi.mock('@/lib/whatsapp/template-body', () => templates);
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: () => 'token-plano' }));

import { runBroadcastFollowUps } from './broadcast-follow-up';

interface Reclamado {
  recipient_id: string;
  broadcast_id: string;
  account_id: string;
  contact_id: string;
  template_params: unknown;
  template_name: string;
  template_language: string | null;
}

function reclamado(id: string, extra: Partial<Reclamado> = {}): Reclamado {
  return {
    recipient_id: id,
    broadcast_id: 'b-1',
    account_id: 'acc-1',
    contact_id: `c-${id}`,
    template_params: ['Mazda 2'],
    template_name: 'recordatorio_consulta_vehiculo',
    template_language: 'es_CO',
    ...extra,
  };
}

/** Supabase falso: las difusiones con seguimiento, el reclamo y lo que se escribe. */
function fakeDb(opts: { cuentas: string[]; reclamados: Reclamado[] }) {
  const rpc = vi.fn<
    (name: string, args: unknown) => Promise<{ data: Reclamado[]; error: null }>
  >(async () => ({ data: opts.reclamados, error: null }));
  const updates: { id: string; values: Record<string, unknown> }[] = [];

  const db = {
    rpc,
    from(table: string) {
      if (table === 'broadcasts') {
        const chain = {
          select: () => chain,
          not: () => chain,
          is: () =>
            Promise.resolve({
              data: opts.cuentas.map((account_id) => ({ account_id })),
              error: null,
            }),
        };
        return chain;
      }
      if (table === 'whatsapp_config') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () =>
            Promise.resolve({
              data: { phone_number_id: 'pn-1', access_token: 'cifrado' },
              error: null,
            }),
        };
        return chain;
      }
      if (table === 'broadcast_recipients') {
        return {
          update: (values: Record<string, unknown>) => ({
            eq: (_col: string, id: string) => {
              updates.push({ id, values });
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      throw new Error(`tabla inesperada: ${table}`);
    },
  } as unknown as SupabaseClient;

  return { db, rpc, updates };
}

const sinEsperas = { sleep: async () => {} };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runBroadcastFollowUps — horario de atención', () => {
  it('solo reclama lo de las cuentas que están en horario', async () => {
    gate.fueraDeHorario.mockImplementation(async (_db, cuenta) => cuenta === 'acc-2');
    const { db, rpc } = fakeDb({ cuentas: ['acc-1', 'acc-2'], reclamados: [] });

    await runBroadcastFollowUps(db, sinEsperas);

    expect(rpc).toHaveBeenCalledWith('claim_due_broadcast_follow_ups', {
      p_account_ids: ['acc-1'],
      p_limit: 100,
    });
  });

  it('con todas las cuentas fuera de horario no reclama nada', async () => {
    gate.fueraDeHorario.mockImplementation(async () => true);
    const { db, rpc } = fakeDb({ cuentas: ['acc-1'], reclamados: [reclamado('r1')] });

    const res = await runBroadcastFollowUps(db, sinEsperas);

    expect(rpc).not.toHaveBeenCalled();
    expect(res).toEqual({ claimed: 0, sent: 0, failed: 0 });
  });
});

describe('runBroadcastFollowUps — envío', () => {
  beforeEach(() => {
    gate.fueraDeHorario.mockImplementation(async () => false);
  });

  it('resuelve el destino en el momento y marca el recordatorio enviado', async () => {
    const { db, updates } = fakeDb({ cuentas: ['acc-1'], reclamados: [reclamado('r1')] });

    const res = await runBroadcastFollowUps(db, sinEsperas);

    expect(gate.resolveRecipientId).toHaveBeenCalledWith(db, 'acc-1', 'c-r1', 'whatsapp');
    expect(core.sendTemplateWithVariants).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: '57300c-r1',
        templateName: 'recordatorio_consulta_vehiculo',
        language: 'es_CO',
        accessToken: 'token-plano',
      })
    );
    expect(updates).toEqual([
      {
        id: 'r1',
        values: expect.objectContaining({
          follow_up_status: 'sent',
          follow_up_message_id: 'wamid.1',
          follow_up_error: null,
        }),
      },
    ]);
    expect(res).toEqual({ claimed: 1, sent: 1, failed: 0 });
  });

  it('sin variables en el recordatorio no manda los valores del original', async () => {
    const { db } = fakeDb({ cuentas: ['acc-1'], reclamados: [reclamado('r1')] });

    await runBroadcastFollowUps(db, sinEsperas);

    expect(core.sendTemplateWithVariants).toHaveBeenCalledWith(
      expect.objectContaining({ params: [] })
    );
  });

  it('con variables en el recordatorio reutiliza los valores congelados', async () => {
    templates.resolveTemplateRow.mockResolvedValueOnce({
      row: { body_text: '¿Tu {{1}} sigue disponible?' },
      malformed: false,
      language: 'es_CO',
    });
    const { db } = fakeDb({ cuentas: ['acc-1'], reclamados: [reclamado('r1')] });

    await runBroadcastFollowUps(db, sinEsperas);

    expect(core.sendTemplateWithVariants).toHaveBeenCalledWith(
      expect.objectContaining({ params: ['Mazda 2'] })
    );
  });

  it('un rechazo de Meta queda en su fila y la pasada sigue con los demás', async () => {
    core.sendTemplateWithVariants
      .mockResolvedValueOnce({ ok: false, error: 'Template not approved' } as never)
      .mockResolvedValueOnce({ ok: true, messageId: 'wamid.2' });
    const { db, updates } = fakeDb({
      cuentas: ['acc-1'],
      reclamados: [reclamado('r1'), reclamado('r2')],
    });

    const res = await runBroadcastFollowUps(db, sinEsperas);

    expect(updates[0]).toEqual({
      id: 'r1',
      values: { follow_up_status: 'failed', follow_up_error: 'Template not approved' },
    });
    expect(updates[1]).toMatchObject({ id: 'r2', values: { follow_up_status: 'sent' } });
    expect(res).toEqual({ claimed: 2, sent: 1, failed: 1 });
  });

  it('un contacto sin destino alcanzable queda fallido sin intentar el envío', async () => {
    gate.resolveRecipientId.mockResolvedValueOnce({
      ok: false,
      reason: 'no_recipient',
    } as never);
    const { db, updates } = fakeDb({ cuentas: ['acc-1'], reclamados: [reclamado('r1')] });

    await runBroadcastFollowUps(db, sinEsperas);

    expect(core.sendTemplateWithVariants).not.toHaveBeenCalled();
    expect(updates[0].values).toMatchObject({
      follow_up_status: 'failed',
      follow_up_error: expect.stringContaining('no_recipient'),
    });
  });

  it('si la plantilla ya no existe en la cuenta, falla con un motivo claro', async () => {
    templates.resolveTemplateRow.mockResolvedValueOnce({
      row: null,
      malformed: false,
      language: 'es_CO',
    } as never);
    const { db, updates } = fakeDb({ cuentas: ['acc-1'], reclamados: [reclamado('r1')] });

    await runBroadcastFollowUps(db, sinEsperas);

    expect(core.sendTemplateWithVariants).not.toHaveBeenCalled();
    expect(updates[0].values).toMatchObject({
      follow_up_status: 'failed',
      follow_up_error: expect.stringContaining('recordatorio_consulta_vehiculo'),
    });
  });

  it('pausa entre tandas de diez', async () => {
    const sleep = vi.fn(async () => {});
    const reclamados = Array.from({ length: 25 }, (_, i) => reclamado(`r${i}`));
    const { db } = fakeDb({ cuentas: ['acc-1'], reclamados });

    await runBroadcastFollowUps(db, { sleep });

    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });
});
