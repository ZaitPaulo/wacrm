import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  found: null as null | { id: string; endpoint: string; p256dh: string; auth: string },
  filters: [] as [string, string][],
  deliverToSubscriptions: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: mocks.getCurrentAccount,
  toErrorResponse: vi.fn(() => Response.json({ error: 'auth' }, { status: 401 })),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ success: true })),
  rateLimitResponse: vi.fn(() => Response.json({ error: 'rl' }, { status: 429 })),
  RATE_LIMITS: { send: { limit: 60, windowMs: 60_000 } },
}))

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => {
    const chain = {
      select: () => chain,
      eq: (col: string, val: string) => {
        mocks.filters.push([col, val])
        return chain
      },
      maybeSingle: () => Promise.resolve({ data: mocks.found, error: null }),
    }
    return { from: () => chain }
  },
}))

vi.mock('@/lib/push/send', () => ({
  deliverToSubscriptions: mocks.deliverToSubscriptions,
  supabaseSubscriptionStore: () => ({}),
  webPushSender: () => ({}),
}))

import { POST } from './route'

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc'

function req(body: Record<string, unknown>) {
  if (!('title' in body) && 'endpoint' in body) body = { title: 'T', body: 'B', ...body }
  return new Request('http://localhost/api/push/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mocks.filters = []
  mocks.found = { id: 's1', endpoint: ENDPOINT, p256dh: 'k', auth: 'a' }
  mocks.getCurrentAccount.mockResolvedValue({ userId: 'u-juan', accountId: 'acc-1' })
  mocks.deliverToSubscriptions.mockResolvedValue({ sent: 1, removed: 0, failed: 0 })
  vi.stubEnv('VAPID_PUBLIC_KEY', 'pub')
  vi.stubEnv('VAPID_PRIVATE_KEY', 'priv')
})

afterEach(() => vi.unstubAllEnvs())

describe('POST /api/push/test', () => {
  it('envía la prueba solo al endpoint de este dispositivo y del usuario', async () => {
    const res = await POST(
      req({ endpoint: ENDPOINT, title: 'Aviso de prueba', body: 'Así te llegarán' }),
    )
    expect(res.status).toBe(200)
    expect(mocks.filters).toEqual([
      ['endpoint', ENDPOINT],
      ['user_id', 'u-juan'],
    ])
    const [, , subs, payload] = mocks.deliverToSubscriptions.mock.calls[0]
    expect(subs).toEqual([mocks.found])
    expect(payload.test).toBe(true)
    expect(payload.title).toBe('Aviso de prueba')
    expect(payload.body).toBe('Así te llegarán')
  })

  it('400 con textos ausentes o demasiado largos', async () => {
    expect((await POST(req({ endpoint: ENDPOINT, title: 'x'.repeat(200), body: 'b' }))).status).toBe(400)
    expect((await POST(req({ title: 't', body: 'b' }))).status).toBe(400)
  })

  it('404 si el endpoint no es del usuario', async () => {
    mocks.found = null
    const res = await POST(req({ endpoint: ENDPOINT }))
    expect(res.status).toBe(404)
    expect(mocks.deliverToSubscriptions).not.toHaveBeenCalled()
  })

  it('410 si el servicio de push dice que la suscripción ya no existe', async () => {
    mocks.deliverToSubscriptions.mockResolvedValue({ sent: 0, removed: 1, failed: 0 })
    expect((await POST(req({ endpoint: ENDPOINT }))).status).toBe(410)
  })

  it('502 si el servicio de push falla', async () => {
    mocks.deliverToSubscriptions.mockResolvedValue({ sent: 0, removed: 0, failed: 1 })
    expect((await POST(req({ endpoint: ENDPOINT }))).status).toBe(502)
  })

  it('503 sin VAPID', async () => {
    vi.stubEnv('VAPID_PRIVATE_KEY', '')
    expect((await POST(req({ endpoint: ENDPOINT }))).status).toBe(503)
  })
})
