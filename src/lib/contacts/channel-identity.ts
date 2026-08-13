import type { SupabaseClient } from '@supabase/supabase-js';

import { findExistingContact, isUniqueViolation } from './dedupe';

// ============================================================
// Resolución de contactos por identidad de canal (migración 513).
//
// Hasta ahora una persona SE IDENTIFICABA por su teléfono. Instagram y
// Messenger no entregan número: entregan un identificador propio de
// Meta. La llave pasa a ser (cuenta, canal, identificador), y el
// teléfono queda como una identidad más — la de WhatsApp.
//
// Lo que este módulo NO cambia es cómo se comporta WhatsApp. Esa parte
// tiene que seguir resolviendo exactamente igual que antes, incluida su
// tolerancia a prefijos troncales; ver `resolveContactByChannel`.
// ============================================================

/** Los canales que la base admite hoy (enum `message_channel`). */
export const MESSAGE_CHANNELS = ['whatsapp', 'instagram', 'messenger'] as const;

export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

export function isMessageChannel(value: unknown): value is MessageChannel {
  return (
    typeof value === 'string' &&
    (MESSAGE_CHANNELS as readonly string[]).includes(value)
  );
}

export interface ResolvedContact {
  contactId: string;
  /** True cuando esta llamada creó la ficha, no cuando la encontró. */
  created: boolean;
}

/**
 * Busca el contacto por su identidad exacta en un canal.
 *
 * Exacto a propósito: el identificador lo emite la plataforma y llega
 * siempre en la misma forma. La tolerancia difusa solo tiene sentido
 * para teléfonos escritos por personas, y vive en `findExistingContact`.
 */
export async function findContactByIdentity(
  db: SupabaseClient,
  accountId: string,
  channel: MessageChannel,
  externalId: string
): Promise<string | null> {
  if (!externalId) return null;

  const { data, error } = await db
    .from('contact_channels')
    .select('contact_id')
    .eq('account_id', accountId)
    .eq('channel', channel)
    .eq('external_id', externalId)
    .maybeSingle<{ contact_id: string }>();

  if (error) {
    console.error('[channel-identity] lookup error:', error.message);
    return null;
  }
  return data?.contact_id ?? null;
}

/**
 * Registra la identidad de un contacto en un canal.
 *
 * Idempotente: si ya existe, no hace nada. Un choque acá significa que
 * otra petición ganó la carrera, y el resultado es el mismo que
 * queríamos.
 */
export async function linkChannelIdentity(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  channel: MessageChannel,
  externalId: string
): Promise<void> {
  const { error } = await db.from('contact_channels').upsert(
    {
      account_id: accountId,
      contact_id: contactId,
      channel,
      external_id: externalId,
    },
    { onConflict: 'account_id,channel,external_id', ignoreDuplicates: true }
  );

  if (error && !isUniqueViolation(error)) {
    console.error('[channel-identity] link error:', error.message);
  }
}

export interface ResolveContactArgs {
  db: SupabaseClient;
  accountId: string;
  /**
   * Usuario al que se atribuyen las filas creadas. `contacts.user_id`
   * es NOT NULL y un mensaje entrante no tiene un humano detrás, así
   * que se usa el dueño de la configuración de la cuenta — el mismo
   * criterio que ya aplicaban el webhook y la API pública.
   */
  auditUserId: string;
  channel: MessageChannel;
  /** `wa_id` en WhatsApp; el identificador de Meta en los otros. */
  externalId: string;
  /** Nombre que informa la plataforma, cuando informa alguno. */
  name?: string | null;
}

/**
 * Encuentra o crea el contacto que corresponde a una identidad de canal.
 *
 * El orden importa y no es arbitrario:
 *
 *   1. Identidad exacta. Es lo que resuelve el caso normal de cualquier
 *      canal, en una sola consulta.
 *   2. **Solo en WhatsApp**, si no hubo identidad, se cae al camino
 *      viejo por teléfono. Eso preserva la tolerancia a prefijos
 *      troncales de `findExistingContact` —"370063949836" y
 *      "37063949836" son la misma persona— que se perdería si la
 *      resolución fuera únicamente por identidad exacta, y empezaría a
 *      duplicar contactos que hoy no se duplican. De paso, al
 *      encontrarlo le registra la identidad que le faltaba.
 *   3. Crear.
 *
 * El paso 2 es también lo que hace que un contacto cargado a mano o por
 * CSV se reconozca cuando esa persona escribe por primera vez.
 */
export async function resolveContactByChannel(
  args: ResolveContactArgs
): Promise<ResolvedContact | null> {
  const { db, accountId, auditUserId, channel, externalId, name } = args;

  if (!externalId) return null;

  // 1. Identidad exacta.
  const byIdentity = await findContactByIdentity(
    db,
    accountId,
    channel,
    externalId
  );
  if (byIdentity) {
    await updateNameIfChanged(db, byIdentity, name);
    return { contactId: byIdentity, created: false };
  }

  // 2. Respaldo por teléfono, solo para WhatsApp.
  if (channel === 'whatsapp') {
    const byPhone = await findExistingContact(db, accountId, externalId);
    if (byPhone) {
      await linkChannelIdentity(db, accountId, byPhone.id, channel, externalId);
      await updateNameIfChanged(db, byPhone.id, name, byPhone.name);
      return { contactId: byPhone.id, created: false };
    }
  }

  // 3. Crear. El teléfono solo se puebla en WhatsApp: en los demás
  // canales no lo hay, y desde la 513 la columna admite NULL.
  const { data: created, error } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: auditUserId,
      phone: channel === 'whatsapp' ? externalId : null,
      name: name || externalId,
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !created) {
    // Perdimos una carrera: otra petición creó el contacto entre la
    // búsqueda y el insert, y el índice único lo rechazó. Se vuelve a
    // resolver en vez de descartar el mensaje.
    if (isUniqueViolation(error)) {
      const raced = await resolveAfterRace(db, accountId, channel, externalId);
      if (raced) return { contactId: raced, created: false };
    }
    console.error('[channel-identity] create error:', error?.message);
    return null;
  }

  await linkChannelIdentity(db, accountId, created.id, channel, externalId);
  return { contactId: created.id, created: true };
}

/** Re-resolución tras una carrera perdida, por los dos caminos. */
async function resolveAfterRace(
  db: SupabaseClient,
  accountId: string,
  channel: MessageChannel,
  externalId: string
): Promise<string | null> {
  const byIdentity = await findContactByIdentity(
    db,
    accountId,
    channel,
    externalId
  );
  if (byIdentity) return byIdentity;

  if (channel === 'whatsapp') {
    const byPhone = await findExistingContact(db, accountId, externalId);
    if (byPhone) {
      await linkChannelIdentity(db, accountId, byPhone.id, channel, externalId);
      return byPhone.id;
    }
  }
  return null;
}

/**
 * Actualiza el nombre cuando la plataforma informa uno distinto.
 *
 * Mismo comportamiento que traía el webhook. Cuando no se conoce el
 * nombre actual —el camino por identidad devuelve solo el id— se
 * escribe igual: la escritura es barata y el dato viene de la
 * plataforma, que es la fuente más fresca que hay.
 */
async function updateNameIfChanged(
  db: SupabaseClient,
  contactId: string,
  name: string | null | undefined,
  currentName?: string | null
): Promise<void> {
  if (!name) return;
  if (currentName !== undefined && name === currentName) return;

  const { error } = await db
    .from('contacts')
    .update({ name, updated_at: new Date().toISOString() })
    .eq('id', contactId);
  if (error) {
    console.error('[channel-identity] name update error:', error.message);
  }
}
