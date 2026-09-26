import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledge } from './knowledge'
import { generateReply } from './generate'
import {
  aiReplyDebounceMs,
  buildGateRetryInstruction,
  buildSystemPrompt,
} from './defaults'
import { delay, hasNewerCustomerMessage, hasOutboundSince } from './reply-window'
import { buildHandoffSummary } from './handoff'
import { evaluateHandoffGate } from './handoff-gate'
import { primerNombre } from './pick-agent'
import { buildHandoffDealTitle } from './handoff-deal'
import { aiHandoffAssign } from '@/lib/assignment/auto-assign'
import type { HandoffRequest } from './types'
import { buildInventoryIndex, type InventoryIndex } from './inventory-index'
import { ensureVehicleLinks } from './vehicle-links'
import { loadAdContext } from './ad-context'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import { attachPhotos, loadNewCustomerPhotos, type NewPhotos } from './photos'
import { engineSendText } from '@/lib/flows/meta-send'
import { notifyCustomerOfHandoff } from '@/lib/handoff/notify-customer'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

/** Lo que se lee de la conversacion antes de decidir si contestar. */
interface ConversationState {
  ai_autoreply_disabled: boolean
  ai_reply_count: number
  /** Transferencias que el gate de datos ya rechazo en este hilo
   *  (migracion 519). Solo la abre el escape por urgencia. */
  ai_handoff_attempts: number
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
 *   - auto-reply was disabled for this conversation (prior handoff, a
 *     human took over, or an agent wrote)
 *
 * Tener un asesor asignado YA NO calla al bot. Desde el cambio
 * `sticky-weighted-assignment` el asesor de un contacto es pegajoso: un
 * lead con asesor que vuelve a escribir semanas después lo atiende
 * primero el bot, y cuando traspasa va a su mismo asesor. Lo único que
 * calla a la IA es `ai_autoreply_disabled`, que ponen el traspaso,
 * "Tomar el control" y el primer mensaje de un asesor desde la bandeja
 * (`send-message.ts`). Ver `returning-lead-bot-reactivation`.
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
  let convCtx: ConversationState | null = null
  let messagesCtx: Awaited<ReturnType<typeof buildConversationContext>> = []

  try {
    const db = supabaseAdmin()
    dbCtx = db

    const config = await loadAiConfig(db, accountId)
    if (!config || !config.autoReplyEnabled) return

    const { data: convRow, error: convErr } = await db
      .from('conversations')
      .select('ai_autoreply_disabled, ai_reply_count, ai_handoff_attempts')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !convRow) return
    const conv = convRow as ConversationState
    convCtx = conv
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

    const textMessages = await buildConversationContext(db, conversationId)
    messagesCtx = textMessages

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

    // Tres lecturas independientes, en paralelo: la espera es la de la mas
    // lenta, no la suma. La lenta suelen ser las fotos —dos llamadas a
    // Meta cada una—, y no tienen por que sumarse al knowledge base.
    const [photos, knowledge, inventory, adContext] = await Promise.all([
      // No lanza por contrato. El catch es para que ni un fallo imprevisto
      // de las fotos acabe en traspaso: se responde sin ellas.
      loadNewCustomerPhotos(db, { accountId, conversationId }).catch(
        (err): NewPhotos => {
          console.warn('[ai auto-reply] customer photos skipped:', err)
          return { count: 0, images: [] }
        },
      ),
      // Ground the reply in the account's knowledge base (best-effort).
      // Una foto sola no trae texto con que buscar.
      textMessages.length > 0
        ? retrieveKnowledge(db, accountId, config, latestUserMessage(textMessages))
        : Promise.resolve<string[]>([]),
      // El inventario COMPLETO, no solo lo que la busqueda semantica
      // acerto a recuperar: sin esto el bot le dice a un cliente que no
      // hay nada en su presupuesto viendo 5 fichas de 123. Con fotos es
      // ademas contra lo que se reconoce el carro de la captura.
      buildInventoryIndex(db, accountId),
      // De qué anuncio vino el cliente. No lanza: sin él se responde igual.
      loadAdContext(db, conversationId),
    ])

    // Las fotos se pegan ANTES de decidir si hay algo que responder: una
    // foto sola no deja texto, y el cliente que abre la conversacion con
    // la captura de un carro se quedaria sin respuesta.
    const messages = attachPhotos(textMessages, photos)
    if (messages.length === 0) return
    messagesCtx = messages

    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
      inventory,
      hasPhotos: messages.some((m) => m.images?.length),
      adContext,
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

    // La generación tarda 10-15 s, más que la ventana de agrupación. Si
    // el cliente escribió mientras tanto, esta respuesta ya llega tarde:
    // el dispatch de su mensaje nuevo contesta con todo el contexto. Sin
    // esto salían dos respuestas distintas a segundos una de otra
    // (Mauricio, 2026-09-18). Se descarta también un traspaso: lo decide
    // el nuevo.
    if (await hasNewerCustomerMessage(db, conversationId, inbound)) return

    // El modelo PIDE transferir; el gate decide. Antes bastaba con que
    // lo pidiera, y por eso salian hilos sin un solo carro mostrado.
    if (handoff) {
      const gate = evaluateHandoffGate({
        request: handoff,
        attempts: conv.ai_handoff_attempts ?? 0,
      })

      if (!gate.transfer) {
        // Nada de transferir: ni asignar asesor, ni apagar el bot, ni
        // avisarle al cliente. El hilo sigue siendo nuestro y lo que
        // toca es completar los datos que faltan.
        await db
          .from('conversations')
          .update({ ai_handoff_attempts: (conv.ai_handoff_attempts ?? 0) + 1 })
          .eq('id', conversationId)

        // Casi siempre el modelo escribe algo junto al marcador; ese
        // texto ya suele preguntar lo que falta y sale tal cual. Solo
        // cuando manda el marcador pelado hay que volver a generar.
        const reply =
          text ||
          (
            await generateReply({
              config,
              systemPrompt: `${systemPrompt}\n\n${buildGateRetryInstruction({
                missing: gate.missing,
                urgent: gate.urgent,
              })}`,
              messages,
            })
          ).text

        if (reply) {
          await engineSendText({
      // La IA y el handoff solo hablan porque el cliente escribio.
      initiative: 'reply',
            accountId,
            userId: configOwnerUserId,
            conversationId,
            contactId,
            text: withVehicleLinks(reply, inventory),
            aiGenerated: true,
          })
        }
        return
      }

      await handOffToHuman({
        db,
        accountId,
        conversationId,
        contactId,
        configOwnerUserId,
        summary: buildHandoffSummary({
          messages,
          replyCount: conv.ai_reply_count ?? 0,
          request: handoff,
          urgent: gate.urgent,
          ad: adContext,
        }),
        // Lo mismo que va a la nota va al negocio: nombre, vehículo de
        // interés y motivo, para que el asesor no tenga que releer el
        // hilo entero desde la tarjeta del embudo.
        request: handoff,
      })
      return
    }

    if (!text) {
      // Camino de FALLO, no decision del modelo: la generacion volvio
      // vacia. El gate no aplica aqui a proposito — la alternativa es el
      // silencio, que es justo lo que dejo a dos clientes esperando el
      // 2026-08-26. Ante la duda, que entre un humano.
      await handOffToHuman({
        db,
        accountId,
        conversationId,
        contactId,
        configOwnerUserId,
        summary: buildHandoffSummary({
          messages,
          replyCount: conv.ai_reply_count ?? 0,
          ad: adContext,
        }),
      })
      return
    }

    await engineSendText({
      // La IA y el handoff solo hablan porque el cliente escribio.
      initiative: 'reply',
      accountId,
      userId: configOwnerUserId,
      conversationId,
      contactId,
      text: withVehicleLinks(text, inventory),
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
    if (dbCtx && convCtx && !convCtx.ai_autoreply_disabled) {
      try {
        await handOffToHuman({
          db: dbCtx,
          accountId,
          conversationId,
          contactId,
          configOwnerUserId,
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

/** El texto con el enlace de cada vehículo que nombra y no lo trae. Sin
 *  índice no hay contra qué reconocerlos, y sale tal cual. */
function withVehicleLinks(text: string, inventory: InventoryIndex | null): string {
  return inventory ? ensureVehicleLinks(text, inventory.entries) : text
}

/**
 * Saca la conversacion del bot y se la da a una persona.
 *
 * Todo lo que importa ocurre en UNA transaccion de la base
 * (`ai_handoff_assign`, migracion 537): elige al asesor —conserva al que
 * ya tenga el hilo, si no el del contacto por continuidad, si no el
 * reparto por porcentajes—, crea el negocio con el titulo rico ANTES de
 * escribir el asesor (asi el negocio generico del trigger de asignacion
 * no le gana el lugar), y pausa la IA con la nota en el mismo UPDATE que
 * el asesor, que es lo que deja al aviso de asignacion (521) llevar la
 * nota. Si el asesor se conserva —el lead que vuelve— la base le manda
 * un aviso propio.
 *
 * Antes esto eran tres escrituras sueltas desde aca y el reparto por
 * carga en TypeScript; dos traspasos simultaneos podian elegir al mismo
 * asesor. Ver `openspec/changes/sticky-weighted-assignment/design.md`.
 *
 * Y avisa al cliente, con el primer nombre de quien lo va a atender
 * —tambien cuando es su asesor de siempre—.
 *
 * Si la RPC falla (la migracion no esta, la base no responde), el bot se
 * pausa igual y la nota se guarda: un cliente que pidio un humano no
 * puede quedarse hablando con el bot. El hilo queda en la cola
 * compartida y el job de conversaciones olvidadas lo recoge.
 */
async function handOffToHuman(args: {
  db: ReturnType<typeof supabaseAdmin>
  accountId: string
  conversationId: string
  contactId: string
  configOwnerUserId: string
  summary: string
  /** Lo que el bot recolecto, para que el negocio no nazca en blanco.
   *  Ausente en el traspaso por fallo del proveedor. */
  request?: HandoffRequest | null
}): Promise<void> {
  const resultado = await aiHandoffAssign(args.db, {
    conversationId: args.conversationId,
    summary: args.summary,
    dealTitle: buildHandoffDealTitle(args.request ?? null),
    // Venta o permuta van al asesor de ventas y permutas (migración 543).
    reason: args.request?.motivo ?? null,
  })

  if (resultado.outcome === 'failed') {
    const { error } = await args.db
      .from('conversations')
      .update({ ai_autoreply_disabled: true, ai_handoff_summary: args.summary })
      .eq('id', args.conversationId)
    if (error) {
      console.error('[ai auto-reply] no se pudo pausar el bot tras el traspaso:', error)
    }
  } else if (resultado.deal?.startsWith('skipped')) {
    // Se registra y se sigue: perder una tarjeta del embudo es
    // preferible a dejar a un cliente esperando.
    console.warn(
      `[ai auto-reply] sin negocio para la conversacion ${args.conversationId}: ${resultado.deal}`,
    )
  }

  await notifyCustomerOfHandoff({
    accountId: args.accountId,
    userId: args.configOwnerUserId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    agentName: primerNombre(resultado.agent?.fullName),
  })
}
