import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { isSendableChannel, resolveOutboundTarget } from './gate';

interface FakeRows {
  conversation?: {
    id: string;
    contact_id: string;
    channel: string;
  } | null;
  contact?: { id: string; phone: string | null } | null;
  identity?: { external_id: string } | null;
  /** Último mensaje del cliente. Por defecto, recién llegado. */
  lastInbound?: { created_at: string } | null;
}

/**
 * Doble de Supabase para las tres consultas que hace la puerta: la
 * conversación, el contacto (WhatsApp) y la identidad de canal (el
 * resto). Registra qué tablas se tocaron, que es la forma de verificar
 * que no se consulta lo que no corresponde.
 */
function fakeDb(rows: FakeRows) {
  const touched: string[] = [];

  const db = {
    from(table: string) {
      touched.push(table);
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        order: () => b,
        // La puerta lee el último mensaje entrante para evaluar la
        // ventana: select().eq().eq().order().limit()
        limit: async () => ({
          data:
            rows.lastInbound === null
              ? []
              : [rows.lastInbound ?? { created_at: new Date().toISOString() }],
          error: null,
        }),
        maybeSingle: async () => {
          if (table === 'conversations') {
            return { data: rows.conversation ?? null, error: null };
          }
          if (table === 'contacts') {
            return { data: rows.contact ?? null, error: null };
          }
          if (table === 'contact_channels') {
            return { data: rows.identity ?? null, error: null };
          }
          return { data: null, error: null };
        },
      };
      return b;
    },
  } as unknown as SupabaseClient;

  return { db, touched };
}

const CONV_WHATSAPP = {
  id: 'cv-1',
  contact_id: 'ct-1',
  channel: 'whatsapp',
};

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('resolveOutboundTarget — el canal sale de la conversación', () => {
  it('resuelve un hilo de WhatsApp con el teléfono saneado', async () => {
    const { db } = fakeDb({
      conversation: CONV_WHATSAPP,
      contact: { id: 'ct-1', phone: '+1 555 123 4567' },
    });

    const out = await resolveOutboundTarget(db, 'acct-1', 'cv-1', {
      senderKind: 'human',
    });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.target.channel).toBe('whatsapp');
    // `sanitizePhoneForMeta` deja solo dígitos: se va el '+' y los
    // espacios. Es la forma exacta que los tres caminos de envío ya le
    // mandaban a Meta antes de que existiera la puerta.
    expect(out.target.recipientId).toBe('15551234567');
    expect(out.target.contactId).toBe('ct-1');
  });

  it('no consulta la identidad de canal cuando el hilo es de WhatsApp', async () => {
    // El teléfono editable sigue siendo la fuente para escribirle;
    // contact_channels existe para RECONOCER a quien escribe.
    const { db, touched } = fakeDb({
      conversation: CONV_WHATSAPP,
      contact: { id: 'ct-1', phone: '+15551234567' },
    });

    await resolveOutboundTarget(db, 'acct-1', 'cv-1', { senderKind: 'human' });

    expect(touched).toContain('contacts');
    expect(touched).not.toContain('contact_channels');
  });

  it('rechaza un canal que todavía no sabe enviar', async () => {
    const { db, touched } = fakeDb({
      conversation: { id: 'cv-2', contact_id: 'ct-1', channel: 'instagram' },
      identity: { external_id: 'ig-abc' },
    });

    const out = await resolveOutboundTarget(db, 'acct-1', 'cv-2', {
      senderKind: 'human',
    });

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe('channel_unsupported');
    // Se corta ANTES de resolver destinatario: no tiene sentido buscar
    // a quién hablarle por un canal que no puede hablar.
    expect(touched).not.toContain('contact_channels');
  });
});

describe('resolveOutboundTarget — lo que impide enviar', () => {
  it('informa cuando la conversación no existe en la cuenta', async () => {
    const { db } = fakeDb({ conversation: null });

    const out = await resolveOutboundTarget(db, 'acct-1', 'cv-ajena', {
      senderKind: 'human',
    });

    expect(out).toEqual({ ok: false, reason: 'conversation_not_found' });
  });

  it('informa cuando el contacto no tiene teléfono', async () => {
    // Desde la 513 un contacto puede no tenerlo: llegó por otro canal.
    const { db } = fakeDb({
      conversation: CONV_WHATSAPP,
      contact: { id: 'ct-1', phone: null },
    });

    const out = await resolveOutboundTarget(db, 'acct-1', 'cv-1', {
      senderKind: 'human',
    });

    expect(out).toEqual({ ok: false, reason: 'no_recipient' });
  });

  it('distingue un teléfono mal formado de uno ausente', async () => {
    const { db } = fakeDb({
      conversation: CONV_WHATSAPP,
      contact: { id: 'ct-1', phone: '123' },
    });

    const out = await resolveOutboundTarget(db, 'acct-1', 'cv-1', {
      senderKind: 'human',
    });

    expect(out).toEqual({ ok: false, reason: 'invalid_recipient' });
  });
});

describe('isSendableChannel', () => {
  it('WhatsApp puede enviar', () => {
    expect(isSendableChannel('whatsapp')).toBe(true);
  });

  it('Instagram y Messenger todavía no', () => {
    expect(isSendableChannel('instagram')).toBe(false);
    expect(isSendableChannel('messenger')).toBe(false);
  });
});

describe('la puerta también decide la ventana', () => {
  const hace = (horas: number) =>
    new Date(Date.now() - horas * 60 * 60 * 1000).toISOString();

  it('bloquea un envío tardío de WhatsApp y ofrece la plantilla', async () => {
    const { db } = fakeDb({
      conversation: CONV_WHATSAPP,
      contact: { id: 'ct-1', phone: '+15551234567' },
      lastInbound: { created_at: hace(30) },
    });

    const out = await resolveOutboundTarget(db, 'acct-1', 'cv-1', {
      senderKind: 'human',
    });

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe('outside_window');
    expect(out.alternative).toBe('template');
  });

  it('deja pasar esa misma plantilla', async () => {
    const { db } = fakeDb({
      conversation: CONV_WHATSAPP,
      contact: { id: 'ct-1', phone: '+15551234567' },
      lastInbound: { created_at: hace(30) },
    });

    const out = await resolveOutboundTarget(db, 'acct-1', 'cv-1', {
      senderKind: 'human',
      isTemplate: true,
    });

    expect(out.ok).toBe(true);
  });

  it('un hilo sin mensajes del cliente tiene la ventana cerrada', async () => {
    const { db } = fakeDb({
      conversation: CONV_WHATSAPP,
      contact: { id: 'ct-1', phone: '+15551234567' },
      lastInbound: null,
    });

    const out = await resolveOutboundTarget(db, 'acct-1', 'cv-1', {
      senderKind: 'human',
    });

    expect(out.ok).toBe(false);
  });

  it('un envío dentro de ventana no lleva la etiqueta de atención humana', async () => {
    const { db } = fakeDb({
      conversation: CONV_WHATSAPP,
      contact: { id: 'ct-1', phone: '+15551234567' },
      lastInbound: { created_at: hace(2) },
    });

    const out = await resolveOutboundTarget(db, 'acct-1', 'cv-1', {
      senderKind: 'human',
    });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.target.humanAgentTag).toBe(false);
  });
});
