import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { isSendableChannel, resolveOutboundTarget } from './gate';

interface FakeRows {
  conversation?: {
    id: string;
    contact_id: string;
    channel: string;
  } | null;
  contact?: { id: string; phone: string | null } | null;
  /**
   * Identidades del contacto en el canal. Son VARIAS a propósito: un
   * contacto de WhatsApp puede tener su teléfono y su BSUID, y la
   * puerta tiene que elegir bien entre los dos.
   */
  identities?: { external_id: string }[] | null;
  /** Último mensaje del cliente. Por defecto, recién llegado. */
  lastInbound?: { created_at: string } | null;
  /** Horario de atención de la cuenta. Por defecto, apagado. */
  account?: {
    quiet_hours_enabled: boolean;
    business_hours: unknown;
  } | null;
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
        // Las identidades se leen en LISTA, no con maybeSingle: con dos
        // filas del mismo canal, maybeSingle da error.
        returns: async () => ({ data: rows.identities ?? [], error: null }),
        maybeSingle: async () => {
          if (table === 'conversations') {
            return { data: rows.conversation ?? null, error: null };
          }
          if (table === 'contacts') {
            return { data: rows.contact ?? null, error: null };
          }
          if (table === 'accounts') {
            return {
              data: rows.account ?? {
                quiet_hours_enabled: false,
                business_hours: {},
              },
              error: null,
            };
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
      initiative: 'reply',
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

    await resolveOutboundTarget(db, 'acct-1', 'cv-1', { senderKind: 'human', initiative: 'reply' });

    expect(touched).toContain('contacts');
    expect(touched).not.toContain('contact_channels');
  });

  it('rechaza un canal que todavía no sabe enviar', async () => {
    const { db, touched } = fakeDb({
      conversation: { id: 'cv-2', contact_id: 'ct-1', channel: 'instagram' },
      identities: [{ external_id: 'ig-abc' }],
    });

    const out = await resolveOutboundTarget(db, 'acct-1', 'cv-2', {
      senderKind: 'human',
      initiative: 'reply',
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
      initiative: 'reply',
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
      initiative: 'reply',
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
      initiative: 'reply',
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
      initiative: 'reply',
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
      initiative: 'reply',
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
      initiative: 'reply',
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
      initiative: 'reply',
    });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.target.humanAgentTag).toBe(false);
  });
});

// ============================================================
// Destinatarios sin teléfono (openspec/changes/identidad-bsuid-whatsapp).
//
// Desde que WhatsApp tiene nombres de usuario hay personas de las que
// nunca vamos a recibir el número. Para ellas la identidad de canal es
// el único camino de salida: sin este respaldo entrarían a la bandeja
// sin que nadie pudiera contestarles.
// ============================================================

const BSUID = 'CO.4481978948757066';

describe('resolveOutboundTarget — WhatsApp sin teléfono', () => {
  it('cae al BSUID cuando el contacto no tiene número', async () => {
    const { db, touched } = fakeDb({
      conversation: CONV_WHATSAPP,
      contact: { id: 'ct-1', phone: null },
      identities: [{ external_id: BSUID }],
    });

    const out = await resolveOutboundTarget(db, 'acct-1', 'cv-1', {
      senderKind: 'human',
      initiative: 'reply',
    });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.target.recipientId).toBe(BSUID);
    expect(touched).toContain('contact_channels');
  });

  it('elige el BSUID y no un teléfono viejo guardado como identidad', async () => {
    // Un contacto identificado tiene DOS filas: su teléfono y su BSUID.
    // Si `contacts.phone` está vacío, ese teléfono de `contact_channels`
    // es un dato viejo, no un destino — mandarle ahí fallaría.
    const { db } = fakeDb({
      conversation: CONV_WHATSAPP,
      contact: { id: 'ct-1', phone: null },
      identities: [{ external_id: '573166220262' }, { external_id: BSUID }],
    });

    const out = await resolveOutboundTarget(db, 'acct-1', 'cv-1', {
      senderKind: 'human',
      initiative: 'reply',
    });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.target.recipientId).toBe(BSUID);
  });

  it('dos identidades no rompen la consulta', async () => {
    // Con `.maybeSingle()` esto daba error: el envío fallaba justo para
    // los contactos MEJOR identificados.
    const { db } = fakeDb({
      conversation: CONV_WHATSAPP,
      contact: { id: 'ct-1', phone: null },
      identities: [{ external_id: BSUID }, { external_id: '573166220262' }],
    });

    const out = await resolveOutboundTarget(db, 'acct-1', 'cv-1', {
      senderKind: 'human',
      initiative: 'reply',
    });

    expect(out.ok).toBe(true);
  });

  it('el teléfono sigue teniendo prioridad cuando existe', async () => {
    const { db, touched } = fakeDb({
      conversation: CONV_WHATSAPP,
      contact: { id: 'ct-1', phone: '+15551234567' },
      identities: [{ external_id: BSUID }],
    });

    const out = await resolveOutboundTarget(db, 'acct-1', 'cv-1', {
      senderKind: 'human',
      initiative: 'reply',
    });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.target.recipientId).toBe('15551234567');
    // Ni siquiera se consulta: el teléfono editable es la fuente.
    expect(touched).not.toContain('contact_channels');
  });

  it('sin teléfono y sin identidades, no hay a quién escribirle', async () => {
    const { db } = fakeDb({
      conversation: CONV_WHATSAPP,
      contact: { id: 'ct-1', phone: null },
      identities: [],
    });

    const out = await resolveOutboundTarget(db, 'acct-1', 'cv-1', {
      senderKind: 'human',
      initiative: 'reply',
    });

    expect(out).toEqual({ ok: false, reason: 'no_recipient' });
  });
});

// ============================================================
// Horario de atención.
//
// La regla, en una línea: RESPONDER siempre; ESCRIBIR por iniciativa
// propia, solo en horario.
// ============================================================

const HORARIO_LORAMOTORS = {
  quiet_hours_enabled: true,
  business_hours: {
    sun: null,
    mon: ['08:00', '18:00'],
    tue: ['08:00', '18:00'],
    wed: ['08:00', '18:00'],
    thu: ['08:00', '18:00'],
    fri: ['08:00', '18:00'],
    sat: ['08:00', '14:00'],
  },
};

describe('resolveOutboundTarget — horario de atención', () => {
  const enHorario = () => {
    // Martes 10:00 en el reloj del proceso.
    vi.setSystemTime(new Date('2026-09-08T10:00:00'));
  };
  const deMadrugada = () => {
    vi.setSystemTime(new Date('2026-09-09T03:00:00'));
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const puerta = (account: unknown, opts: Record<string, unknown>) =>
    resolveOutboundTarget(
      fakeDb({
        conversation: CONV_WHATSAPP,
        contact: { id: 'ct-1', phone: '+15551234567' },
        account: account as never,
        lastInbound: { created_at: new Date().toISOString() },
      }).db,
      'acct-1',
      'cv-1',
      opts as never,
    );

  it('DE MADRUGADA, una respuesta SÍ sale', async () => {
    // El caso que no se puede romper. Si un cliente escribe a las 3 de
    // la mañana es porque espera respuesta, y callarse sería peor que
    // contestar.
    deMadrugada();
    const out = await puerta(HORARIO_LORAMOTORS, {
      senderKind: 'automated',
      initiative: 'reply',
    });
    expect(out.ok).toBe(true);
  });

  it('DE MADRUGADA, un envío por iniciativa propia NO sale', async () => {
    deMadrugada();
    const out = await puerta(HORARIO_LORAMOTORS, {
      senderKind: 'automated',
      initiative: 'unprompted',
    });
    expect(out).toEqual({ ok: false, reason: 'quiet_hours' });
  });

  it('EN HORARIO, el envío por iniciativa propia sale normal', async () => {
    enHorario();
    const out = await puerta(HORARIO_LORAMOTORS, {
      senderKind: 'automated',
      initiative: 'unprompted',
    });
    expect(out.ok).toBe(true);
  });

  it('una persona puede escribir a cualquier hora', async () => {
    // El freno es para lo automático. Si un asesor decide escribir a
    // las 3 de la mañana, es su decisión.
    deMadrugada();
    const out = await puerta(HORARIO_LORAMOTORS, {
      senderKind: 'human',
      initiative: 'unprompted',
    });
    expect(out.ok).toBe(true);
  });

  it('con el horario apagado no frena nada', async () => {
    deMadrugada();
    const out = await puerta(
      { quiet_hours_enabled: false, business_hours: {} },
      { senderKind: 'automated', initiative: 'unprompted' },
    );
    expect(out.ok).toBe(true);
  });

  it('el domingo a mediodía tampoco sale', async () => {
    vi.setSystemTime(new Date('2026-09-13T12:00:00'));
    const out = await puerta(HORARIO_LORAMOTORS, {
      senderKind: 'automated',
      initiative: 'unprompted',
    });
    expect(out).toEqual({ ok: false, reason: 'quiet_hours' });
  });
});
