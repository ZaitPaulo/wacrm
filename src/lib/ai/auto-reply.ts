import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledge } from './knowledge'
import { generateReply } from './generate'
import { aiReplyDebounceMs, buildSystemPrompt } from './defaults'
import { delay, hasNewerCustomerMessage, hasOutboundSince } from './reply-window'
import { buildHandoffSummary } from './handoff'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import { engineSendText } from '@/lib/flows/meta-send'
import { notifyCustomerOfHandoff } from '@/lib/handoff/notify-customer'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

/** Lo que se lee de la conversacion antes de decidir si contestar. */
interface ConversationState {
  assigned_agent_id: string | null
  ai_autoreply_disabled: boolean
  ai_reply_count: number
}

interface DispatchArgs {
  /** Tenancy key — drives config, contact, and whatsapp_config lookups. */
  accountId: string
  conversationId: string
  contactId: string
  /** The account's WhatsApp config owner, used for the outbound send's
   *  audit columns (mirrors how the flow runner passes it through). */
  configOwnerUserId: string
  /** The inbound message this dispatch is reacting to. Every question the
   *  reply window asks is relative to it: did the customer say more after
   *  it, did anyone answer it. */
  inboundMessageId: string
  inboundCreatedAt: string
}

/**
 * AI auto-reply for a freshly-arrived inbound message.
 *
 * Invoked from the WhatsApp webhook's `after()` block, only when no
 * deterministic flow consumed the message (flows win). Mirrors the flow
 * runner's contract: it owns its try/catch and NEVER throws — a failing
 * or slow LLM call must not affect the webhook's 200 to Meta.
 *
 * Runs in two phases. First the cheap gates, which need no waiting
 * (any → silent no-op):
 *   - AI off / auto-reply disabled for the account
 *   - a human agent is assigned (they own the thread)
 *   - auto-reply was disabled for this conversation (prior handoff)
 *   - the per-conversation reply cap is reached
 *
 * Then it waits out the debounce window and re-checks what the world
 * looks like on the other side (any → silent no-op):
 *   - the customer sent a newer message (its dispatch answers instead)
 *   - someone already replied: automation, Flow, or human agent
 *   - the cap slot couldn't be claimed
 *   - there's nothing to reply to
 *
 * The second phase is what keeps the guarantee that a customer gets
 * exactly one answer per burst. Note it asks whether an outbound
 * *happened*, not whether some component was configured to send one:
 * an automation that only tags the contact leaves us free to reply,
 * and a send that failed doesn't silence us either.
 *
 * The 24h WhatsApp session window is inherently open here — we're
 * reacting to a customer message that just landed — so no separate
 * window check is needed.
 */
export async function dispatchInboundToAiReply(
  args: DispatchArgs,
): Promise<void> {
  const {
    accountId,
    conversationId,
    contactId,
    configOwnerUserId,
    inboundMessageId,
    inboundCreatedAt,
  } = args

  // Declarados fuera del try porque el catch los necesita: sin ellos no
  // puede traspasar la conversacion, que es justo lo que hay que hacer
  // cuando algo revienta a mitad de camino.
  let dbCtx: ReturnType<typeof supabaseAdmin> | null = null
  let configCtx: Awaited<ReturnType<typeof loadAiConfig>> = null
  let convCtx: ConversationState | null = null
  let messagesCtx: Awaited<ReturnType<typeof buildConversationContext>> = []

  try {
    const db = supabaseAdmin()
    dbCtx = db

    const config = await loadAiConfig(db, accountId)
    if (!config || !config.autoReplyEnabled) return
    configCtx = config

    const { data: convRow, error: convErr } = await db
      .from('conversations')
      .select('assigned_agent_id, ai_autoreply_disabled, ai_reply_count')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !convRow) return
    const conv = convRow as ConversationState
    convCtx = conv
    if (conv.assigned_agent_id) return // a human owns this thread
    if (conv.ai_autoreply_disabled) return // handed off / turned off here
    // Cheap early-out; the authoritative cap check is the atomic claim
    // below (this read can race a concurrent inbound).
    if (conv.ai_reply_count >= config.autoReplyMaxPerConversation) return

    const inbound = { id: inboundMessageId, createdAt: inboundCreatedAt }

    // Let the burst settle before doing anything expensive. Customers
    // send one thought as several messages, and answering each fragment
    // costs both a reply the customer didn't want and a generation whose
    // context keeps growing with our own output. Every cheap gate ran
    // above, so we only hold the webhook invocation open for dispatches
    // that were otherwise going to reply.
    await delay(aiReplyDebounceMs())

    // The customer kept typing: that later message has its own dispatch
    // and will answer with more context than we have.
    if (await hasNewerCustomerMessage(db, conversationId, inbound)) return

    // Someone already answered while we waited — an automation, a Flow,
    // or a human agent. One reply per inbound; whoever got there first
    // wins. This is what lets automations that *don't* message the
    // customer (tagging, deals, webhooks) run without silencing us.
    if (await hasOutboundSince(db, conversationId, inbound)) return

    // Claim a reply slot before spending anything. The cap check and the
    // increment happen in one UPDATE, so concurrent inbounds can never
    // overshoot the cap. Claiming up front means a conversation at its
    // cap never reaches the provider — the trade-off is that a
    // generation failing afterwards burns a slot without replying, which
    // is cheap next to the tokens it saves.
    const { data: claimed, error: claimErr } = await db.rpc(
      'claim_ai_reply_slot',
      {
        conversation_id: conversationId,
        max_replies: config.autoReplyMaxPerConversation,
      },
    )
    if (claimErr) {
      // A real error here (vs. losing the cap race) is almost always a
      // deploy issue — e.g. `claim_ai_reply_slot` not EXECUTE-able by the
      // service role, or the migration not applied. Log it loudly: a
      // silent return makes "auto-reply never fires" undiagnosable.
      console.error('[ai auto-reply] claim_ai_reply_slot failed:', claimErr)
      return
    }
    if (claimed !== true) return // lost the per-conversation cap race

    const messages = await buildConversationContext(db, conversationId)
    if (messages.length === 0) return
    messagesCtx = messages

    // Account-wide throttle on the shared BYO key. The per-conversation
    // cap bounds one thread; this bounds a burst across many threads (a
    // marketing blast landing 200 replies at once) so we never run the
    // owner's key past the provider's rate limit. Over the limit → skip
    // the auto-reply; the inbound still sits in the inbox for a human.
    const acctLimit = checkRateLimit(
      `ai-autoreply:${accountId}`,
      RATE_LIMITS.aiAutoReplyAccount,
    )
    if (!acctLimit.success) {
      console.warn(
        `[ai auto-reply] account ${accountId} hit the per-account rate limit — skipping this inbound.`,
      )
      return
    }

    // Ground the reply in the account's knowledge base (best-effort).
    const knowledge = await retrieveKnowledge(
      db,
      accountId,
      config,
      latestUserMessage(messages),
    )

    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
    })

    const { text, handoff, usage } = await generateReply({
      config,
      systemPrompt,
      messages,
    })

    // Record token spend on the account's BYO key. Fire-and-forget so it
    // never adds latency to the customer-facing send: `logAiUsage`
    // swallows its own errors, so the floating promise can't reject.
    // Logged regardless of handoff — the provider call happened either
    // way.
    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: 'auto_reply',
      provider: config.provider,
      model: config.model,
      usage,
    })

    if (handoff || !text) {
      // The model can't (or shouldn't) answer — stop auto-replying on
      // this thread and hand it to a human. We (a) pause the bot here
      // (sticky until re-enabled), (b) route the conversation to the
      // configured handoff agent — null leaves it in the shared queue —
      // and (c) leave a short internal note so whoever picks it up has
      // context. Assigning fires the `on_conversation_assigned` trigger,
      // which notifies the agent.
      await handOffToHuman({
        db,
        accountId,
        conversationId,
        contactId,
        configOwnerUserId,
        handoffAgentId: config.handoffAgentId,
        assignedAgentId: conv.assigned_agent_id,
        summary: buildHandoffSummary({
          messages,
          replyCount: conv.ai_reply_count ?? 0,
        }),
      })
      return
    }

    await engineSendText({
      accountId,
      userId: configOwnerUserId,
      conversationId,
      contactId,
      text,
      aiGenerated: true,
    })
  } catch (err) {
    console.error('[ai auto-reply] dispatch failed:', err)

    // EL SILENCIO ES LA PEOR RESPUESTA. Si la generacion revienta —el
    // proveedor sin cuota, una caida, un timeout— hasta aqui el cliente
    // se quedaba esperando y la conversacion seguia sin asignar y con el
    // bot encendido, o sea indistinguible de una atendida. Paso en
    // produccion el 2026-08-26: dos "como continuamos?" y "me interesa
    // ese carro" sin respuesta, con el rate limit de Gemini en el log y
    // nada visible en el CRM.
    //
    // Se recorre el mismo camino que cuando el modelo pide traspaso: el
    // cliente recibe que va un asesor y el chat aparece asignado. La nota
    // interna dice que fue un fallo tecnico, para que quien lo tome sepa
    // que el bot no llego a leer el ultimo mensaje.
    //
    // Solo si se llego a saber contra que conversacion se trabajaba: un
    // fallo antes de eso no tiene a quien traspasar.
    if (dbCtx && convCtx && !convCtx.assigned_agent_id && !convCtx.ai_autoreply_disabled) {
      try {
        await handOffToHuman({
          db: dbCtx,
          accountId,
          conversationId,
          contactId,
          configOwnerUserId,
          handoffAgentId: configCtx?.handoffAgentId ?? null,
          assignedAgentId: convCtx.assigned_agent_id,
          summary:
            '⚠️ La IA no pudo responder (fallo del proveedor). El último mensaje del cliente quedó sin leer por el bot.' +
            (messagesCtx.length > 0
              ? ' ' + buildHandoffSummary({ messages: messagesCtx, replyCount: convCtx.ai_reply_count ?? 0 })
              : ''),
        })
      } catch (handoffErr) {
        // Ultimo recurso fallido. Se registra y se sale: esta funcion no
        // puede lanzar, o se lleva por delante el 200 que espera Meta.
        console.error('[ai auto-reply] emergency handoff failed:', handoffErr)
      }
    }
  }
}

/**
 * Saca la conversacion del bot y se la da a una persona.
 *
 * Hace las tres cosas juntas porque por separado ninguna sirve: (a) apaga
 * la autorespuesta en este hilo —pegajoso hasta que alguien la reactive—,
 * (b) lo asigna al asesor configurado, y null lo deja en la cola
 * compartida, y (c) deja una nota interna con contexto. Asignar dispara
 * `on_conversation_assigned`, que avisa al asesor.
 *
 * Y avisa al cliente. Antes de que eso existiera el asistente
 * simplemente dejaba de responder: el asesor se enteraba, el cliente no,
 * y no habia forma de distinguir "ya va alguien" de "esto se rompio".
 */
async function handOffToHuman(args: {
  db: ReturnType<typeof supabaseAdmin>
  accountId: string
  conversationId: string
  contactId: string
  configOwnerUserId: string
  handoffAgentId: string | null
  assignedAgentId: string | null
  summary: string
}): Promise<void> {
  const update: Record<string, unknown> = {
    ai_autoreply_disabled: true,
    ai_handoff_summary: args.summary,
  }
  // Solo se pone dueño si hay uno configurado Y el hilo no tiene ya el
  // suyo: nunca se pisa una asignacion humana existente.
  if (args.handoffAgentId && !args.assignedAgentId) {
    update.assigned_agent_id = args.handoffAgentId
  }
  await args.db.from('conversations').update(update).eq('id', args.conversationId)

  await notifyCustomerOfHandoff({
    accountId: args.accountId,
    userId: args.configOwnerUserId,
    conversationId: args.conversationId,
    contactId: args.contactId,
  })
}
