import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AiConfig, HandoffRequest } from './types'

// Shared, hoisted mock state so the module mocks can close over it.
const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  generateReply: vi.fn(),
  engineSendText: vi.fn(),
  delay: vi.fn(),
  hasNewerCustomerMessage: vi.fn(),
  hasOutboundSince: vi.fn(),
  state: {
    conv: null as Record<string, unknown> | null,
    autoResponders: [] as { id: string }[],
    claim: true as boolean,
    updatePayload: null as Record<string, unknown> | null,
    rpcCalls: [] as { name: string; args: unknown }[],
    profiles: [] as { user_id: string; full_name: string }[],
    openConversations: [] as (string | null)[],
    inventory: [] as Record<string, unknown>[],
  },
}))

vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('./context', () => ({ buildConversationContext: h.buildConversationContext }))
vi.mock('./knowledge', () => ({ retrieveKnowledge: h.retrieveKnowledge }))
vi.mock('./generate', () => ({ generateReply: h.generateReply }))
vi.mock('@/lib/flows/meta-send', () => ({ engineSendText: h.engineSendText }))
vi.mock('./reply-window', () => ({
  delay: h.delay,
  hasNewerCustomerMessage: h.hasNewerCustomerMessage,
  hasOutboundSince: h.hasOutboundSince,
}))
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'automations') {
        // .select().eq().eq().in().limit() → active auto-responders
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          limit: () =>
            Promise.resolve({ data: h.state.autoResponders, error: null }),
        }
        return chain
      }
      if (table === 'inventory_vehicles') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => Promise.resolve({ data: h.state.inventory, error: null }),
        }
        return chain
      }
      if (table === 'profiles') {
        // Dos formas: .select().eq().in().order() lista los asesores de
        // la cuenta, y .select().eq().maybeSingle() lee el nombre de uno.
        let buscado: string | null = null
        const chain = {
          select: () => chain,
          eq: (_col: string, value: string) => {
            buscado = value
            return chain
          },
          in: () => chain,
          order: () => Promise.resolve({ data: h.state.profiles, error: null }),
          maybeSingle: () =>
            Promise.resolve({
              data: h.state.profiles.find((p) => p.user_id === buscado) ?? null,
              error: null,
            }),
        }
        return chain
      }

      // conversations. El estado del hilo sale de .maybeSingle(); la
      // carga por asesor se pide con .select().eq().eq() y se espera
      // directamente, sin metodo terminal — de ahi el `then`.
      const conversations = {
        select: () => conversations,
        eq: () => conversations,
        maybeSingle: () => Promise.resolve({ data: h.state.conv, error: null }),
        then: (
          resolve: (v: { data: unknown; error: null }) => unknown,
        ) =>
          resolve({
            data: h.state.openConversations.map((assigned_agent_id) => ({
              assigned_agent_id,
            })),
            error: null,
          }),
        update: (payload: Record<string, unknown>) => {
          h.state.updatePayload = payload
          return { eq: () => Promise.resolve({ error: null }) }
        },
      }
      return conversations
    },
    rpc: (name: string, args: unknown) => {
      h.state.rpcCalls.push({ name, args })
      return Promise.resolve({ data: h.state.claim, error: null })
    },
  }),
}))

import { dispatchInboundToAiReply } from './auto-reply'
import { clearInventoryIndexCache } from './inventory-index'

const ARGS = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  configOwnerUserId: 'user-1',
  inboundMessageId: 'msg-2',
  inboundCreatedAt: '2026-07-30T20:12:33.000Z',
}

function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    embeddingsProvider: 'openai',
    ...overrides,
  }
}

/** Peticion de transferencia con los cuatro datos: la que el gate deja
 *  pasar. Los tests que prueban el bloqueo quitan campos. */
function handoffRequest(overrides: Partial<HandoffRequest> = {}): HandoffRequest {
  return {
    nombre: 'Carlos',
    presupuesto: '30000000',
    interes: 'Kia Sportage 2019',
    credito: true,
    motivo: 'visita',
    ...overrides,
  }
}

beforeEach(() => {
  h.state.conv = {
    assigned_agent_id: null,
    ai_autoreply_disabled: false,
    ai_reply_count: 0,
    ai_handoff_attempts: 0,
  }
  h.state.autoResponders = []
  h.state.claim = true
  h.state.updatePayload = null
  h.state.rpcCalls = []
  h.state.profiles = [
    { user_id: 'u-juan', full_name: 'Juan Marino Arias' },
    { user_id: 'u-brayan', full_name: 'Brayan Hernández' },
  ]
  h.state.openConversations = ['u-juan', 'u-juan']
  h.state.inventory = [
    {
      public_ref: 'XGCW8S',
      brand: 'RENAULT',
      model: 'SANDERO GT',
      year: 2010,
      price: 22_000_000,
      mileage: 179_200,
      transmission: 'manual',
      body_type: 'hatchback',
    },
  ]
  // El índice se cachea por cuenta en memoria del módulo; sin esto un
  // test heredaría el inventario del anterior.
  clearInventoryIndexCache()
  h.loadAiConfig.mockResolvedValue(aiConfig())
  h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'hi' }])
  h.retrieveKnowledge.mockResolvedValue([])
  h.generateReply.mockResolvedValue({ text: 'Hello!', handoff: null })
  h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'm1' })
  h.delay.mockResolvedValue(undefined)
  // Default: nothing else happened while we waited.
  h.hasNewerCustomerMessage.mockResolvedValue(false)
  h.hasOutboundSince.mockResolvedValue(false)
})

describe('dispatchInboundToAiReply — eligibility gates', () => {
  it('claims a slot and sends on the happy path', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.rpcCalls).toEqual([
      {
        name: 'claim_ai_reply_slot',
        args: { conversation_id: 'conv-1', max_replies: 3 },
      },
    ])
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', text: 'Hello!' }),
    )
  })

  it('grounds the reply in retrieved knowledge', async () => {
    h.retrieveKnowledge.mockResolvedValue(['Returns accepted within 30 days.'])
    await dispatchInboundToAiReply(ARGS)
    expect(h.retrieveKnowledge).toHaveBeenCalled()
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('Returns accepted within 30 days.')
  })

  it('replies even when an active message-level automation exists', async () => {
    // Used to be the opposite: the mere existence of an active
    // keyword_match automation silenced the LLM account-wide, so an
    // automation that only tagged the contact left the customer with no
    // answer at all. What silences the LLM now is an actual outbound.
    h.state.autoResponders = [{ id: 'auto-1' }]
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalledTimes(1)
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
  })

  it('does not send when the atomic slot claim loses the race', async () => {
    h.state.claim = false
    await dispatchInboundToAiReply(ARGS)
    // It still attempts the claim, but the send is skipped.
    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when AI is off / not configured', async () => {
    h.loadAiConfig.mockResolvedValue(null)
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply is disabled for the account', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when a human agent is assigned', async () => {
    h.state.conv = {
      assigned_agent_id: 'agent-9',
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply was disabled on this conversation', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when the per-conversation cap is reached', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 3,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when there is nothing to reply to', async () => {
    h.buildConversationContext.mockResolvedValue([])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — handoff', () => {
  it('disables auto-reply, writes a summary, and tells the customer on handoff', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: handoffRequest() })
    await dispatchInboundToAiReply(ARGS)
    // Exactly one send, and it is NOT the model's output — that was
    // empty, which is what triggered the handoff. It is the notice that
    // an agent is taking over. Before this, the assistant went silent
    // mid-conversation and the customer had no way to tell "someone is
    // coming" from "it broke".
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    // Language-agnostic on purpose: the notice comes from the catalogue
    // for whatever locale the install runs in.
    expect(h.engineSendText.mock.calls[0][0].text).toMatch(/agent|asesor|advisor/i)
    // The slot is claimed before generating now, so a handoff burns one.
    // Harmless: handoff sets ai_autoreply_disabled, so the thread won't
    // auto-reply again regardless of the remaining count.
    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain(
      'El bot traspasó la conversación',
    )
    // Sin asesor configurado ya NO se queda sin dueño: se reparte al de
    // menos carga. Antes caía en la cola compartida, que en la práctica
    // era nadie.
    expect(h.state.updatePayload).toHaveProperty('assigned_agent_id')
  })

  // Pasó en producción el 2026-08-26: la cuota gratuita de Gemini se agotó
  // a mitad de una conversación y el cliente escribió "¿cómo continuamos?"
  // y "me interesa ese carro" sin recibir NADA. El error quedaba solo en
  // el log; la conversación seguía sin asignar y con el bot encendido, o
  // sea indistinguible de una atendida. Un silencio es la peor respuesta
  // posible para alguien que ya eligió el carro.
  it('traspasa a un humano cuando el proveedor falla, en vez de callar', async () => {
    h.generateReply.mockRejectedValue(new Error('Gemini rate limit reached'))

    await dispatchInboundToAiReply(ARGS)

    // El cliente recibe el aviso de que va un asesor.
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.engineSendText.mock.calls[0][0].text).toMatch(/agent|asesor|advisor/i)
    // Y el hilo queda fuera del bot, con la nota diciendo que fue técnico.
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('no pudo responder')
  })

  it('el traspaso de emergencia también respeta al asesor configurado', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-7' }))
    h.generateReply.mockRejectedValue(new Error('boom'))

    await dispatchInboundToAiReply(ARGS)

    expect(h.state.updatePayload).toMatchObject({ assigned_agent_id: 'agent-7' })
  })

  // El contrato de esta funcion es no lanzar nunca: el webhook tiene que
  // devolverle 200 a Meta pase lo que pase.
  it('no lanza aunque el propio traspaso de emergencia falle', async () => {
    h.generateReply.mockRejectedValue(new Error('boom'))
    h.engineSendText.mockRejectedValue(new Error('meta caida'))

    await expect(dispatchInboundToAiReply(ARGS)).resolves.toBeUndefined()
  })

  it('routes to the configured handoff agent on handoff', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-7' }))
    h.generateReply.mockResolvedValue({ text: '', handoff: handoffRequest() })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'agent-7',
    })
  })

  it('still hands off when the customer notice cannot be delivered', async () => {
    // The courtesy message is best-effort: the thread must still be
    // parked and routed even if the send fails, or a Meta hiccup would
    // strand the customer with nobody assigned.
    h.engineSendText.mockRejectedValue(new Error('meta down'))
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-7' }))
    h.generateReply.mockResolvedValue({ text: '', handoff: handoffRequest() })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'agent-7',
    })
  })
})

describe('dispatchInboundToAiReply — reply window', () => {
  it('stands down when a newer customer message arrived, without spending tokens', async () => {
    h.hasNewerCustomerMessage.mockResolvedValue(true)

    await dispatchInboundToAiReply(ARGS)

    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('stands down when something already replied to the customer', async () => {
    // Covers an automation, a Flow or a human agent alike — the query
    // behind this doesn't ask who sent it.
    h.hasOutboundSince.mockResolvedValue(true)

    await dispatchInboundToAiReply(ARGS)

    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('waits for the debounce window before reading the transcript', async () => {
    await dispatchInboundToAiReply(ARGS)

    expect(h.delay).toHaveBeenCalledWith(8000)
    // Order matters: waiting after building the context would model the
    // burst as it looked before the customer finished typing.
    expect(h.delay.mock.invocationCallOrder[0]).toBeLessThan(
      h.buildConversationContext.mock.invocationCallOrder[0],
    )
  })

  it('checks the window against the message that triggered it', async () => {
    await dispatchInboundToAiReply(ARGS)

    for (const fn of [h.hasNewerCustomerMessage, h.hasOutboundSince]) {
      expect(fn).toHaveBeenCalledWith(expect.anything(), 'conv-1', {
        id: 'msg-2',
        createdAt: '2026-07-30T20:12:33.000Z',
      })
    }
  })

  it('skips the wait entirely when the gates already rule the reply out', async () => {
    h.state.conv = {
      assigned_agent_id: 'agent-1',
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
    }

    await dispatchInboundToAiReply(ARGS)

    // Holding the webhook invocation open for 8s on a dispatch that was
    // never going to reply is pure waste.
    expect(h.delay).not.toHaveBeenCalled()
  })

  it('claims the cap slot before spending tokens', async () => {
    h.state.claim = false

    await dispatchInboundToAiReply(ARGS)

    expect(h.state.rpcCalls.map((c) => c.name)).toContain('claim_ai_reply_slot')
    expect(h.generateReply).not.toHaveBeenCalled()
  })
})

// El bug que motivó el gate: el 2026-09-07 dos clientes fueron
// transferidos en su segundo turno, apenas dijeron el presupuesto, sin
// que el bot les hubiera mostrado un solo vehículo. El modelo pedía
// transferir y el código obedecía.
describe('dispatchInboundToAiReply — gate de datos del handoff', () => {
  it('no transfiere cuando faltan datos: sigue atendiendo el hilo', async () => {
    h.generateReply.mockResolvedValue({
      text: '¿Y con cuánto cuentas?',
      handoff: handoffRequest({ presupuesto: null }),
    })

    await dispatchInboundToAiReply(ARGS)

    // Ni asignar, ni apagar el bot, ni avisar al cliente.
    expect(h.state.updatePayload).not.toHaveProperty('ai_autoreply_disabled')
    expect(h.state.updatePayload).not.toHaveProperty('assigned_agent_id')
    // Lo que sale es la respuesta del bot, no el aviso de asignación.
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.engineSendText.mock.calls[0][0].text).toBe('¿Y con cuánto cuentas?')
  })

  it('cuenta el intento rechazado', async () => {
    h.generateReply.mockResolvedValue({
      text: 'algo',
      handoff: handoffRequest({ interes: null }),
    })

    await dispatchInboundToAiReply(ARGS)

    expect(h.state.updatePayload).toMatchObject({ ai_handoff_attempts: 1 })
  })

  // El caso raro: marcador pelado, sin texto que mandar. Se regenera en
  // vez de soltar una frase fija, que es lo que delata a un bot.
  it('regenera cuando el marcador viene sin texto', async () => {
    h.generateReply
      .mockResolvedValueOnce({ text: '', handoff: handoffRequest({ nombre: null }) })
      .mockResolvedValueOnce({ text: '¿Cómo te llamas?', handoff: null })

    await dispatchInboundToAiReply(ARGS)

    expect(h.generateReply).toHaveBeenCalledTimes(2)
    // La segunda llamada lleva la instrucción de no volver a transferir.
    expect(h.generateReply.mock.calls[1][0].systemPrompt).toContain(
      'did not go through',
    )
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.engineSendText.mock.calls[0][0].text).toBe('¿Cómo te llamas?')
  })

  it('transfiere con los cuatro datos y le pasa la ficha al asesor', async () => {
    h.generateReply.mockResolvedValue({
      text: 'Te paso con un asesor.',
      handoff: handoffRequest({ motivo: 'credito' }),
    })

    await dispatchInboundToAiReply(ARGS)

    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('Nombre: Carlos')
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('Motivo: credito')
  })

  it('transfiere un reclamo con solo el nombre', async () => {
    h.generateReply.mockResolvedValue({
      text: '',
      handoff: handoffRequest({
        motivo: 'reclamo',
        presupuesto: null,
        interes: null,
        credito: null,
      }),
    })

    await dispatchInboundToAiReply(ARGS)

    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('(urgente)')
  })

  it('retiene una urgencia sin nombre, y la suelta al segundo intento', async () => {
    h.generateReply.mockResolvedValue({
      text: 'Claro, ¿con quién tengo el gusto?',
      handoff: handoffRequest({ motivo: 'pide_humano', nombre: null }),
    })

    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({ ai_handoff_attempts: 1 })
    expect(h.state.updatePayload).not.toHaveProperty('ai_autoreply_disabled')

    // Segundo intento: el hilo ya trae un rechazo encima.
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 1,
      ai_handoff_attempts: 1,
    }
    h.state.updatePayload = null

    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
  })

  // Un sentinel desnudo (modelo que olvida el formato) no puede
  // transferir: es exactamente una petición sin datos.
  it('no transfiere con un marcador sin ningún campo', async () => {
    h.generateReply.mockResolvedValue({
      text: 'dime más',
      handoff: {
        nombre: null,
        presupuesto: null,
        interes: null,
        credito: null,
        motivo: 'otro' as const,
      },
    })

    await dispatchInboundToAiReply(ARGS)

    expect(h.state.updatePayload).not.toHaveProperty('ai_autoreply_disabled')
  })
})

// Antes de esto la transferencia iba siempre al único asesor configurado
// a mano: en producción, una sola admin con todas las conversaciones
// asignadas mientras los tres agentes estaban en cero.
describe('dispatchInboundToAiReply — a quién se asigna', () => {
  beforeEach(() => {
    h.generateReply.mockResolvedValue({ text: '', handoff: handoffRequest() })
  })

  it('reparte al asesor con menos conversaciones abiertas', async () => {
    h.state.openConversations = ['u-juan', 'u-juan', 'u-brayan']

    await dispatchInboundToAiReply(ARGS)

    expect(h.state.updatePayload).toMatchObject({ assigned_agent_id: 'u-brayan' })
  })

  it('le dice al cliente el primer nombre de quien lo va a atender', async () => {
    h.state.openConversations = ['u-brayan', 'u-brayan']

    await dispatchInboundToAiReply(ARGS)

    // Juan Marino Arias → "Juan": así se presenta un vendedor, no con el
    // nombre completo de registro civil.
    const aviso = h.engineSendText.mock.calls[0][0].text as string
    expect(aviso).toContain('Juan')
    expect(aviso).not.toContain('Marino')
  })

  // Configurar un asesor fijo es una decisión explícita del admin y el
  // reparto no la pisa.
  it('respeta el asesor configurado por encima del reparto', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'u-brayan' }))
    h.state.openConversations = ['u-brayan', 'u-brayan', 'u-brayan']

    await dispatchInboundToAiReply(ARGS)

    expect(h.state.updatePayload).toMatchObject({ assigned_agent_id: 'u-brayan' })
    expect(h.engineSendText.mock.calls[0][0].text).toContain('Brayan')
  })

  it('deja el hilo en la cola compartida cuando no hay asesores', async () => {
    h.state.profiles = []

    await dispatchInboundToAiReply(ARGS)

    expect(h.state.updatePayload).not.toHaveProperty('assigned_agent_id')
    // Y no se le promete al cliente un nombre que no existe.
    expect(h.engineSendText.mock.calls[0][0].text).not.toContain('Su nombre es')
  })
})

// El bot le dijo a un cliente que no había nada de 25 millones teniendo
// un Sandero de 22 disponible: veía 5 fichas de 123, elegidas por
// parecido de texto. Ahora recibe el catálogo entero.
describe('dispatchInboundToAiReply — inventario en el prompt', () => {
  it('le pasa al modelo el inventario disponible completo', async () => {
    await dispatchInboundToAiReply(ARGS)

    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('RENAULT SANDERO GT 2010')
    expect(systemPrompt).toContain('$22M')
    expect(systemPrompt).toContain('COMPLETE list')
  })

  // Leer el inventario es un extra: si falla, se responde como antes.
  it('responde igual cuando la cuenta no tiene inventario', async () => {
    h.state.inventory = []

    await dispatchInboundToAiReply(ARGS)

    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).not.toContain('Current inventory')
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
  })
})
