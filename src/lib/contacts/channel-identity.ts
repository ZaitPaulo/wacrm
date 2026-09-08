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
  externalId: string,
  /**
   * Nombre de usuario público de ESA identidad, cuando el canal lo
   * informa. Se guarda para poder reconocer a un contacto que no tiene
   * teléfono; no participa en la resolución. Ver migración 522.
   */
  username?: string | null
): Promise<void> {
  const { error } = await db.from('contact_channels').upsert(
    {
      account_id: accountId,
      contact_id: contactId,
      channel,
      external_id: externalId,
      ...(username ? { username } : {}),
    },
    // `ignoreDuplicates` mantiene el upsert idempotente: una identidad
    // que ya existe no se toca. El nombre de usuario, que sí puede
    // cambiar, se refresca aparte — ver `refreshUsername`.
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
  /**
   * Otra identidad de la misma persona en el mismo canal — el BSUID de
   * WhatsApp. Se busca por ella si `externalId` no encuentra nada, y se
   * vincula siempre. Ver `resolveContactByChannel`.
   */
  alsoKnownAs?: string | null;
  /**
   * Nombre de usuario público, cuando el canal lo informa. Se guarda
   * para reconocer a un contacto sin teléfono; no resuelve nada.
   */
  username?: string | null;
}

/**
 * ¿Este identificador es un teléfono?
 *
 * Un BSUID de WhatsApp tiene la forma `CO.4481978948757066` — código de
 * país, punto, y hasta 128 alfanuméricos. La distinción importa porque
 * las reglas de teléfonos (normalizar a dígitos, comparar por los
 * últimos ocho, probar variantes de prefijo troncal) existen para
 * números escritos por personas. Aplicarlas a un identificador opaco
 * puede llegar a hacer coincidir a dos personas que no tienen nada que
 * ver.
 */
export function isPhoneIdentity(externalId: string): boolean {
  return /^\d+$/.test(externalId);
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
  const alsoKnownAs = args.alsoKnownAs || null;

  if (!externalId) return null;

  const username = args.username || null;

  /**
   * Deja registradas TODAS las identidades que la plataforma informó.
   *
   * El nombre de usuario va en las dos: es de la persona en ese canal,
   * y cuál de sus dos identidades traiga el próximo mensaje no se sabe
   * de antemano.
   */
  const linkAll = async (contactId: string) => {
    await linkChannelIdentity(
      db,
      accountId,
      contactId,
      channel,
      externalId,
      username
    );
    if (alsoKnownAs && alsoKnownAs !== externalId) {
      await linkChannelIdentity(
        db,
        accountId,
        contactId,
        channel,
        alsoKnownAs,
        username
      );
    }
    // El upsert de arriba no toca una identidad que ya existe, así que
    // un nombre de usuario que cambió no entraría por ahí.
    if (username) {
      await refreshUsername(db, accountId, contactId, channel, username);
    }
  };

  // 1. Identidad exacta.
  const byIdentity = await findContactByIdentity(
    db,
    accountId,
    channel,
    externalId
  );
  if (byIdentity) {
    // Vincula por si esta es la primera vez que la plataforma manda la
    // OTRA identidad: así el día que deje de mandar esta, se resuelve
    // igual.
    await linkAll(byIdentity);
    await updateNameIfChanged(db, byIdentity, name);
    return { contactId: byIdentity, created: false };
  }

  // 2. La otra identidad de la misma persona.
  //
  // Este es el paso que evita el duplicado cuando alguien cambia de
  // forma de identificarse, en los DOS sentidos: un contacto conocido
  // por su teléfono que empieza a llegar solo con BSUID, y uno creado
  // por BSUID que después trae su número. Va ANTES del respaldo difuso
  // porque es una coincidencia exacta y no admite ambigüedad.
  if (alsoKnownAs && alsoKnownAs !== externalId) {
    const byAlias = await findContactByIdentity(
      db,
      accountId,
      channel,
      alsoKnownAs
    );
    if (byAlias) {
      await linkAll(byAlias);
      await updateNameIfChanged(db, byAlias, name);
      return { contactId: byAlias, created: false };
    }
  }

  // 3. Respaldo difuso por teléfono, solo en WhatsApp y SOLO si lo que
  // tenemos es de verdad un teléfono. `findExistingContact` compara por
  // los últimos dígitos para tolerar prefijos troncales; correrlo sobre
  // un BSUID compararía los dígitos de un identificador opaco contra
  // números de teléfono, que es como se fusiona a dos personas
  // distintas.
  if (channel === 'whatsapp' && isPhoneIdentity(externalId)) {
    const byPhone = await findExistingContact(db, accountId, externalId);
    if (byPhone) {
      await linkAll(byPhone.id);
      await updateNameIfChanged(db, byPhone.id, name, byPhone.name);
      return { contactId: byPhone.id, created: false };
    }
  }

  // 4. Crear. El teléfono se puebla solo si el identificador ES un
  // teléfono — no por ser WhatsApp. Sin esa condición, un BSUID
  // terminaría en la columna `phone`, donde lo verían la ficha, la
  // exportación y el índice único de teléfonos.
  const { data: created, error } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: auditUserId,
      phone: isPhoneIdentity(externalId) ? externalId : null,
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

  await linkAll(created.id);
  return { contactId: created.id, created: true };
}

/**
 * Pone al día el nombre de usuario de las identidades de un contacto.
 *
 * Va aparte del vínculo porque `linkChannelIdentity` es idempotente a
 * propósito —`ignoreDuplicates` no toca una fila que ya existe— y el
 * nombre de usuario SÍ cambia: la persona puede cambiarlo cuando
 * quiera, y un handle viejo en la ficha es peor que ninguno, porque
 * manda al asesor a buscar a alguien que ya no se llama así.
 *
 * Se escribe SIN comparar contra el valor guardado. La comparación
 * parecía el ahorro obvio, pero `neq` no alcanza a las filas donde la
 * columna es NULL —en SQL, `NULL <> 'algo'` no es verdadero— y esas son
 * justamente todas las identidades anteriores a la migración 522: nunca
 * se llenarían. Una escritura de más sobre filas que ya estamos
 * tocando cuesta mucho menos que un dato que no aparece jamás.
 *
 * Best-effort: un fallo acá no puede tumbar la recepción del mensaje.
 */
async function refreshUsername(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  channel: MessageChannel,
  username: string
): Promise<void> {
  const { error } = await db
    .from('contact_channels')
    .update({ username })
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('channel', channel);
  if (error) {
    console.error('[channel-identity] username update error:', error.message);
  }
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

  // Mismo condicionamiento que en el camino normal: la comparación
  // difusa por dígitos solo tiene sentido sobre teléfonos.
  if (channel === 'whatsapp' && isPhoneIdentity(externalId)) {
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
