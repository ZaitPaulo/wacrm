import type { SupabaseClient } from '@supabase/supabase-js';

import {
  resolveContactByChannel,
  type MessageChannel,
} from '@/lib/contacts/channel-identity';
import { isUniqueViolation } from '@/lib/contacts/dedupe';
import { reopenClosedConversation } from '@/lib/conversations/reopen';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
import { dispatchInboundToFlows } from '@/lib/flows/engine';
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import { recordVehicleInquiry } from '@/lib/inventory/inquiries';

// ============================================================
// El núcleo de la recepción, sin saber de qué canal viene.
//
// Todo lo que ocurre DESPUÉS de entender el mensaje es igual en los tres
// canales: resolver el contacto, resolver su conversación, guardar el
// mensaje una sola vez, y disparar flujos, automatizaciones, IA y
// webhooks públicos. Lo único propio de cada canal es traducir su cuerpo
// a `NormalizedInbound`, y eso vive en el manejador de cada uno.
//
// Este archivo se extrajo del webhook de WhatsApp sin cambiar
// comportamiento. Los comentarios que traían número de issue se
// conservan a propósito: cada uno explica por qué una línea que parece
// arbitraria no lo es.
// ============================================================

/** Quién escribió, en los términos de su canal. */
export interface InboundSender {
  channel: MessageChannel;
  /** `wa_id` en WhatsApp; el identificador de Meta en los otros. */
  externalId: string;
  /** Nombre que informa la plataforma, si informa alguno. */
  name: string | null;
}

/** Un mensaje ya traducido, sea del canal que sea. */
export interface NormalizedMessage {
  kind: 'message';
  /** Id del mensaje en la plataforma: la llave de idempotencia. */
  externalMessageId: string;
  /** Cuándo lo mandó la persona, ya convertido. */
  sentAt: Date;
  /** Uno de los valores que admite `messages.content_type`. */
  contentType: string;
  contentText: string | null;
  mediaUrl: string | null;
  /** Id de la opción tocada, cuando el mensaje es una respuesta a botón. */
  interactiveReplyId: string | null;
  /** Id de plataforma del mensaje citado, cuando hay respuesta. */
  replyToExternalId: string | null;
  /** Etiqueta para el resumen del hilo cuando no hay texto. */
  typeLabel: string;
}

/** Una reacción. No es un mensaje y no se guarda como tal. */
export interface NormalizedReaction {
  kind: 'reaction';
  /** Id de plataforma del mensaje reaccionado. */
  targetExternalId: string;
  /** Vacío o nulo significa que la quitaron. */
  emoji: string | null;
}

export type NormalizedInbound = NormalizedMessage | NormalizedReaction;

export interface ProcessInboundArgs {
  /** Cliente service-role: acá no hay `auth.uid()`. */
  db: SupabaseClient;
  accountId: string;
  /**
   * Usuario al que se atribuyen las filas creadas. `contacts.user_id` y
   * `conversations.user_id` son NOT NULL y un mensaje entrante no tiene
   * un humano detrás.
   */
  auditUserId: string;
  sender: InboundSender;
  inbound: NormalizedInbound;
}

/**
 * Procesa un mensaje entrante ya normalizado.
 *
 * No lanza por un fallo esperable: registra y sale. El llamador está
 * dentro del `after()` del webhook y una excepción acá no debe llevarse
 * el resto del lote.
 */
export async function processInboundMessage(
  args: ProcessInboundArgs
): Promise<void> {
  const { db, accountId, auditUserId, sender, inbound } = args;

  const contactOutcome = await resolveContactByChannel({
    db,
    accountId,
    auditUserId,
    channel: sender.channel,
    externalId: sender.externalId,
    name: sender.name,
  });
  if (!contactOutcome) return;
  const contactId = contactOutcome.contactId;

  const convResult = await findOrCreateConversation(
    db,
    accountId,
    auditUserId,
    contactId,
    sender.channel
  );
  if (!convResult) return;
  const conversation = convResult.conversation;

  // Emit conversation.created as soon as the thread is opened — BEFORE
  // the reaction short-circuit below — so a conversation first opened by
  // a reaction still fires the event, and a subscriber always sees the
  // thread open before its first message.received.
  if (convResult.created) {
    await dispatchWebhookEvent(db, accountId, 'conversation.created', {
      conversation_id: conversation.id,
      contact_id: contactId,
    });
  }

  // Reactions short-circuit here — they aren't messages. We never insert
  // into `messages`, never bump unread_count, never update
  // last_message_text.
  if (inbound.kind === 'reaction') {
    await applyReaction(db, inbound, conversation.id, contactId);
    return;
  }

  // Resolve swipe-reply context if present. A missing parent is fine —
  // we just store NULL and the UI renders the message without a quote.
  let replyToInternalId: string | null = null;
  if (inbound.replyToExternalId) {
    replyToInternalId = await lookupInternalIdByExternalId(
      db,
      inbound.replyToExternalId,
      conversation.id
    );
    if (!replyToInternalId) {
      console.warn(
        '[inbound] reply context parent not found:',
        inbound.replyToExternalId
      );
    }
  }

  // Determine whether this is the contact's very first inbound message
  // BEFORE we insert, so the count is accurate. Covers the case where
  // the contact row already exists (manual add / CSV import) but they've
  // never messaged us before — which new_contact_created wouldn't catch.
  const { count: priorCustomerMsgCount } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer');
  const isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 0;

  // Idempotent insert. Meta retries webhook deliveries (a slow ack, a
  // transient 5xx), and each retry replays the exact same message id. The
  // unique index on (conversation_id, message_id) added in migration 037
  // makes a replay conflict; `ignoreDuplicates` turns that into an ON
  // CONFLICT DO NOTHING, and the `.select()` then returns the inserted row
  // ONLY on a genuine first insert — an empty result means this delivery
  // was a replay. This is the single idempotency boundary that must sit
  // BEFORE the unread bump and all downstream fan-out below (issue #367).
  const { data: insertedRows, error: msgError } = await db
    .from('messages')
    .upsert(
      {
        conversation_id: conversation.id,
        sender_type: 'customer',
        content_type: inbound.contentType,
        content_text: inbound.contentText,
        media_url: inbound.mediaUrl,
        message_id: inbound.externalMessageId,
        status: 'delivered',
        created_at: inbound.sentAt.toISOString(),
        reply_to_message_id: replyToInternalId,
        // Only populated for content_type='interactive'. Migration 010
        // added the column; null for every other content_type so
        // existing inserts behave identically.
        interactive_reply_id: inbound.interactiveReplyId,
      },
      { onConflict: 'conversation_id,message_id', ignoreDuplicates: true }
    )
    // `created_at` va además del id porque la respuesta automática de IA
    // expresa su ventana como "¿ocurrió algo después de ESTA fila?".
    .select('id, created_at');

  if (msgError) {
    console.error('[inbound] error inserting message:', msgError);
    return;
  }

  // Replayed delivery: the message already exists, so acknowledge it as a
  // no-op. Returning here is what keeps a retry from double-bumping
  // unread, re-advancing flows, re-firing automations, re-invoking AI
  // handling, and re-dispatching public webhooks (issue #367).
  if (!insertedRows || insertedRows.length === 0) {
    console.info(
      '[inbound] duplicate inbound message ignored (idempotent replay):',
      inbound.externalMessageId
    );
    return;
  }

  // Update conversation. The unread bump is done DB-side (migration 037's
  // bump_conversation_on_inbound) rather than as a read-modify-write of
  // the snapshot loaded above: two inbound messages for the same
  // conversation can process concurrently, and computing `snapshot + 1`
  // in the app let both reads see the same value and write the same
  // increment, losing one (issue #369).
  const { error: convError } = await db.rpc('bump_conversation_on_inbound', {
    p_conversation_id: conversation.id,
    p_last_message_text: inbound.contentText || `[${inbound.typeLabel}]`,
  });
  if (convError) {
    console.error('[inbound] error updating conversation:', convError);
  }

  // A customer writing again re-opens the thread (issue #409).
  await reopenClosedConversation(db, conversation);

  // If this contact was a recent broadcast recipient, flag the reply
  // so the broadcast's `replied_count` advances.
  await flagBroadcastReplyIfAny(db, accountId, contactId);

  // Si el mensaje conserva el código del CTA de la vitrina, queda
  // atribuido al vehículo que lo originó. Best-effort: no lanza.
  await recordVehicleInquiry(
    accountId,
    contactId,
    conversation.id,
    inbound.contentText
  );

  const inboundText = inbound.contentText ?? '';

  // ============================================================
  // Flow runner dispatch.
  //
  // If the runner consumes the message (it either advanced an active
  // run or started a new one), we suppress the `new_message_received`
  // + `keyword_match` automation triggers for this inbound. Customer
  // is navigating the bot menu, not sending a fresh trigger word.
  //
  // The relationship-level triggers (`new_contact_created`,
  // `first_inbound_message`) still fire even when consumed — those
  // are about WHO is messaging, not what they said.
  // ============================================================
  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId: auditUserId,
    contactId,
    conversationId: conversation.id,
    message: inbound.interactiveReplyId
      ? {
          kind: 'interactive_reply',
          reply_id: inbound.interactiveReplyId,
          reply_title: inbound.contentText ?? '',
          meta_message_id: inbound.externalMessageId,
        }
      : {
          kind: 'text',
          text: inboundText,
          meta_message_id: inbound.externalMessageId,
        },
    isFirstInboundMessage,
  });
  const flowConsumed = flowResult.consumed;

  const automationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
    | 'interactive_reply'
  )[] = [];
  // Content-level triggers are suppressed when a flow consumed the
  // message — see the comment block above.
  if (!flowConsumed) {
    automationTriggers.push('new_message_received', 'keyword_match');
    if (inbound.interactiveReplyId) {
      automationTriggers.push('interactive_reply');
    }
  }
  // new_contact_created fires only when we just auto-created the contact
  // row. first_inbound_message fires whenever this is the contact's
  // first-ever customer-sent message — a superset that also catches
  // manually-imported contacts sending for the first time.
  if (contactOutcome.created) automationTriggers.unshift('new_contact_created');
  if (isFirstInboundMessage)
    automationTriggers.unshift('first_inbound_message');

  // Awaited — not fire-and-forget. We're inside the route's `after()`
  // block, which only keeps the function alive for promises it can see,
  // so a detached dispatch can be frozen part-way through: the log row is
  // inserted, then the steps never run (issue #301 recurring one level
  // down, reported again as #409 logging zero steps).
  for (const triggerType of automationTriggers) {
    await runAutomationsForTrigger({
      accountId,
      triggerType,
      contactId,
      context: {
        message_text: inboundText,
        conversation_id: conversation.id,
        interactive_reply_id: inbound.interactiveReplyId ?? undefined,
      },
    }).catch((err) => console.error('[automations] dispatch failed:', err));
  }

  // AI auto-reply. Runs only for plain-text inbound the deterministic
  // flow runner did NOT consume (flows win over the LLM), and only when
  // the account has enabled it.
  const insertedMessage = insertedRows[0];
  if (
    !flowConsumed &&
    !inbound.interactiveReplyId &&
    inboundText.trim() &&
    insertedMessage
  ) {
    await dispatchInboundToAiReply({
      accountId,
      conversationId: conversation.id,
      contactId,
      configOwnerUserId: auditUserId,
      inboundMessageId: insertedMessage.id,
      inboundCreatedAt: insertedMessage.created_at,
    });
  }

  // message.received webhook (public API). Awaited for the same reason
  // as the dispatches above.
  //
  // `whatsapp_message_id` y `text` conservan su nombre aunque el primero
  // ya no describa lo que trae: es un CONTRATO PÚBLICO que hay
  // suscriptores consumiendo. Renombrarlo por precisión les rompería el
  // integrador sin avisar.
  await dispatchWebhookEvent(db, accountId, 'message.received', {
    conversation_id: conversation.id,
    contact_id: contactId,
    whatsapp_message_id: inbound.externalMessageId,
    content_type: inbound.contentType,
    text: inbound.contentText,
  });
}

// ============================================================
// Helpers
// ============================================================

/**
 * Encuentra o crea la conversación del contacto EN ESE CANAL.
 *
 * We deliberately do NOT use `.single()` here. `.single()` errors on
 * *both* 0 rows and ≥2 rows, and the old code treated any error as
 * "none found" and inserted a new row. So once two conversations existed
 * for a contact (from a race), every subsequent inbound message errored
 * on the lookup and created yet another conversation, snowballing into a
 * wall of duplicate chats (issue #363).
 *
 * El filtro por canal es lo que mantiene esa garantía ahora que un
 * contacto puede tener un hilo por canal (migración 513).
 */
async function findOrCreateConversation(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  contactId: string,
  channel: MessageChannel
): Promise<{
  conversation: { id: string; [key: string]: unknown };
  created: boolean;
} | null> {
  const { data: existingRows, error: findError } = await db
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('channel', channel)
    .order('created_at', { ascending: true })
    .limit(1);

  if (findError) {
    console.error('[inbound] error finding conversation:', findError);
    return null;
  }
  if (existingRows && existingRows.length > 0) {
    return { conversation: existingRows[0], created: false };
  }

  const { data: newConv, error: createError } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: auditUserId,
      contact_id: contactId,
      channel,
    })
    .select()
    .single();

  if (createError) {
    // Lost a race: a concurrent delivery created the conversation
    // between our lookup and insert, and the unique index rejected the
    // duplicate. Re-resolve the winning row instead of dropping the
    // message.
    if (isUniqueViolation(createError)) {
      const { data: raced } = await db
        .from('conversations')
        .select('*')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .eq('channel', channel)
        .order('created_at', { ascending: true })
        .limit(1);
      if (raced && raced.length > 0) {
        return { conversation: raced[0], created: false };
      }
    }
    console.error('[inbound] error creating conversation:', createError);
    return null;
  }

  return { conversation: newConv, created: true };
}

/**
 * Traduce el id de plataforma de un mensaje al id interno, dentro de la
 * misma conversación.
 */
async function lookupInternalIdByExternalId(
  db: SupabaseClient,
  externalMessageId: string,
  conversationId: string
): Promise<string | null> {
  const { data, error } = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('message_id', externalMessageId)
    .maybeSingle();
  if (error) {
    console.error('[inbound] reply-context lookup failed:', error.message);
    return null;
  }
  return data?.id ?? null;
}

/** Guarda o quita una reacción sobre un mensaje ya existente. */
async function applyReaction(
  db: SupabaseClient,
  reaction: NormalizedReaction,
  conversationId: string,
  contactId: string
): Promise<void> {
  const targetInternalId = await lookupInternalIdByExternalId(
    db,
    reaction.targetExternalId,
    conversationId
  );
  if (!targetInternalId) {
    console.warn(
      '[inbound] reaction target not found:',
      reaction.targetExternalId
    );
    return;
  }

  // Sin emoji la reacción se retiró.
  if (!reaction.emoji) {
    const { error } = await db
      .from('message_reactions')
      .delete()
      .eq('message_id', targetInternalId)
      .eq('actor_type', 'customer')
      .eq('actor_id', contactId);
    if (error) {
      console.error('[inbound] reaction delete failed:', error.message);
    }
    return;
  }

  const { error } = await db.from('message_reactions').upsert(
    {
      message_id: targetInternalId,
      conversation_id: conversationId,
      actor_type: 'customer',
      actor_id: contactId,
      emoji: reaction.emoji,
    },
    { onConflict: 'message_id,actor_type,actor_id' }
  );
  if (error) {
    console.error('[inbound] reaction upsert failed:', error.message);
  }
}

/**
 * If an inbound message's sender is on a still-unreplied
 * broadcast_recipients row, flip it to `replied` so the reply count
 * advances on the parent broadcast.
 *
 * Runs on a best-effort basis — failures here must not break the
 * main inbound-message flow, so errors are swallowed with a log.
 */
async function flagBroadcastReplyIfAny(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<void> {
  try {
    // Most recent outbound broadcast in this account that hasn't
    // been replied to yet. Account-scoped so a shared inbox reply
    // marks the broadcast as replied regardless of which teammate
    // sent it.
    //
    // El filtro de cuenta va POR EL JOIN contra `broadcasts`:
    // `broadcast_recipients` no tiene `account_id` propio.
    const { data: recs, error } = await db
      .from('broadcast_recipients')
      .select('id, status, broadcast_id, broadcasts!inner(account_id)')
      .eq('contact_id', contactId)
      .eq('broadcasts.account_id', accountId)
      .in('status', ['sent', 'delivered', 'read'])
      .order('created_at', { ascending: false })
      .limit(1);

    if (error || !recs || recs.length === 0) return;

    const row = recs[0];
    const { error: updErr } = await db
      .from('broadcast_recipients')
      .update({ status: 'replied', replied_at: new Date().toISOString() })
      .eq('id', row.id);

    if (updErr) {
      console.error('Error marking broadcast recipient replied:', updErr);
    }
  } catch (err) {
    console.error('flagBroadcastReplyIfAny failed:', err);
  }
}
