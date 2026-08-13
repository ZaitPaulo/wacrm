import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { linkContacts, unlinkContacts } from './identity-links';

interface Estado {
  contacts: { id: string; merged_into_contact_id: string | null }[];
  conversations: { id: string; contact_id: string; channel: string }[];
  channels: { id: string; contact_id: string }[];
  links: Record<string, Record<string, unknown>>;
}

/**
 * Doble que APLICA los cambios, no solo los registra.
 *
 * Es a propósito: lo que hay que verificar acá no es qué consultas se
 * hicieron sino dónde terminó cada fila, y sobre todo que deshacer
 * devuelva exactamente lo que se movió.
 */
function fakeDb(estado: Estado) {
  let nextLink = 1;

  const db = {
    from(table: string) {
      const filtros: Record<string, unknown> = {};
      let inCol = '';
      let inVals: string[] = [];
      let pending: Record<string, unknown> | null = null;

      const b: Record<string, unknown> = {
        select: () => b,
        eq: (col: string, val: unknown) => {
          filtros[col] = val;
          return b;
        },
        in: (col: string, vals: string[]) => {
          inCol = col;
          inVals = vals;
          if (pending) aplicarUpdate();
          return b;
        },
        update: (row: Record<string, unknown>) => {
          pending = row;
          return b;
        },
        insert: (row: Record<string, unknown>) => {
          const id = `link-${nextLink++}`;
          estado.links[id] = { ...row, id, undone_at: null };
          return {
            select: () => ({
              single: async () => ({ data: { id }, error: null }),
            }),
          };
        },
        maybeSingle: async () => {
          if (table === 'contact_links') {
            const row = estado.links[filtros.id as string];
            return { data: row ?? null, error: null };
          }
          return { data: null, error: null };
        },
        then: (resolve: (r: { data: unknown; error: null }) => unknown) => {
          if (pending) aplicarUpdate();
          return resolve({ data: leer(), error: null });
        },
      };

      function leer() {
        if (table === 'contacts') {
          return estado.contacts.filter((c) => inVals.includes(c.id));
        }
        if (table === 'conversations') {
          return estado.conversations.filter((c) =>
            inVals.includes(c.contact_id)
          );
        }
        if (table === 'contact_channels') {
          return estado.channels.filter(
            (c) => c.contact_id === filtros.contact_id
          );
        }
        return [];
      }

      function aplicarUpdate() {
        const row = pending as Record<string, unknown>;
        pending = null;

        const alcanza = (id: string) =>
          inCol === 'id' ? inVals.includes(id) : filtros.id === id;

        if (table === 'conversations') {
          for (const c of estado.conversations) {
            if (alcanza(c.id)) c.contact_id = row.contact_id as string;
          }
        } else if (table === 'contact_channels') {
          for (const c of estado.channels) {
            if (alcanza(c.id)) c.contact_id = row.contact_id as string;
          }
        } else if (table === 'contacts') {
          for (const c of estado.contacts) {
            if (alcanza(c.id)) {
              c.merged_into_contact_id = row.merged_into_contact_id as
                string | null;
            }
          }
        } else if (table === 'contact_links') {
          const link = estado.links[filtros.id as string];
          if (link) Object.assign(link, row);
        }
      }

      return b;
    },
  } as unknown as SupabaseClient;

  return db;
}

function estadoBase(): Estado {
  return {
    contacts: [
      { id: 'wa', merged_into_contact_id: null },
      { id: 'ig', merged_into_contact_id: null },
    ],
    conversations: [
      { id: 'conv-wa', contact_id: 'wa', channel: 'whatsapp' },
      { id: 'conv-ig', contact_id: 'ig', channel: 'instagram' },
    ],
    channels: [
      { id: 'ch-wa', contact_id: 'wa' },
      { id: 'ch-ig', contact_id: 'ig' },
    ],
    links: {},
  };
}

const ARGS = { accountId: 'acct-1', userId: 'user-1' };

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('linkContacts', () => {
  it('mueve conversaciones e identidades, y marca la absorbida', async () => {
    const estado = estadoBase();
    const out = await linkContacts({
      db: fakeDb(estado),
      ...ARGS,
      survivingId: 'wa',
      mergedId: 'ig',
    });

    expect(out.ok).toBe(true);
    // El hilo de Instagram pasó a la ficha que queda...
    expect(
      estado.conversations.find((c) => c.id === 'conv-ig')?.contact_id
    ).toBe('wa');
    // ...su identidad también...
    expect(estado.channels.find((c) => c.id === 'ch-ig')?.contact_id).toBe(
      'wa'
    );
    // ...y la absorbida quedó apuntando, no borrada.
    expect(
      estado.contacts.find((c) => c.id === 'ig')?.merged_into_contact_id
    ).toBe('wa');
  });

  it('registra exactamente qué movió', async () => {
    const estado = estadoBase();
    const out = await linkContacts({
      db: fakeDb(estado),
      ...ARGS,
      survivingId: 'wa',
      mergedId: 'ig',
    });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const link = estado.links[out.linkId];
    expect(link.moved_conversation_ids).toEqual(['conv-ig']);
    expect(link.moved_channel_ids).toEqual(['ch-ig']);
    expect(link.linked_by).toBe('user-1');
  });

  it('rechaza vincular una ficha consigo misma', async () => {
    const out = await linkContacts({
      db: fakeDb(estadoBase()),
      ...ARGS,
      survivingId: 'wa',
      mergedId: 'wa',
    });
    expect(out).toEqual({ ok: false, reason: 'same_contact' });
  });

  it('rechaza si una ya está absorbida', async () => {
    const estado = estadoBase();
    estado.contacts[1].merged_into_contact_id = 'otro';

    const out = await linkContacts({
      db: fakeDb(estado),
      ...ARGS,
      survivingId: 'wa',
      mergedId: 'ig',
    });
    expect(out).toEqual({ ok: false, reason: 'already_linked' });
  });

  it('rechaza cuando las dos tienen hilo del mismo canal', async () => {
    // Mover uno chocaría con la unicidad por (cuenta, contacto, canal),
    // y dejarlo atrás partiría el historial sin avisar.
    const estado = estadoBase();
    estado.conversations.push({
      id: 'conv-wa2',
      contact_id: 'ig',
      channel: 'whatsapp',
    });

    const out = await linkContacts({
      db: fakeDb(estado),
      ...ARGS,
      survivingId: 'wa',
      mergedId: 'ig',
    });

    expect(out).toEqual({ ok: false, reason: 'channel_conflict' });
    // Y no tocó nada.
    expect(
      estado.conversations.find((c) => c.id === 'conv-ig')?.contact_id
    ).toBe('ig');
  });

  it('rechaza cuando una de las fichas no es de esta cuenta', async () => {
    const estado = estadoBase();
    estado.contacts = [{ id: 'wa', merged_into_contact_id: null }];

    const out = await linkContacts({
      db: fakeDb(estado),
      ...ARGS,
      survivingId: 'wa',
      mergedId: 'ajeno',
    });
    expect(out).toEqual({ ok: false, reason: 'contact_not_found' });
  });
});

describe('unlinkContacts', () => {
  it('devuelve a cada ficha lo suyo', async () => {
    const estado = estadoBase();
    const db = fakeDb(estado);

    const link = await linkContacts({
      db,
      ...ARGS,
      survivingId: 'wa',
      mergedId: 'ig',
    });
    expect(link.ok).toBe(true);
    if (!link.ok) return;

    const out = await unlinkContacts({ db, ...ARGS, linkId: link.linkId });

    expect(out).toEqual({ ok: true });
    expect(
      estado.conversations.find((c) => c.id === 'conv-ig')?.contact_id
    ).toBe('ig');
    expect(estado.channels.find((c) => c.id === 'ch-ig')?.contact_id).toBe(
      'ig'
    );
    expect(
      estado.contacts.find((c) => c.id === 'ig')?.merged_into_contact_id
    ).toBeNull();
  });

  it('NO devuelve lo que la sobreviviente acumuló después', async () => {
    // Este es el caso que obliga a guardar qué se movió. Sin ese
    // registro, deshacer le entregaría a la absorbida un hilo que nunca
    // fue suyo.
    const estado = estadoBase();
    const db = fakeDb(estado);

    const link = await linkContacts({
      db,
      ...ARGS,
      survivingId: 'wa',
      mergedId: 'ig',
    });
    if (!link.ok) return;

    estado.conversations.push({
      id: 'conv-posterior',
      contact_id: 'wa',
      channel: 'messenger',
    });

    await unlinkContacts({ db, ...ARGS, linkId: link.linkId });

    expect(
      estado.conversations.find((c) => c.id === 'conv-posterior')?.contact_id
    ).toBe('wa');
  });

  it('deja la fila marcada en vez de borrarla', async () => {
    const estado = estadoBase();
    const db = fakeDb(estado);

    const link = await linkContacts({
      db,
      ...ARGS,
      survivingId: 'wa',
      mergedId: 'ig',
    });
    if (!link.ok) return;

    await unlinkContacts({ db, ...ARGS, linkId: link.linkId });

    const row = estado.links[link.linkId];
    expect(row).toBeDefined();
    expect(row.undone_at).toBeTruthy();
    expect(row.undone_by).toBe('user-1');
  });

  it('no deshace dos veces', async () => {
    const estado = estadoBase();
    const db = fakeDb(estado);

    const link = await linkContacts({
      db,
      ...ARGS,
      survivingId: 'wa',
      mergedId: 'ig',
    });
    if (!link.ok) return;

    await unlinkContacts({ db, ...ARGS, linkId: link.linkId });
    const segunda = await unlinkContacts({ db, ...ARGS, linkId: link.linkId });

    expect(segunda).toEqual({ ok: false, reason: 'already_undone' });
  });

  it('informa cuando la vinculación no existe', async () => {
    const out = await unlinkContacts({
      db: fakeDb(estadoBase()),
      ...ARGS,
      linkId: 'no-existe',
    });
    expect(out).toEqual({ ok: false, reason: 'link_not_found' });
  });
});
