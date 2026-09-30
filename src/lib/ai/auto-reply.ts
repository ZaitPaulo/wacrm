import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledge } from './knowledge'
import { generateReply, type GenerateArgs } from './generate'
import {
  aiProviderRetryDelayMs,
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
import { AiError, type GenerateResult, type HandoffRequest } from './types'
import { detectLeak, LEAK_RETRY_INSTRUCTION, safeFallbackText } from './output-guard'
import { buildInventoryIndex, type InventoryIndex } from './inventory-index'
import { ensureVehicleLinks } from './vehicle-links'
import { loadAdContext } from './ad-context'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import { attachPhotos, loadNewCustomerPhotos, type NewPhotos } from './photos'
import { engineSendText } from '@/lib/flows/meta-send'
import { handoffWhenSentence, notifyCustomerOfHandoff } from '@/lib/handoff/notify-customer'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

/** Lo que se lee de la conversacion antes de decidir si contestar. */
interface ConversationState {
  ai_autoreply_disabled: boolean
  ai_reply_count: number
  /** Transferencias que el gate de datos ya rechazo en este hilo
   *  (migracion 519). Solo la abre el escape por urgencia. */
  ai_handoff_attempts: number
  /** El hilo espera el primer mensaje del asesor tras un traspaso: con
   *  la IA pausada, el bot acompaña (migración 546). */
  ai_waiting_agent_since: string | null
  assigned_agent_id: string | null
}

/**
 * Tope de respuestas del bot mientras el cliente espera al asesor. Corto
 * a propósito: acompaña, no reemplaza al asesor, y cada respuesta cuesta
 * tokens de la clave del titular (bot-fase-2).
 */
const WAITING_MAX_REPLIES = 6

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
      .select(
        'ai_autoreply_disabled, ai_reply_count, ai_handoff_attempts, ai_waiting_agent_since, assigned_agent_id',
      )
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !convRow) return
    const conv = convRow as ConversationState
    convCtx = conv
    // Pausada tras un traspaso, pero el asesor aún no escribe: el bot
    // acompaña en modo espera. Pausada por cualquier otra razón: silencio.
    const waiting = conv.ai_autoreply_disabled && !!conv.ai_waiting_agent_since
    if (conv.ai_autoreply_disabled && !waiting) return // handed off / turned off here
    const maxReplies = waiting
      ? Math.min(config.autoReplyMaxPerConversation, WAITING_MAX_REPLIES)
      : config.autoReplyMaxPerConversation
    // Cheap early-out; the authoritative cap check is the atomic claim
    // below (this read can race a concurrent inbound).
    if (conv.ai_reply_count >= maxReplies) return

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
        max_replies: maxReplies,
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
    const [photos, knowledge, inventory, adContext, waitingContext] = await Promise.all([
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
      buildInventoryIndex(db, accountId, {
        creditMaxAgeYears: config.creditMaxVehicleAgeYears,
      }),
      // De qué anuncio vino el cliente. No lanza: sin él se responde igual.
      loadAdContext(db, conversationId),
      // Quién lo atiende y cuándo, solo en espera. No lanza.
      waiting
        ? loadWaitingContext(db, accountId, conv.assigned_agent_id)
        : Promise.resolve(null),
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
      waiting: waitingContext,
      creditRule: config.creditMaxVehicleAgeYears
        ? { maxAgeYears: config.creditMaxVehicleAgeYears }
        : null,
    })

    // Record token spend on the account's BYO key. Fire-and-forget so it
    // never adds latency to the customer-facing send: `logAiUsage`
    // swallows its own errors, so the floating promise can't reject.
    // Logged per provider call —a retry or a leak regeneration is spend
    // too— and regardless of handoff.
    const safe: SafeReplyContext = {
      db,
      conversationId,
      inbound,
      onUsage: (usage) =>
        void logAiUsage(db, {
          accountId,
          conversationId,
          mode: 'auto_reply',
          provider: config.provider,
          model: config.model,
          usage,
        }),
    }

    const { text, handoff, silent } = await generateSafeReply(
      { config, systemPrompt, messages },
      safe,
    )

    // El modelo eligió no responder (un "ok", un "gracias"): no se envía
    // nada y, sobre todo, no se cae al camino de "respuesta vacía", que
    // traspasa.
    if (silent && !text && !handoff) return

    // La generación tarda 10-15 s, más que la ventana de agrupación. Si
    // el cliente escribió mientras tanto, esta respuesta ya llega tarde:
    // el dispatch de su mensaje nuevo contesta con todo el contexto. Sin
    // esto salían dos respuestas distintas a segundos una de otra
    // (Mauricio, 2026-09-18). Se descarta también un traspaso: lo decide
    // el nuevo.
    if (await hasNewerCustomerMessage(db, conversationId, inbound)) return

    // En espera del asesor el bot solo acompaña: se ignora cualquier
    // pedido de traspaso (ya se traspasó) y una respuesta vacía no vuelve
    // a traspasar. Solo sale el texto, si lo hay.
    if (waiting) {
      if (text) {
        await engineSendText({
          initiative: 'reply',
          accountId,
          userId: configOwnerUserId,
          conversationId,
          contactId,
          text: withVehicleLinks(text, inventory),
          aiGenerated: true,
        })
      }
      return
    }

    // El modelo PIDE transferir; el gate decide. Antes bastaba con que
    // lo pidiera, y por eso salian hilos sin un solo carro mostrado.
    if (handoff) {
      // El nombre del perfil solo hace falta si el cliente no dio el suyo:
      // una lectura, y solo en ese caso.
      const profileName = handoff.nombre?.trim()
        ? null
        : await loadContactName(db, contactId)
      const gate = evaluateHandoffGate({
        request: handoff,
        attempts: conv.ai_handoff_attempts ?? 0,
        profileName,
      })
      if (gate.nameFromProfile && profileName) {
        handoff.nombre = `${profileName.trim()} (perfil de WhatsApp)`
      }

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
            await generateSafeReply(
              {
                config,
                systemPrompt: `${systemPrompt}\n\n${buildGateRetryInstruction({
                  missing: gate.missing,
                  urgent: gate.urgent,
                })}`,
                messages,
              },
              safe,
            )
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

      // Lo que el modelo escribió junto al pedido va ANTES del aviso. Antes
      // se descartaba, y el cliente que preguntó "¿de cuánto sería la
      // cuota?" al completar sus datos solo recibía "Uno de nuestros
      // asesores…" (revisión del 2026-09-29). Si este envío falla, el
      // traspaso sigue: la asignación y el aviso importan más.
      if (text) {
        try {
          await engineSendText({
            initiative: 'reply',
            accountId,
            userId: configOwnerUserId,
            conversationId,
            contactId,
            text: withVehicleLinks(text, inventory),
            aiGenerated: true,
          })
        } catch (sendErr) {
          console.error('[ai auto-reply] no se pudo enviar la respuesta previa al traspaso:', sendErr)
        }
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
    // El cliente escribió mientras se esperaba un reintento: su mensaje
    // nuevo tiene su propio dispatch, que responde con todo el contexto.
    if (err instanceof SupersededError) return

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

/** `contacts.name` tal como vino de WhatsApp, o null. No lanza. */
async function loadContactName(
  db: ReturnType<typeof supabaseAdmin>,
  contactId: string,
): Promise<string | null> {
  try {
    const { data } = await db
      .from('contacts')
      .select('name')
      .eq('id', contactId)
      .maybeSingle<{ name: string | null }>()
    return data?.name?.trim() || null
  } catch {
    return null
  }
}

/**
 * Quién atiende al cliente en espera y cuándo le escribe, para el prompt.
 * Best-effort: sin nombre o sin horario, el bot acompaña igual.
 */
async function loadWaitingContext(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  agentId: string | null,
): Promise<{ agentName: string | null; when: string | null }> {
  const [agentName, when] = await Promise.all([
    (async () => {
      if (!agentId) return null
      try {
        const { data } = await db
          .from('profiles')
          .select('full_name')
          .eq('user_id', agentId)
          .maybeSingle<{ full_name: string | null }>()
        return primerNombre(data?.full_name ?? null)
      } catch {
        return null
      }
    })(),
    handoffWhenSentence(accountId).catch(() => null),
  ])
  return { agentName, when }
}

/** Se abandona el dispatch: llegó un mensaje más nuevo del cliente. */
class SupersededError extends Error {
  constructor() {
    super('superseded by a newer customer message')
    this.name = 'SupersededError'
  }
}

/**
 * Fallos del proveedor que valen un segundo intento. `invalid_key` no
 * está: fallaría igual, y solo sumaría espera antes del traspaso.
 */
const TRANSIENT_AI_ERRORS = new Set([
  'timeout',
  'network_error',
  'rate_limited',
  'provider_error',
  'empty_response',
])

interface SafeReplyContext {
  db: ReturnType<typeof supabaseAdmin>
  conversationId: string
  inbound: { id: string; createdAt: string }
  onUsage: (usage: GenerateResult['usage']) => void
}

/**
 * `generateReply` con dos redes debajo:
 *
 * 1. Un fallo pasajero del proveedor se reintenta UNA vez tras
 *    `aiProviderRetryDelayMs()`. Sin esto, cada tropiezo de Gemini
 *    terminaba en traspaso por "fallo técnico" (22 en septiembre de 2026).
 *    Antes de reintentar se mira si el cliente escribió algo nuevo: si
 *    lo hizo, se abandona con `SupersededError`.
 * 2. El texto pasa por `detectLeak`. Una fuga se regenera una vez con
 *    `LEAK_RETRY_INSTRUCTION`; si persiste, sale el mensaje seguro, o
 *    nada si la respuesta traía un traspaso (el aviso ya le habla al
 *    cliente). El texto filtrado no se envía nunca. Pasó el 2026-09-26:
 *    un cliente recibió el razonamiento del modelo en inglés.
 *
 * El traspaso declarado en la primera respuesta se conserva si la
 * regeneración no lo repite: la fuga está en el texto, no en la intención.
 */
async function generateSafeReply(
  args: GenerateArgs,
  ctx: SafeReplyContext,
): Promise<GenerateResult> {
  const first = await generateWithRetry(args, ctx)
  const firstCheck = detectLeak(first.text)
  if (!firstCheck.leaked) return first

  console.warn(
    `[ai auto-reply] fuga en la conversación ${ctx.conversationId} (${firstCheck.reason}); se regenera`,
  )
  const second = await generateWithRetry(
    { ...args, systemPrompt: `${args.systemPrompt}\n\n${LEAK_RETRY_INSTRUCTION}` },
    ctx,
  )
  const handoff = second.handoff ?? first.handoff
  const secondCheck = detectLeak(second.text)
  if (!secondCheck.leaked) return { ...second, handoff }

  console.error(
    `[ai auto-reply] fuga persistente en la conversación ${ctx.conversationId} (${secondCheck.reason}); se envía el mensaje seguro`,
  )
  return { ...second, handoff, text: handoff ? '' : await safeFallbackText() }
}

async function generateWithRetry(
  args: GenerateArgs,
  ctx: SafeReplyContext,
): Promise<GenerateResult> {
  let result: GenerateResult
  try {
    result = await generateReply(args)
  } catch (err) {
    if (!(err instanceof AiError) || !TRANSIENT_AI_ERRORS.has(err.code)) throw err
    console.warn(
      `[ai auto-reply] fallo pasajero del proveedor (${err.code}) en la conversación ${ctx.conversationId}; se reintenta`,
    )
    await delay(aiProviderRetryDelayMs())
    if (await hasNewerCustomerMessage(ctx.db, ctx.conversationId, ctx.inbound)) {
      throw new SupersededError()
    }
    result = await generateReply(args)
  }
  ctx.onUsage(result.usage)
  return result
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
    // Venta o permuta de un cliente sin asesor: va al asesor de ventas y
    // permutas (migración 544). Con asesor, se queda con el suyo.
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

  // El hilo queda esperando al asesor: el bot pasa a acompañar (responde
  // lo concreto, no califica) hasta que una persona escriba. Cupo nuevo
  // para ese modo y avisos de plazo en cero para este traspaso
  // (bot-fase-2-traspaso-sin-perdidas).
  const { error: waitErr } = await args.db
    .from('conversations')
    .update({
      ai_waiting_agent_since: new Date().toISOString(),
      ai_reply_count: 0,
      handoff_reminded_at: null,
      handoff_escalated_at: null,
    })
    .eq('id', args.conversationId)
  if (waitErr) {
    console.error('[ai auto-reply] no se pudo marcar la espera del asesor:', waitErr)
  }

  await notifyCustomerOfHandoff({
    accountId: args.accountId,
    userId: args.configOwnerUserId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    agentName: primerNombre(resultado.agent?.fullName),
  })
}
