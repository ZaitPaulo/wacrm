import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  findContactByIdentity,
  isMessageChannel,
  resolveContactByChannel,
} from './channel-identity';

// ============================================================
// Supabase simulado.
//
// Solo tres tablas participan y cada una responde a una consulta con
// forma distinta, así que el doble se arma por tabla en vez de por
// método encadenado.
// ============================================================

interface FakeState {
  /** Filas de contact_channels: clave `${channel}:${externalId}`. */
  identities: Map<string, string>;
  /** Filas de contacts que `findExistingContact` puede encontrar. */
  contacts: { id: string; phone: string; name?: string | null }[];
  /** Fuerza un choque de unicidad en el INSERT de contacts. */
  insertConflict?: boolean;
}

interface Recorded {
  insertedContacts: Record<string, unknown>[];
  linkedIdentities: Record<string, unknown>[];
  nameUpdates: Record<string, unknown>[];
}

function fakeDb(state: FakeState) {
  const rec: Recorded = {
    insertedContacts: [],
    linkedIdentities: [],
    nameUpdates: [],
  };
  let nextId = 1;

  const db = {
    from(table: string) {
      if (table === 'contact_channels') {
        const filters: Record<string, string> = {};
        const b: Record<string, unknown> = {
          select: () => b,
          eq: (col: string, val: string) => {
            filters[col] = val;
            return b;
          },
          maybeSingle: async () => {
            const key = `${filters.channel}:${filters.external_id}`;
            const contactId = state.identities.get(key);
            return {
              data: contactId ? { contact_id: contactId } : null,
              error: null,
            };
          },
          upsert: async (row: Record<string, unknown>) => {
            rec.linkedIdentities.push(row);
            state.identities.set(
              `${row.channel}:${row.external_id}`,
              row.contact_id as string
            );
            return { error: null };
          },
        };
        return b;
      }

      // contacts
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        like: async () => ({ data: state.contacts, error: null }),
        update: (row: Record<string, unknown>) => {
          rec.nameUpdates.push(row);
          return { eq: async () => ({ error: null }) };
        },
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              if (state.insertConflict) {
                return { data: null, error: { code: '23505' } };
              }
              rec.insertedContacts.push(row);
              const id = `nuevo-${nextId++}`;
              return { data: { id }, error: null };
            },
          }),
        }),
      };
      return b;
    },
  } as unknown as SupabaseClient;

  return { db, rec, state };
}

const BASE = {
  accountId: 'acct-1',
  auditUserId: 'user-1',
} as const;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('isMessageChannel', () => {
  it('acepta los canales de la base', () => {
    expect(isMessageChannel('whatsapp')).toBe(true);
    expect(isMessageChannel('instagram')).toBe(true);
    expect(isMessageChannel('messenger')).toBe(true);
  });

  it('rechaza cualquier otra cosa', () => {
    expect(isMessageChannel('telegram')).toBe(false);
    expect(isMessageChannel(null)).toBe(false);
  });
});

describe('findContactByIdentity', () => {
  it('encuentra por identidad exacta', async () => {
    const { db } = fakeDb({
      identities: new Map([['instagram:ig-abc', 'contacto-9']]),
      contacts: [],
    });

    expect(
      await findContactByIdentity(db, 'acct-1', 'instagram', 'ig-abc')
    ).toBe('contacto-9');
  });

  it('no encuentra nada con un identificador vacío', async () => {
    const { db } = fakeDb({ identities: new Map(), contacts: [] });
    expect(
      await findContactByIdentity(db, 'acct-1', 'instagram', '')
    ).toBeNull();
  });
});

describe('resolveContactByChannel — canal sin teléfono', () => {
  it('crea el contacto sin teléfono y le registra la identidad', async () => {
    const { db, rec } = fakeDb({ identities: new Map(), contacts: [] });

    const out = await resolveContactByChannel({
      db,
      ...BASE,
      channel: 'instagram',
      externalId: 'ig-abc',
      name: 'Ana',
    });

    expect(out).toEqual({ contactId: 'nuevo-1', created: true });
    expect(rec.insertedContacts[0].phone).toBeNull();
    expect(rec.insertedContacts[0].name).toBe('Ana');
    expect(rec.linkedIdentities[0]).toMatchObject({
      channel: 'instagram',
      external_id: 'ig-abc',
      contact_id: 'nuevo-1',
    });
  });

  it('reutiliza el contacto cuando la misma persona vuelve a escribir', async () => {
    const { db, rec } = fakeDb({
      identities: new Map([['instagram:ig-abc', 'contacto-9']]),
      contacts: [],
    });

    const out = await resolveContactByChannel({
      db,
      ...BASE,
      channel: 'instagram',
      externalId: 'ig-abc',
    });

    expect(out).toEqual({ contactId: 'contacto-9', created: false });
    expect(rec.insertedContacts).toHaveLength(0);
  });

  it('NO cae al camino por teléfono en canales que no son WhatsApp', async () => {
    // Un identificador de Instagram no puede compararse con un teléfono
    // por parecido: haría coincidir personas distintas.
    const { db, rec } = fakeDb({
      identities: new Map(),
      contacts: [{ id: 'contacto-tel', phone: '573001234567' }],
    });

    const out = await resolveContactByChannel({
      db,
      ...BASE,
      channel: 'instagram',
      externalId: '573001234567',
    });

    expect(out?.created).toBe(true);
    expect(out?.contactId).not.toBe('contacto-tel');
    expect(rec.insertedContacts).toHaveLength(1);
  });

  it('usa el identificador como nombre cuando la plataforma no manda uno', async () => {
    const { db, rec } = fakeDb({ identities: new Map(), contacts: [] });

    await resolveContactByChannel({
      db,
      ...BASE,
      channel: 'messenger',
      externalId: 'msgr-77',
    });

    expect(rec.insertedContacts[0].name).toBe('msgr-77');
  });
});

describe('resolveContactByChannel — WhatsApp se comporta igual que antes', () => {
  it('crea el contacto con su teléfono', async () => {
    const { db, rec } = fakeDb({ identities: new Map(), contacts: [] });

    await resolveContactByChannel({
      db,
      ...BASE,
      channel: 'whatsapp',
      externalId: '573001234567',
      name: 'Carlos',
    });

    expect(rec.insertedContacts[0].phone).toBe('573001234567');
    expect(rec.insertedContacts[0].name).toBe('Carlos');
  });

  it('conserva la tolerancia a prefijos troncales', async () => {
    // El contacto está guardado con el 0 de tronco y el mensaje llega
    // sin él. Antes de este módulo `phonesMatch` los unía; si la
    // resolución fuera solo por identidad exacta, acá nacería un
    // contacto duplicado.
    const { db, rec } = fakeDb({
      identities: new Map(),
      contacts: [{ id: 'contacto-viejo', phone: '370063949836' }],
    });

    const out = await resolveContactByChannel({
      db,
      ...BASE,
      channel: 'whatsapp',
      externalId: '37063949836',
    });

    expect(out).toEqual({ contactId: 'contacto-viejo', created: false });
    expect(rec.insertedContacts).toHaveLength(0);
  });

  it('al reconocerlo por teléfono le registra la identidad que faltaba', async () => {
    const { db, rec } = fakeDb({
      identities: new Map(),
      contacts: [{ id: 'contacto-viejo', phone: '573001234567' }],
    });

    await resolveContactByChannel({
      db,
      ...BASE,
      channel: 'whatsapp',
      externalId: '573001234567',
    });

    expect(rec.linkedIdentities[0]).toMatchObject({
      contact_id: 'contacto-viejo',
      channel: 'whatsapp',
      external_id: '573001234567',
    });
  });

  it('actualiza el nombre cuando la plataforma informa uno distinto', async () => {
    const { db, rec } = fakeDb({
      identities: new Map(),
      contacts: [
        { id: 'contacto-viejo', phone: '573001234567', name: 'Viejo' },
      ],
    });

    await resolveContactByChannel({
      db,
      ...BASE,
      channel: 'whatsapp',
      externalId: '573001234567',
      name: 'Nombre Nuevo',
    });

    expect(rec.nameUpdates[0]).toMatchObject({ name: 'Nombre Nuevo' });
  });

  it('no escribe el nombre si no cambió', async () => {
    const { db, rec } = fakeDb({
      identities: new Map(),
      contacts: [
        { id: 'contacto-viejo', phone: '573001234567', name: 'Igual' },
      ],
    });

    await resolveContactByChannel({
      db,
      ...BASE,
      channel: 'whatsapp',
      externalId: '573001234567',
      name: 'Igual',
    });

    expect(rec.nameUpdates).toHaveLength(0);
  });
});

describe('resolveContactByChannel — carreras', () => {
  it('re-resuelve por identidad cuando el insert choca', async () => {
    const state: FakeState = {
      identities: new Map(),
      contacts: [],
      insertConflict: true,
    };
    const { db } = fakeDb(state);

    // La otra petición gana la carrera justo antes de nuestro insert.
    state.identities.set('instagram:ig-abc', 'contacto-ganador');

    const out = await resolveContactByChannel({
      db,
      ...BASE,
      channel: 'instagram',
      externalId: 'ig-abc',
    });

    expect(out).toEqual({ contactId: 'contacto-ganador', created: false });
  });

  it('devuelve null si el choque no se puede resolver', async () => {
    const { db } = fakeDb({
      identities: new Map(),
      contacts: [],
      insertConflict: true,
    });

    expect(
      await resolveContactByChannel({
        db,
        ...BASE,
        channel: 'instagram',
        externalId: 'ig-abc',
      })
    ).toBeNull();
  });
});

describe('el mismo identificador en dos cuentas', () => {
  it('no alcanza el contacto de la otra cuenta', async () => {
    // La consulta filtra por account_id; el doble devuelve solo lo que
    // esa cuenta tiene registrado. Sin identidad en esta cuenta, se
    // crea una ficha propia.
    const { db, rec } = fakeDb({ identities: new Map(), contacts: [] });

    const out = await resolveContactByChannel({
      db,
      accountId: 'acct-2',
      auditUserId: 'user-2',
      channel: 'instagram',
      externalId: 'ig-abc',
    });

    expect(out?.created).toBe(true);
    expect(rec.insertedContacts[0].account_id).toBe('acct-2');
  });
});
