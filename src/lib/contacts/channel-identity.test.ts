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
  usernameUpdates: Record<string, unknown>[];
}

function fakeDb(state: FakeState) {
  const rec: Recorded = {
    insertedContacts: [],
    linkedIdentities: [],
    nameUpdates: [],
    usernameUpdates: [],
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
          // refreshUsername: update().eq(cuenta).eq(contacto).eq(canal)
          update: (row: Record<string, unknown>) => {
            rec.usernameUpdates.push(row);
            const chain: Record<string, unknown> = {
              eq: () => chain,
              then: (resolve: (v: unknown) => unknown) =>
                resolve({ error: null }),
            };
            return chain;
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

// ============================================================
// Identidad por BSUID (openspec/changes/identidad-bsuid-whatsapp).
//
// WhatsApp dejó de entregar el teléfono de quien adopta un nombre de
// usuario: manda un identificador con alcance de negocio con la forma
// `CO.4481978948757066`. Hasta que se contempló, esos mensajes se
// descartaban en silencio.
// ============================================================

const BSUID = 'CO.4481978948757066';
const OTRO_BSUID = 'CO.9999888877776666';

describe('resolveContactByChannel — WhatsApp sin teléfono', () => {
  it('crea el contacto con el BSUID como identidad y SIN teléfono', async () => {
    const { db, rec } = fakeDb({ identities: new Map(), contacts: [] });

    const out = await resolveContactByChannel({
      db,
      ...BASE,
      channel: 'whatsapp',
      externalId: BSUID,
      name: 'HumbertoR',
    });

    expect(out).toEqual({ contactId: 'nuevo-1', created: true });
    // Lo esencial: el BSUID NO puede terminar en la columna del
    // teléfono, donde lo verían la ficha, la exportación y el índice
    // único de teléfonos.
    expect(rec.insertedContacts[0]).toMatchObject({
      phone: null,
      name: 'HumbertoR',
    });
    expect(rec.linkedIdentities).toContainEqual(
      expect.objectContaining({ channel: 'whatsapp', external_id: BSUID })
    );
  });

  it('reconoce a la misma persona cuando vuelve a escribir', async () => {
    const { db, rec } = fakeDb({
      identities: new Map([[`whatsapp:${BSUID}`, 'contacto-7']]),
      contacts: [],
    });

    const out = await resolveContactByChannel({
      db,
      ...BASE,
      channel: 'whatsapp',
      externalId: BSUID,
      name: 'HumbertoR',
    });

    expect(out).toEqual({ contactId: 'contacto-7', created: false });
    expect(rec.insertedContacts).toHaveLength(0);
  });

  it('NO compara un BSUID contra teléfonos por sus dígitos', async () => {
    // El respaldo difuso compara los últimos ocho dígitos para tolerar
    // prefijos troncales. Si corriera sobre un BSUID, estos dígitos
    // harían coincidir a dos personas que no tienen nada que ver — y un
    // historial fusionado no se separa solo.
    const { db, rec } = fakeDb({
      identities: new Map(),
      contacts: [{ id: 'otra-persona', phone: '573248757066' }],
    });

    const out = await resolveContactByChannel({
      db,
      ...BASE,
      channel: 'whatsapp',
      externalId: BSUID,
      name: 'HumbertoR',
    });

    expect(out?.contactId).not.toBe('otra-persona');
    expect(out?.created).toBe(true);
    expect(rec.insertedContacts[0]).toMatchObject({ phone: null });
  });

  it('dos BSUID distintos son dos contactos', async () => {
    const { db } = fakeDb({
      identities: new Map([[`whatsapp:${BSUID}`, 'contacto-7']]),
      contacts: [],
    });

    const out = await resolveContactByChannel({
      db,
      ...BASE,
      channel: 'whatsapp',
      externalId: OTRO_BSUID,
      name: 'Otra',
    });

    expect(out?.contactId).not.toBe('contacto-7');
    expect(out?.created).toBe(true);
  });
});

describe('resolveContactByChannel — la persona no se duplica al cambiar de identificación', () => {
  it('vincula el BSUID aunque la identidad haya salido del teléfono', async () => {
    // Meta manda el BSUID en TODOS los mensajes entrantes. Registrarlo
    // desde ya es lo único que evita el duplicado del día que esa
    // persona active la privacidad del número.
    const { db, rec } = fakeDb({
      identities: new Map([['whatsapp:573166220262', 'contacto-3']]),
      contacts: [],
    });

    await resolveContactByChannel({
      db,
      ...BASE,
      channel: 'whatsapp',
      externalId: '573166220262',
      alsoKnownAs: BSUID,
      name: 'Zait',
    });

    expect(rec.linkedIdentities).toContainEqual(
      expect.objectContaining({ external_id: BSUID, contact_id: 'contacto-3' })
    );
  });

  it('un conocido que deja de traer teléfono entra en su mismo contacto', async () => {
    const { db, rec } = fakeDb({
      identities: new Map([[`whatsapp:${BSUID}`, 'contacto-3']]),
      contacts: [],
    });

    const out = await resolveContactByChannel({
      db,
      ...BASE,
      channel: 'whatsapp',
      externalId: BSUID,
      alsoKnownAs: BSUID,
      name: 'Zait',
    });

    expect(out).toEqual({ contactId: 'contacto-3', created: false });
    expect(rec.insertedContacts).toHaveLength(0);
  });

  it('uno creado por BSUID que empieza a traer teléfono NO se duplica', async () => {
    // El sentido contrario: la identidad de este mensaje es el
    // teléfono, que no conocemos, pero el BSUID sí lo conocemos.
    const { db, rec } = fakeDb({
      identities: new Map([[`whatsapp:${BSUID}`, 'contacto-3']]),
      contacts: [],
    });

    const out = await resolveContactByChannel({
      db,
      ...BASE,
      channel: 'whatsapp',
      externalId: '573166220262',
      alsoKnownAs: BSUID,
      name: 'Zait',
    });

    expect(out).toEqual({ contactId: 'contacto-3', created: false });
    expect(rec.insertedContacts).toHaveLength(0);
    // Y de paso queda registrado el teléfono como identidad suya.
    expect(rec.linkedIdentities).toContainEqual(
      expect.objectContaining({
        external_id: '573166220262',
        contact_id: 'contacto-3',
      })
    );
  });

  it('sin BSUID se comporta exactamente como antes', async () => {
    // Una instalación cuyo Meta todavía no manda `user_id`.
    const { db, rec } = fakeDb({
      identities: new Map(),
      contacts: [{ id: 'contacto-5', phone: '573166220262' }],
    });

    const out = await resolveContactByChannel({
      db,
      ...BASE,
      channel: 'whatsapp',
      externalId: '573166220262',
      name: 'Zait',
    });

    expect(out).toEqual({ contactId: 'contacto-5', created: false });
    expect(rec.insertedContacts).toHaveLength(0);
  });
});

describe('resolveContactByChannel — el nombre de usuario', () => {
  it('se guarda en la identidad al crear el contacto', async () => {
    const { db, rec } = fakeDb({ identities: new Map(), contacts: [] });

    await resolveContactByChannel({
      db,
      ...BASE,
      channel: 'whatsapp',
      externalId: BSUID,
      name: 'HumbertoR',
      username: 'RosalesHumberto',
    });

    expect(rec.linkedIdentities[0]).toMatchObject({
      external_id: BSUID,
      username: 'RosalesHumberto',
    });
  });

  it('se refresca aunque la identidad ya existiera', async () => {
    // El vínculo es idempotente a propósito y no toca una fila que ya
    // está; el nombre de usuario, en cambio, la persona lo cambia
    // cuando quiere. Un handle viejo en la ficha es peor que ninguno:
    // manda al asesor a buscar a alguien que ya no se llama así.
    const { db, rec } = fakeDb({
      identities: new Map([[`whatsapp:${BSUID}`, 'contacto-7']]),
      contacts: [],
    });

    await resolveContactByChannel({
      db,
      ...BASE,
      channel: 'whatsapp',
      externalId: BSUID,
      name: 'HumbertoR',
      username: 'HumbertoNuevo',
    });

    expect(rec.usernameUpdates).toContainEqual({ username: 'HumbertoNuevo' });
  });

  it('sin nombre de usuario no se escribe nada', async () => {
    const { db, rec } = fakeDb({
      identities: new Map([['whatsapp:573166220262', 'contacto-3']]),
      contacts: [],
    });

    await resolveContactByChannel({
      db,
      ...BASE,
      channel: 'whatsapp',
      externalId: '573166220262',
      name: 'Zait',
    });

    expect(rec.usernameUpdates).toHaveLength(0);
  });

  it('va en las DOS identidades cuando la persona tiene teléfono y BSUID', async () => {
    // Cuál de las dos traiga el próximo mensaje no se sabe de antemano.
    const { db, rec } = fakeDb({ identities: new Map(), contacts: [] });

    await resolveContactByChannel({
      db,
      ...BASE,
      channel: 'whatsapp',
      externalId: '573166220262',
      alsoKnownAs: BSUID,
      name: 'Zait',
      username: 'zaitp',
    });

    const conUsername = rec.linkedIdentities.filter(
      (i) => i.username === 'zaitp'
    );
    expect(conUsername).toHaveLength(2);
  });
});
