import type { SupabaseClient } from '@supabase/supabase-js';

import type { MessageChannel } from '@/lib/contacts/channel-identity';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';
import { isPhoneRecipient } from '@/lib/whatsapp/recipient';
import {
  evaluateWindow,
  type OutsideWindowOption,
  type SenderKind,
} from './window';
import { debeEsperar, parseHorario } from './business-hours';

/** Quién tomó la iniciativa de un envío. Ver `OutboundOptions`. */
export type Initiative = 'reply' | 'unprompted';

// ============================================================
// La puerta de salida: por dónde y a quién sale una respuesta.
//
// EL CANAL SE LEE DE LA CONVERSACIÓN Y NUNCA SE INFIERE NI SE RECIBE
// COMO PARÁMETRO. Ese es el punto entero de este módulo. Contestarle por
// Instagram a quien escribió por WhatsApp —o peor, contestarle a otra
// persona— es el peor fallo posible de todo el multicanal, y la única
// defensa que no depende de que cada camino de envío se acuerde es que
// no exista forma de decirle el canal desde afuera.
//
// Hoy conviven tres caminos de envío (`whatsapp/send-message.ts`,
// `automations/meta-send.ts`, `flows/meta-send.ts`). No se unifican por
// dentro en este cambio —es un refactor propio— pero los tres resuelven
// su destino acá en vez de asumir que el destinatario es un teléfono.
// ============================================================

/** A quién hay que hablarle, en los términos de su canal. */
export interface OutboundTarget {
  channel: MessageChannel;
  /**
   * El identificador de destino: el teléfono saneado en WhatsApp, el
   * identificador de Meta en Instagram y Messenger.
   */
  recipientId: string;
  conversationId: string;
  contactId: string;
  /**
   * True cuando el envío sale pasada la ventana ordinaria y hay que
   * marcarlo como atención humana ante Meta.
   *
   * LO DECIDE LA PUERTA. Ningún camino de envío puede pedirlo: usar esa
   * etiqueta para un mensaje automático no da error, da un uso fuera de
   * lo que Meta autoriza, y lo que se arriesga es el permiso de la app.
   */
  humanAgentTag: boolean;
}

export type OutboundFailure =
  /** La conversación no existe en esta cuenta. */
  | 'conversation_not_found'
  /** El contacto no tiene identidad en el canal del hilo. */
  | 'no_recipient'
  /** La tiene, pero no sirve para enviar (un teléfono mal formado). */
  | 'invalid_recipient'
  /** El canal existe en la base pero todavía no tiene cómo enviar. */
  | 'channel_unsupported'
  /** La ventana de respuesta del canal se cerró. */
  | 'outside_window'
  /**
   * Fuera del horario de atención, y el envío no responde a nadie.
   * Nunca se devuelve para una respuesta ni para un envío humano.
   */
  | 'quiet_hours';

export type OutboundResolution =
  | { ok: true; target: OutboundTarget }
  | {
      ok: false;
      reason: OutboundFailure;
      detail?: string;
      /** Qué sí se podría mandar. Solo con `outside_window`. */
      alternative?: OutsideWindowOption;
    };

export interface OutboundOptions {
  /**
   * Quién manda. Obligatorio a propósito: de esto depende si aplica la
   * extensión por atención humana, y dejarlo con valor por defecto
   * haría que un camino automático heredara sin querer los permisos de
   * una persona.
   */
  senderKind: SenderKind;
  /**
   * Quién tomó la iniciativa de este envío.
   *
   * Obligatorio por la misma razón que `senderKind`, y con más motivo:
   * un valor por defecto haría que un seguimiento programado se hiciera
   * pasar por respuesta y le escribiera a alguien a las 3 de la mañana.
   * Es la única forma de saberlo — no se puede inferir del contenido ni
   * del tiempo transcurrido.
   *
   *   'reply'       responde a un mensaje que el cliente acaba de
   *                 mandar. Sale a cualquier hora: si escribió a las 11
   *                 de la noche es porque espera respuesta, y callarse
   *                 sería peor que contestar.
   *   'unprompted'  el sistema arranca por su cuenta — una espera que
   *                 vence, una etiqueta que se agregó. Solo en horario.
   */
  initiative: Initiative;
  /** Si el envío es una plantilla aprobada (solo aplica a WhatsApp). */
  isTemplate?: boolean;
}

/** Canales que hoy saben enviar. Instagram y Messenger se suman luego. */
const SENDABLE_CHANNELS: readonly MessageChannel[] = ['whatsapp'];

interface ConversationRow {
  id: string;
  contact_id: string;
  channel: MessageChannel;
}

/**
 * Resuelve el destino de una respuesta a partir de su conversación.
 *
 * Devuelve un resultado descrito en vez de lanzar: cada camino de envío
 * tiene su propia familia de errores —`SendMessageError` en el manual,
 * excepciones planas en los motores— y traduce este resultado a la
 * suya, conservando los mensajes que ya devolvía.
 */
export async function resolveOutboundTarget(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  options: OutboundOptions
): Promise<OutboundResolution> {
  const { data: conversation, error } = await db
    .from('conversations')
    .select('id, contact_id, channel')
    .eq('account_id', accountId)
    .eq('id', conversationId)
    .maybeSingle<ConversationRow>();

  if (error) {
    console.error('[outbound] conversation lookup error:', error.message);
    return { ok: false, reason: 'conversation_not_found' };
  }
  if (!conversation) {
    return { ok: false, reason: 'conversation_not_found' };
  }

  // El canal viaja en la fila desde que se creó (migración 513). Las
  // conversaciones anteriores al multicanal quedaron en `whatsapp`.
  const channel = conversation.channel ?? 'whatsapp';

  if (!SENDABLE_CHANNELS.includes(channel)) {
    return {
      ok: false,
      reason: 'channel_unsupported',
      detail: `todavía no se puede enviar por ${channel}`,
    };
  }

  const recipient = await resolveRecipientId(
    db,
    accountId,
    conversation.contact_id,
    channel
  );
  if (!recipient.ok) return recipient;

  // El horario de atención. Se comprueba acá, en el único punto por el
  // que pasan todos los caminos de envío, en vez de confiar en que cada
  // automatización se acuerde de poner una condición.
  //
  // Solo frena lo que NO responde a nadie. Una respuesta sale a
  // cualquier hora, y un envío humano también: si una persona escribe a
  // las 11 de la noche es porque decidió hacerlo.
  if (options.initiative === 'unprompted' && options.senderKind !== 'human') {
    const bloqueado = await fueraDeHorario(db, accountId);
    if (bloqueado) return { ok: false, reason: 'quiet_hours' };
  }

  // La ventana se comprueba ACÁ, en la misma llamada que resuelve el
  // destino, para que ningún camino de envío pueda olvidarse de mirarla.
  const verdict = evaluateWindow({
    channel,
    senderKind: options.senderKind,
    lastInboundAt: await lastInboundAt(db, conversation.id),
    isTemplate: options.isTemplate,
  });

  if (!verdict.allowed) {
    return {
      ok: false,
      reason: 'outside_window',
      alternative: verdict.alternative,
    };
  }

  return {
    ok: true,
    target: {
      channel,
      recipientId: recipient.recipientId,
      conversationId: conversation.id,
      contactId: conversation.contact_id,
      humanAgentTag: verdict.humanAgentTag,
    },
  };
}

/**
 * Cuándo escribió el cliente por última vez en ese hilo.
 *
 * `null` cuando nunca escribió, que es lo que cierra la ventana para un
 * negocio que quiere iniciar la conversación.
 */
async function lastInboundAt(
  db: SupabaseClient,
  conversationId: string
): Promise<Date | null> {
  const { data, error } = await db
    .from('messages')
    .select('created_at')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error('[outbound] last inbound lookup error:', error.message);
    return null;
  }
  const row = data?.[0] as { created_at: string } | undefined;
  return row ? new Date(row.created_at) : null;
}

/**
 * El identificador de destino del contacto en ese canal.
 *
 * En WhatsApp el teléfono de `contacts.phone` va PRIMERO, y no es
 * arbitrario: es la columna que los tres caminos de envío ya usaban, la
 * que el formulario y la importación mantienen, y la que puede
 * corregirse a mano cuando un número está mal escrito. La identidad de
 * canal existe para RECONOCER a quien escribe; para escribirle, el
 * teléfono editable sigue siendo la fuente preferida.
 *
 * Lo que cambió es el caso en que NO hay teléfono. Desde que WhatsApp
 * tiene nombres de usuario, hay personas de las que nunca vamos a
 * recibir el número: para ellas la identidad de canal es el único
 * camino, y sin este respaldo entrarían a la bandeja sin que nadie
 * pudiera contestarles.
 */
export async function resolveRecipientId(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  channel: MessageChannel
): Promise<
  { ok: true; recipientId: string } | { ok: false; reason: OutboundFailure }
> {
  if (channel === 'whatsapp') {
    const { data: contact } = await db
      .from('contacts')
      .select('id, phone')
      .eq('account_id', accountId)
      .eq('id', contactId)
      .maybeSingle<{ id: string; phone: string | null }>();

    if (contact?.phone) {
      const sanitized = sanitizePhoneForMeta(contact.phone);
      if (!isValidE164(sanitized)) {
        return { ok: false, reason: 'invalid_recipient' };
      }
      return { ok: true, recipientId: sanitized };
    }
    // Sin teléfono, el BSUID. Cae al camino común de abajo.
  }

  // OJO: acá NO se puede usar `.maybeSingle()`. Un contacto de WhatsApp
  // tiene hasta DOS identidades del mismo canal —su teléfono y su
  // BSUID—, porque ambas se registran para reconocerlo cuando cambia de
  // forma de identificarse. `.maybeSingle()` da error con dos filas, y
  // el envío fallaría justo para los contactos mejor identificados.
  const { data: identities } = await db
    .from('contact_channels')
    .select('external_id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('channel', channel)
    .returns<{ external_id: string }[]>();

  const candidatas = identities ?? [];
  if (candidatas.length === 0) return { ok: false, reason: 'no_recipient' };

  // En WhatsApp se llega acá solo sin teléfono, así que entre las
  // identidades hay que quedarse con la que NO es un número: un teléfono
  // guardado como identidad pero ausente de `contacts.phone` es un dato
  // viejo, no un destino.
  const elegida =
    channel === 'whatsapp'
      ? candidatas.find((i) => !isPhoneRecipient(i.external_id))
      : candidatas[0];

  if (!elegida) return { ok: false, reason: 'no_recipient' };
  return { ok: true, recipientId: elegida.external_id };
}

/**
 * ¿La cuenta está fuera de su horario de atención ahora mismo?
 *
 * Un fallo leyendo la configuración devuelve `false` —deja pasar— y no
 * `true`. Es deliberado: quedarse callado por no poder leer una
 * columna convertiría un problema de base en clientes sin respuesta,
 * que es peor y mucho más difícil de notar que un mensaje a deshora.
 */
async function fueraDeHorario(
  db: SupabaseClient,
  accountId: string
): Promise<boolean> {
  const { data, error } = await db
    .from('accounts')
    .select('quiet_hours_enabled, business_hours')
    .eq('id', accountId)
    .maybeSingle<{
      quiet_hours_enabled: boolean | null;
      business_hours: unknown;
    }>();

  if (error) {
    console.error('[outbound] no se pudo leer el horario:', error.message);
    return false;
  }
  if (!data?.quiet_hours_enabled) return false;

  return debeEsperar({
    enabled: true,
    hours: parseHorario(data.business_hours),
  });
}

/** True si ese canal ya sabe enviar. Para la UI, que oculta lo que no. */
export function isSendableChannel(channel: MessageChannel): boolean {
  return SENDABLE_CHANNELS.includes(channel);
}
