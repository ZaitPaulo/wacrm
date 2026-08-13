import type { SupabaseClient } from '@supabase/supabase-js';

// ============================================================
// Vincular dos fichas que son la misma persona, y poder deshacerlo.
//
// Vincular es fácil; deshacerlo es lo que obliga a tener cuidado. Por
// eso se guarda QUÉ se movió, fila por fila (migración 514): para
// cuando alguien revierta, la ficha sobreviviente ya puede haber
// acumulado conversaciones propias, y devolverle todo a la absorbida le
// entregaría cosas que nunca fueron suyas.
//
// Nada de esto ocurre solo. Siempre lo confirma una persona.
// ============================================================

export type LinkFailure =
  /** Alguna de las dos fichas no existe en esta cuenta. */
  | 'contact_not_found'
  /** Se pidió vincular una ficha consigo misma. */
  | 'same_contact'
  /** Una de las dos ya está absorbida por otra. */
  | 'already_linked'
  /**
   * Las dos tienen hilo del mismo canal. Mover uno chocaría con la
   * unicidad por (cuenta, contacto, canal), y dejarlo atrás partiría el
   * historial en silencio.
   */
  | 'channel_conflict'
  | 'db_error';

export type LinkResult =
  { ok: true; linkId: string } | { ok: false; reason: LinkFailure };

interface ContactRow {
  id: string;
  merged_into_contact_id: string | null;
}

interface ConversationRow {
  id: string;
  channel: string;
}

/**
 * Une la ficha `mergedId` bajo `survivingId`.
 *
 * Mueve sus conversaciones y sus identidades de canal, marca la
 * absorbida y deja registro de todo lo que cambió de dueño.
 *
 * NO BORRA NADA. La ficha absorbida sigue existiendo, vacía y apuntando
 * a la que quedó: es lo que hace posible revertir.
 */
export async function linkContacts(args: {
  db: SupabaseClient;
  accountId: string;
  survivingId: string;
  mergedId: string;
  /** Quién lo confirmó. Nunca es automático. */
  userId: string;
}): Promise<LinkResult> {
  const { db, accountId, survivingId, mergedId, userId } = args;

  if (survivingId === mergedId) return { ok: false, reason: 'same_contact' };

  const { data: contacts, error: contactsErr } = await db
    .from('contacts')
    .select('id, merged_into_contact_id')
    .eq('account_id', accountId)
    .in('id', [survivingId, mergedId]);

  if (contactsErr) {
    console.error('[identity-links] contacts lookup:', contactsErr.message);
    return { ok: false, reason: 'db_error' };
  }
  const rows = (contacts ?? []) as ContactRow[];
  if (rows.length !== 2) return { ok: false, reason: 'contact_not_found' };
  if (rows.some((r) => r.merged_into_contact_id)) {
    return { ok: false, reason: 'already_linked' };
  }

  // Los canales que cada una ya ocupa. Si coinciden en alguno, mover el
  // hilo chocaría con la unicidad por (cuenta, contacto, canal).
  const { data: convs, error: convErr } = await db
    .from('conversations')
    .select('id, contact_id, channel')
    .eq('account_id', accountId)
    .in('contact_id', [survivingId, mergedId]);

  if (convErr) {
    console.error('[identity-links] conversations lookup:', convErr.message);
    return { ok: false, reason: 'db_error' };
  }

  const todas = (convs ?? []) as (ConversationRow & { contact_id: string })[];
  const delSobreviviente = todas.filter((c) => c.contact_id === survivingId);
  const deLaAbsorbida = todas.filter((c) => c.contact_id === mergedId);

  const canalesOcupados = new Set(delSobreviviente.map((c) => c.channel));
  if (deLaAbsorbida.some((c) => canalesOcupados.has(c.channel))) {
    return { ok: false, reason: 'channel_conflict' };
  }

  const movedConversationIds = deLaAbsorbida.map((c) => c.id);

  const { data: channels, error: chErr } = await db
    .from('contact_channels')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', mergedId);

  if (chErr) {
    console.error('[identity-links] channels lookup:', chErr.message);
    return { ok: false, reason: 'db_error' };
  }
  const movedChannelIds = ((channels ?? []) as { id: string }[]).map(
    (c) => c.id
  );

  // El registro se crea PRIMERO. Si algo falla después, queda una
  // vinculación anotada y a medio aplicar, que es un estado que se
  // puede inspeccionar y reparar. Al revés —mover todo y morir antes de
  // anotarlo— dejaría datos movidos sin forma de saber de dónde vinieron.
  const { data: link, error: linkErr } = await db
    .from('contact_links')
    .insert({
      account_id: accountId,
      surviving_contact_id: survivingId,
      merged_contact_id: mergedId,
      moved_conversation_ids: movedConversationIds,
      moved_channel_ids: movedChannelIds,
      linked_by: userId,
    })
    .select('id')
    .single<{ id: string }>();

  if (linkErr || !link) {
    console.error('[identity-links] link insert:', linkErr?.message);
    return { ok: false, reason: 'db_error' };
  }

  if (movedConversationIds.length > 0) {
    const { error } = await db
      .from('conversations')
      .update({ contact_id: survivingId })
      .in('id', movedConversationIds);
    if (error) {
      console.error('[identity-links] move conversations:', error.message);
      return { ok: false, reason: 'db_error' };
    }
  }

  if (movedChannelIds.length > 0) {
    const { error } = await db
      .from('contact_channels')
      .update({ contact_id: survivingId })
      .in('id', movedChannelIds);
    if (error) {
      console.error('[identity-links] move channels:', error.message);
      return { ok: false, reason: 'db_error' };
    }
  }

  const { error: markErr } = await db
    .from('contacts')
    .update({ merged_into_contact_id: survivingId })
    .eq('id', mergedId);
  if (markErr) {
    console.error('[identity-links] mark merged:', markErr.message);
    return { ok: false, reason: 'db_error' };
  }

  return { ok: true, linkId: link.id };
}

export type UnlinkFailure = 'link_not_found' | 'already_undone' | 'db_error';

export type UnlinkResult = { ok: true } | { ok: false; reason: UnlinkFailure };

/**
 * Revierte una vinculación, devolviéndole a cada ficha lo suyo.
 *
 * Devuelve EXACTAMENTE lo que se movió, según el registro. Lo que la
 * ficha sobreviviente haya acumulado después se queda con ella.
 *
 * La fila del registro no se borra: queda marcada como deshecha. Que
 * esto se vinculó y se revirtió es justo lo que alguien va a querer
 * entender más adelante.
 */
export async function unlinkContacts(args: {
  db: SupabaseClient;
  accountId: string;
  linkId: string;
  userId: string;
}): Promise<UnlinkResult> {
  const { db, accountId, linkId, userId } = args;

  const { data: link, error } = await db
    .from('contact_links')
    .select(
      'id, merged_contact_id, moved_conversation_ids, moved_channel_ids, undone_at'
    )
    .eq('account_id', accountId)
    .eq('id', linkId)
    .maybeSingle<{
      id: string;
      merged_contact_id: string;
      moved_conversation_ids: string[];
      moved_channel_ids: string[];
      undone_at: string | null;
    }>();

  if (error) {
    console.error('[identity-links] link lookup:', error.message);
    return { ok: false, reason: 'db_error' };
  }
  if (!link) return { ok: false, reason: 'link_not_found' };
  if (link.undone_at) return { ok: false, reason: 'already_undone' };

  if (link.moved_conversation_ids.length > 0) {
    const { error: convErr } = await db
      .from('conversations')
      .update({ contact_id: link.merged_contact_id })
      .in('id', link.moved_conversation_ids);
    if (convErr) {
      console.error('[identity-links] restore conversations:', convErr.message);
      return { ok: false, reason: 'db_error' };
    }
  }

  if (link.moved_channel_ids.length > 0) {
    const { error: chErr } = await db
      .from('contact_channels')
      .update({ contact_id: link.merged_contact_id })
      .in('id', link.moved_channel_ids);
    if (chErr) {
      console.error('[identity-links] restore channels:', chErr.message);
      return { ok: false, reason: 'db_error' };
    }
  }

  const { error: unmarkErr } = await db
    .from('contacts')
    .update({ merged_into_contact_id: null })
    .eq('id', link.merged_contact_id);
  if (unmarkErr) {
    console.error('[identity-links] unmark merged:', unmarkErr.message);
    return { ok: false, reason: 'db_error' };
  }

  const { error: stampErr } = await db
    .from('contact_links')
    .update({ undone_at: new Date().toISOString(), undone_by: userId })
    .eq('id', linkId);
  if (stampErr) {
    console.error('[identity-links] stamp undone:', stampErr.message);
    return { ok: false, reason: 'db_error' };
  }

  return { ok: true };
}
