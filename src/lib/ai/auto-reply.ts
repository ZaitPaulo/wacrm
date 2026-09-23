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
import { pickHandoffAgent, primerNombre, type HandoffAgent } from './pick-agent'
import { createHandoffDeal } from './handoff-deal'
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
  assigned_agent_id: string | null
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
      .select('assigned_agent_id, ai_autoreply_disabled, ai_reply_count, ai_handoff_attempts')
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
        handoffAgentId: config.handoffAgentId,
        assignedAgentId: conv.assigned_agent_id,
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
        handoffAgentId: config.handoffAgentId,
        assignedAgentId: conv.assigned_agent_id,
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

/** El texto con el enlace de cada vehículo que nombra y no lo trae. Sin
 *  índice no hay contra qué reconocerlos, y sale tal cual. */
function withVehicleLinks(text: string, inventory: InventoryIndex | null): string {
  return inventory ? ensureVehicleLinks(text, inventory.entries) : text
}

/**
 * Saca la conversacion del bot y se la da a una persona.
 *
 * Hace las cosas juntas porque por separado ninguna sirve: (a) apaga la
 * autorespuesta en este hilo —pegajoso hasta que alguien la reactive—,
 * (b) resuelve el asesor: respeta al que ya tenga el hilo, y si no hay,
 * usa el fijo de Ajustes o, en su defecto, `pickHandoffAgent`
 * (continuidad por historial, luego carga); (c) deja una nota interna con
 * contexto, y (d) crea el negocio del embudo a nombre de ese asesor.
 * Asignar dispara `on_conversation_assigned`, que avisa al asesor.
 *
 * Y avisa al cliente. Antes de que eso existiera el asistente
 * simplemente dejaba de responder: el asesor se enteraba, el cliente no,
 * y no habia forma de distinguir "ya va alguien" de "esto se rompio".
 *
 * No lanza por el negocio: si su creacion falla se registra y el
 * traspaso sigue.
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
  /** Lo que el bot recolectó, para que el negocio no nazca en blanco.
   *  Ausente en el traspaso por fallo del proveedor. */
  request?: HandoffRequest | null
}): Promise<void> {
  const update: Record<string, unknown> = {
    ai_autoreply_disabled: true,
    ai_handoff_summary: args.summary,
  }

  // A quien le toca. Nunca se pisa una asignacion humana existente: si el
  // hilo ya tiene dueño, ese sigue siendo el suyo.
  //
  // El dueño se RELEE aca en vez de fiarse de `args.assignedAgentId`.
  // Ese valor es la foto del principio del dispatch, y el dispatch se
  // sale si ya habia asesor (el gate de "a human owns this thread"), asi
  // que en la foto siempre es null. Pero entre la foto y este punto
  // pasan segundos —la ventana de respuesta, la generacion—, y en ese
  // rato un asesor puede haber tomado el hilo. Con la foto, el traspaso
  // lo pisaba y el negocio nacia sin su dueño.
  const duenoActual = await asignadoAhora(args.db, args.conversationId, args.assignedAgentId)
  let destinatario: HandoffAgent | null = null
  // Quien queda como asesor del negocio: el que recibe el hilo ahora, o
  // el que ya lo tenia. Solo el primero se escribe en la conversacion.
  let asesorDelNegocio: HandoffAgent | null = null
  if (duenoActual) {
    // El hilo ya tiene dueño humano: el negocio es suyo. Si no, nace en
    // "Sin asignar" mientras la conversacion le cuenta a el en la tabla
    // de rendimiento.
    asesorDelNegocio = await asesorPorUsuario(args.db, args.accountId, duenoActual)
  } else {
    if (args.handoffAgentId) {
      // Un asesor fijo en Ajustes es una decision explicita del admin y
      // no se sustituye por el reparto. Se busca su nombre solo para
      // podercelo decir al cliente.
      destinatario = await asesorPorUsuario(args.db, args.accountId, args.handoffAgentId)
    } else {
      // Sin asesor fijo: continuidad si el hilo ya tuvo asesor, y si no,
      // reparto por carga. Antes esto dejaba el hilo en la cola
      // compartida, que en la practica era nadie.
      destinatario = await pickHandoffAgent(
        args.db,
        args.accountId,
        args.conversationId,
      )
    }
    if (destinatario) update.assigned_agent_id = destinatario.userId
    asesorDelNegocio = destinatario
  }

  await args.db.from('conversations').update(update).eq('id', args.conversationId)

  // El negocio del embudo, con el asesor que acaba de recibir el hilo.
  //
  // Va DESPUES del update y no dentro: si el insert del negocio fallara
  // antes, el cliente se quedaria sin asesor por una tarjeta. Y va
  // antes del aviso al cliente solo por orden de lectura — no puede
  // lanzar, asi que no retrasa ni bloquea nada.
  //
  // Un hilo que YA tenia dueño humano tambien pasa por aqui: no es un
  // traspaso nuevo, pero si nunca se le creo la tarjeta, esta es la
  // ocasion. El indice unico se encarga de que no haya una segunda.
  const negocio = await createHandoffDeal(args.db, {
    accountId: args.accountId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    ownerUserId: args.configOwnerUserId,
    assignedProfileId: asesorDelNegocio?.profileId ?? null,
    request: args.request ?? null,
    summary: args.summary,
  })
  if (negocio.status === 'failed' || negocio.status === 'skipped') {
    // Se registra y se sigue: perder una tarjeta del embudo es
    // preferible a dejar a un cliente esperando.
    console.warn(
      `[ai auto-reply] sin negocio para la conversacion ${args.conversationId}: ${negocio.reason}`,
    )
  }

  await notifyCustomerOfHandoff({
    accountId: args.accountId,
    userId: args.configOwnerUserId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    agentName: primerNombre(destinatario?.fullName),
  })
}

/**
 * Quien tiene asignada la conversacion EN ESTE MOMENTO.
 *
 * Si la lectura falla se usa la foto que traia el dispatch: es lo que se
 * hacia antes, y un traspaso no se cae por una lectura.
 */
async function asignadoAhora(
  db: ReturnType<typeof supabaseAdmin>,
  conversationId: string,
  foto: string | null,
): Promise<string | null> {
  const { data, error } = await db
    .from('conversations')
    .select('assigned_agent_id')
    .eq('id', conversationId)
    .maybeSingle()
  if (error || !data) return foto
  return (data as { assigned_agent_id: string | null }).assigned_agent_id
}

/**
 * Un asesor de la cuenta —el fijo de Ajustes o el que ya tenia el hilo—
 * resuelto a `HandoffAgent` a partir de su `user_id`.
 *
 * Se lee su perfil por dos cosas: el nombre, para poder decirselo al
 * cliente, y `profiles.id`, que es lo que pide `deals.assigned_to` —no
 * su `user_id`, que es lo que guardan la configuracion y
 * `conversations.assigned_agent_id`—. Se filtra por cuenta porque un
 * mismo usuario puede tener perfil en mas de una.
 *
 * Un fallo aqui solo cuesta el nombre en el mensaje y el asignado de la
 * tarjeta, nunca la transferencia.
 */
async function asesorPorUsuario(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  userId: string,
): Promise<HandoffAgent> {
  const { data } = await db
    .from('profiles')
    .select('id, full_name')
    .eq('account_id', accountId)
    .eq('user_id', userId)
    .maybeSingle()
  const perfil = data as { id: string; full_name: string | null } | null
  return {
    userId,
    fullName: perfil?.full_name ?? '',
    profileId: perfil?.id ?? null,
  }
}
