import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AiConfig } from '@/lib/ai/types'

const h = vi.hoisted(() => ({
  supabase: {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: { id: 'conv-1' }, error: null }),
      }
      return chain
    },
  },
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  generateReply: vi.fn(),
  loadNewCustomerPhotos: vi.fn(),
}))

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }),
  },
}))
vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({ supabase: h.supabase, accountId: 'acct-1', userId: 'user-1' }),
  toErrorResponse: (err: unknown) => {
    throw err
  },
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: vi.fn(),
  RATE_LIMITS: {},
}))
vi.mock('@/lib/ai/config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('@/lib/ai/context', () => ({ buildConversationContext: h.buildConversationContext }))
vi.mock('@/lib/ai/knowledge', () => ({ retrieveKnowledge: h.retrieveKnowledge }))
vi.mock('@/lib/ai/generate', () => ({ generateReply: h.generateReply }))
vi.mock('@/lib/ai/inventory-index', () => ({ buildInventoryIndex: async () => null }))
vi.mock('@/lib/ai/usage', () => ({ logAiUsage: async () => undefined }))
vi.mock('@/lib/ai/admin-client', () => ({ supabaseAdmin: () => ({}) }))
// Solo se mockea la carga (baja de Meta); el acople es el real.
vi.mock('@/lib/ai/photos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/photos')>()),
  loadNewCustomerPhotos: h.loadNewCustomerPhotos,
}))

import { POST } from './route'

const IMG = { mimeType: 'image/jpeg', base64: 'AAAA' }

function draftRequest(): Request {
  return { json: async () => ({ conversation_id: 'conv-1' }) } as unknown as Request
}

async function draft() {
  return (await POST(draftRequest())) as unknown as {
    body: { draft?: string; code?: string }
    status: number
  }
}

function aiConfig(): AiConfig {
  return {
    provider: 'gemini',
    model: 'gemini-test',
    apiKey: 'k',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    embeddingsProvider: 'gemini',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.loadAiConfig.mockResolvedValue(aiConfig())
  h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'Hola' }])
  h.retrieveKnowledge.mockResolvedValue([])
  h.generateReply.mockResolvedValue({ text: 'Claro, te cuento.', handoff: null, usage: null })
  h.loadNewCustomerPhotos.mockResolvedValue({ count: 0, images: [] })
})

describe('POST /api/ai/draft — fotos del cliente', () => {
  it('el borrador ve las fotos nuevas del cliente', async () => {
    h.buildConversationContext.mockResolvedValue([
      { role: 'assistant', content: 'Cuéntame, ¿en qué te puedo ayudar?' },
      { role: 'user', content: '[Foto] ¿y este?' },
    ])
    h.loadNewCustomerPhotos.mockResolvedValue({ count: 1, images: [IMG] })

    const res = await draft()

    expect(res.status).toBe(200)
    const call = h.generateReply.mock.calls[0][0]
    expect(call.messages.at(-1)).toEqual({ role: 'user', content: '[Foto] ¿y este?', images: [IMG] })
    expect(call.systemPrompt).toContain('includes photos you can see')
    expect(h.loadNewCustomerPhotos).toHaveBeenCalledWith(h.supabase, {
      accountId: 'acct-1',
      conversationId: 'conv-1',
    })
  })

  it('redacta para una foto sola aunque no haya texto en la conversación', async () => {
    h.buildConversationContext.mockResolvedValue([])
    h.loadNewCustomerPhotos.mockResolvedValue({ count: 1, images: [IMG] })

    const res = await draft()

    expect(res.status).toBe(200)
    expect(res.body.draft).toBe('Claro, te cuento.')
  })

  it('sin texto ni fotos sigue respondiendo no_messages', async () => {
    h.buildConversationContext.mockResolvedValue([])

    const res = await draft()

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('no_messages')
    expect(h.generateReply).not.toHaveBeenCalled()
  })

  it('un fallo al cargar las fotos no tumba el borrador', async () => {
    h.loadNewCustomerPhotos.mockRejectedValue(new Error('Meta caída'))

    const res = await draft()

    expect(res.status).toBe(200)
    expect(h.generateReply.mock.calls[0][0].systemPrompt).not.toContain(
      'includes photos you can see',
    )
  })
})
