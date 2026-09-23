import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  deliverNotification: vi.fn(),
}))

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ rpc: mocks.rpc }),
}))

vi.mock('@/lib/push/send', () => ({
  deliverNotification: mocks.deliverNotification,
  supabaseSubscriptionStore: () => ({ tag: 'store' }),
  webPushSender: () => ({ tag: 'sender' }),
}))

import { POST } from './route'

const ID = '0b7c6a52-2f5e-4d59-9a44-6c9b0e0e8d11'
const SECRET = 'secreto-de-despacho-0123456789'

function req(body: unknown, secret: string | null = SECRET) {
  return new Request('http://app:3000/api/push/dispatch', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secret !== null ? { 'x-push-secret': secret } : {}),
    },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.stubEnv('PUSH_DISPATCH_SECRET', SECRET)
  vi.stubEnv('VAPID_PUBLIC_KEY', 'pub')
  vi.stubEnv('VAPID_PRIVATE_KEY', 'priv')
  mocks.deliverNotification.mockResolvedValue({ sent: 1, removed: 0, failed: 0 })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/push/dispatch', () => {
  it('503 si el secreto de despacho no está configurado', async () => {
    vi.stubEnv('PUSH_DISPATCH_SECRET', '')
    const res = await POST(req({ notification_id: ID }))
    expect(res.status).toBe(503)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('401 con un secreto incorrecto o ausente', async () => {
    expect((await POST(req({ notification_id: ID }, 'otro'))).status).toBe(401)
    expect((await POST(req({ notification_id: ID }, null))).status).toBe(401)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('400 si el id no es un UUID', async () => {
    const res = await POST(req({ notification_id: 'x; drop table' }))
    expect(res.status).toBe(400)
  })

  it('503 sin VAPID, sin reclamar (el barrido lo enviará cuando se configure)', async () => {
    vi.stubEnv('VAPID_PRIVATE_KEY', '')
    const res = await POST(req({ notification_id: ID }))
    expect(res.status).toBe(503)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('reclama la versión y envía al destinatario', async () => {
    const notification = {
      id: ID,
      user_id: 'u-juan',
      type: 'new_message',
      title: 'Mensaje de Juan',
      body: 'Hola',
      conversation_id: null,
    }
    mocks.rpc.mockResolvedValue({ data: [notification], error: null })

    const res = await POST(req({ notification_id: ID }))

    expect(mocks.rpc).toHaveBeenCalledWith('claim_notification_push', {
      p_notification_id: ID,
    })
    expect(mocks.deliverNotification).toHaveBeenCalledWith(
      { tag: 'store' },
      { tag: 'sender' },
      notification,
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sent: 1, removed: 0, failed: 0 })
  })

  it('un despacho repetido no vuelve a enviar', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    const res = await POST(req({ notification_id: ID }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: true })
    expect(mocks.deliverNotification).not.toHaveBeenCalled()
  })

  it('500 si el reclamo falla', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(req({ notification_id: ID }))
    expect(res.status).toBe(500)
    err.mockRestore()
  })
})
