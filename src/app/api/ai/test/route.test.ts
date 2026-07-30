import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  validateAiCredentials: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() =>
    Response.json({ error: 'auth failed' }, { status: 403 }),
  ),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ success: true })),
  rateLimitResponse: vi.fn(() =>
    Response.json({ error: 'rate limited' }, { status: 429 }),
  ),
  RATE_LIMITS: { adminAction: { limit: 10, windowMs: 60_000 } },
}))

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: vi.fn((v: string) => v) }))

vi.mock('@/lib/ai/validate', () => ({
  validateAiCredentials: mocks.validateAiCredentials,
}))

import { POST } from './route'
import { AI_PROVIDERS } from '@/lib/ai/types'

const context = {
  supabase: { name: 'scoped-client' },
  accountId: 'account-1',
  userId: 'user-1',
  role: 'admin',
  account: { id: 'account-1', name: 'Acme' },
}

function request(body: unknown) {
  return new Request('http://localhost/api/ai/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mocks.requireRole.mockReset()
  mocks.validateAiCredentials.mockReset()
  mocks.requireRole.mockResolvedValue(context)
  mocks.validateAiCredentials.mockResolvedValue(undefined)
})

describe('POST /api/ai/test', () => {
  // Regression: this route validated the provider against its own
  // hardcoded ('openai' | 'anthropic') pair, so the "Test key" button
  // rejected OpenRouter and Gemini long after the rest of the stack
  // supported them. Every provider in AI_PROVIDERS must get through.
  it.each(AI_PROVIDERS)('accepts %s and validates the credentials', async (provider) => {
    const res = await POST(
      request({ provider, model: 'some-model', api_key: 'k-123' }),
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
    expect(mocks.validateAiCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ provider, model: 'some-model', apiKey: 'k-123' }),
    )
  })

  it('rejects a provider with no adapter', async () => {
    const res = await POST(
      request({ provider: 'mistral', model: 'm', api_key: 'k' }),
    )

    expect(res.status).toBe(400)
    // The message enumerates the supported set rather than a stale pair.
    await expect(res.json()).resolves.toEqual({
      error: `provider must be one of: ${AI_PROVIDERS.join(', ')}`,
    })
    expect(mocks.validateAiCredentials).not.toHaveBeenCalled()
  })

  it('requires a model', async () => {
    const res = await POST(request({ provider: 'gemini', api_key: 'k' }))
    expect(res.status).toBe(400)
    expect(mocks.validateAiCredentials).not.toHaveBeenCalled()
  })
})
