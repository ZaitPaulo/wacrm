import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  upsert: vi.fn(),
  sessionDelete: vi.fn(),
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
  supabaseAdmin: () => ({
    from: (table: string) => {
      expect(table).toBe('push_subscriptions')
      return {
        upsert: (row: unknown, opts: unknown) => {
          mocks.upsert(row, opts)
          return Promise.resolve({ error: null })
        },
      }
    },
  }),
}))

import { DELETE, POST } from './route'

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc:def'

function sessionClient() {
  return {
    from: (table: string) => {
      expect(table).toBe('push_subscriptions')
      return {
        delete: () => ({
          eq: (col: string, val: string) => {
            mocks.sessionDelete(col, val)
            return Promise.resolve({ error: null })
          },
        }),
      }
    },
  }
}

function req(method: string, body: unknown) {
  return new Request('http://localhost/api/push/subscriptions', {
    method,
    headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (Linux; Android 14)' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mocks.getCurrentAccount.mockResolvedValue({
    supabase: sessionClient(),
    userId: 'u-juan',
    accountId: 'acc-1',
    role: 'agent',
  })
})

describe('POST /api/push/subscriptions', () => {
  it('guarda el dispositivo a nombre de quien llama, reasignando el endpoint si ya existía', async () => {
    const res = await POST(
      req('POST', { endpoint: ENDPOINT, keys: { p256dh: 'BPk', auth: 'aa' } }),
    )
    expect(res.status).toBe(200)
    const [row, opts] = mocks.upsert.mock.calls[0]
    expect(row).toMatchObject({
      user_id: 'u-juan',
      account_id: 'acc-1',
      endpoint: ENDPOINT,
      p256dh: 'BPk',
      auth: 'aa',
      user_agent: 'Mozilla/5.0 (Linux; Android 14)',
    })
    expect(opts).toEqual({ onConflict: 'endpoint' })
  })

  it('401 sin sesión', async () => {
    mocks.getCurrentAccount.mockRejectedValue(new Error('no session'))
    const res = await POST(req('POST', { endpoint: ENDPOINT, keys: { p256dh: 'a', auth: 'b' } }))
    expect(res.status).toBe(401)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it.each([
    [{}],
    [{ endpoint: ENDPOINT }],
    [{ endpoint: ENDPOINT, keys: { p256dh: 'a' } }],
    [{ endpoint: 'http://app:3000/api/push/dispatch', keys: { p256dh: 'a', auth: 'b' } }],
    [{ endpoint: ENDPOINT, keys: { p256dh: 'a'.repeat(300), auth: 'b' } }],
  ])('400 con un cuerpo inválido o un endpoint que no es de un servicio de push: %j', async (body) => {
    const res = await POST(req('POST', body))
    expect(res.status).toBe(400)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/push/subscriptions', () => {
  it('borra con el cliente de sesión (la RLS limita a las propias)', async () => {
    const res = await DELETE(req('DELETE', { endpoint: ENDPOINT }))
    expect(res.status).toBe(200)
    expect(mocks.sessionDelete).toHaveBeenCalledWith('endpoint', ENDPOINT)
  })

  it('400 sin endpoint', async () => {
    expect((await DELETE(req('DELETE', {}))).status).toBe(400)
  })
})
