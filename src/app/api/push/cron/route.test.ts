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
  supabaseSubscriptionStore: () => ({}),
  webPushSender: () => ({}),
}))

import { GET } from './route'

const SECRET = 'secreto-cron'

function req(secret: string | null = SECRET) {
  return new Request('http://app:3000/api/push/cron', {
    headers: secret !== null ? { 'x-cron-secret': secret } : {},
  })
}

beforeEach(() => {
  vi.stubEnv('AUTOMATION_CRON_SECRET', SECRET)
  vi.stubEnv('VAPID_PUBLIC_KEY', 'pub')
  vi.stubEnv('VAPID_PRIVATE_KEY', 'priv')
  mocks.deliverNotification.mockResolvedValue({ sent: 1, removed: 0, failed: 0 })
})

afterEach(() => vi.unstubAllEnvs())

describe('GET /api/push/cron', () => {
  it('503 sin secreto de cron configurado', async () => {
    vi.stubEnv('AUTOMATION_CRON_SECRET', '')
    expect((await GET(req())).status).toBe(503)
  })

  it('401 con secreto incorrecto', async () => {
    expect((await GET(req('otro'))).status).toBe(401)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('sin VAPID no hace nada y lo dice', async () => {
    vi.stubEnv('VAPID_PUBLIC_KEY', '')
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ processed: 0, disabled: true })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('envía cada aviso pendiente reclamado', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        { id: 'a', user_id: 'u1', type: 'new_message', title: 't' },
        { id: 'b', user_id: 'u2', type: 'conversation_assigned', title: 't' },
      ],
      error: null,
    })
    const res = await GET(req())
    expect(mocks.rpc).toHaveBeenCalledWith('claim_pending_notification_pushes', { p_limit: 50 })
    expect(mocks.deliverNotification).toHaveBeenCalledTimes(2)
    expect(await res.json()).toEqual({ processed: 2, sent: 2, removed: 0, failed: 0 })
  })

  it('un fallo al enviar uno no corta los demás', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        { id: 'a', user_id: 'u1', type: 'new_message', title: 't' },
        { id: 'b', user_id: 'u2', type: 'new_message', title: 't' },
      ],
      error: null,
    })
    mocks.deliverNotification.mockRejectedValueOnce(new Error('db caída'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await GET(req())
    expect(await res.json()).toEqual({ processed: 2, sent: 1, removed: 0, failed: 1 })
    err.mockRestore()
  })
})
