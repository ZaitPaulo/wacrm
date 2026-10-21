import { beforeEach, describe, expect, it, vi } from 'vitest'

// reducir-consumo-gemini: el presupuesto de respuestas en horario laboral
// se guarda solo si viene, y un N fuera de 1–20 se rechaza.

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  updates: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  getCurrentAccount: vi.fn(),
  toErrorResponse: vi.fn(() => Response.json({ error: 'forbidden' }, { status: 403 })),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ success: true })),
  rateLimitResponse: vi.fn(() => Response.json({ error: 'rate limited' }, { status: 429 })),
  RATE_LIMITS: { adminAction: { limit: 10, windowMs: 60_000 } },
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn((v: string) => v),
  encrypt: vi.fn((v: string) => `enc:${v}`),
}))
vi.mock('@/lib/ai/validate', () => ({ validateAiCredentials: vi.fn() }))
vi.mock('@/lib/ai/embeddings', () => ({ embedTexts: vi.fn() }))

import { POST } from './route'

/** `ai_configs` ya existe con la misma clave, proveedor y modelo: el
 *  guardado no valida contra el proveedor y va directo al UPDATE. */
const supabase = {
  from: () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({
        data: { id: 'cfg-1', provider: 'gemini', model: 'gemini-x', api_key: 'k' },
        error: null,
      }),
      update: (patch: Record<string, unknown>) => {
        mocks.updates.push(patch)
        return { eq: async () => ({ error: null }) }
      },
    }
    return chain
  },
}

function request(body: Record<string, unknown>) {
  return new Request('http://localhost/api/ai/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'gemini', model: 'gemini-x', ...body }),
  })
}

beforeEach(() => {
  mocks.updates.length = 0
  mocks.requireRole.mockReset()
  mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'u-1' })
})

describe('POST /api/ai/config — presupuesto en horario', () => {
  it('guarda el interruptor y N', async () => {
    const res = await POST(
      request({ business_hours_reply_budget_enabled: true, business_hours_reply_budget: 3 }),
    )
    expect(res.status).toBe(200)
    expect(mocks.updates[0]).toMatchObject({
      business_hours_reply_budget_enabled: true,
      business_hours_reply_budget: 3,
    })
  })

  it.each([0, 21, 2.5, 'tres'])('rechaza N = %s', async (n) => {
    const res = await POST(request({ business_hours_reply_budget: n }))
    expect(res.status).toBe(400)
    expect(mocks.updates).toHaveLength(0)
  })

  it('sin los campos, no los toca', async () => {
    await POST(request({}))
    expect(mocks.updates[0]).not.toHaveProperty('business_hours_reply_budget_enabled')
    expect(mocks.updates[0]).not.toHaveProperty('business_hours_reply_budget')
  })

  it('exige rol admin', async () => {
    mocks.requireRole.mockRejectedValue(new Error('forbidden'))
    const res = await POST(request({ business_hours_reply_budget: 3 }))
    expect(res.status).toBe(403)
    expect(mocks.requireRole).toHaveBeenCalledWith('admin')
  })
})
