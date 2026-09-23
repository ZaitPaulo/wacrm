import { describe, expect, it, vi } from 'vitest'

import { deliverNotification, deliverToSubscriptions, type PushSender, type SubscriptionStore } from './send'
import { buildTestPushPayload } from './payload'

const CONV = '8f57b8e0-ec39-4471-9657-ca22fdf8fcab'

function store(subs: { id: string; endpoint: string }[]): SubscriptionStore & {
  removed: string[]
  succeeded: string[]
} {
  const removed: string[] = []
  const succeeded: string[] = []
  return {
    removed,
    succeeded,
    listForUser: vi.fn(async () =>
      subs.map((s) => ({ ...s, p256dh: 'k', auth: 'a' })),
    ),
    remove: vi.fn(async (id: string) => {
      removed.push(id)
    }),
    markSuccess: vi.fn(async (ids: string[]) => {
      succeeded.push(...ids)
    }),
  }
}

function pushError(statusCode: number) {
  return Object.assign(new Error(`push ${statusCode}`), { statusCode })
}

const notification = {
  id: 'n-1',
  user_id: 'u-juan',
  type: 'new_message' as const,
  title: 'Mensaje de Juan',
  body: 'Hola',
  conversation_id: CONV,
}

describe('deliverNotification', () => {
  it('envía a cada dispositivo del destinatario, y solo a él', async () => {
    const s = store([
      { id: 's1', endpoint: 'https://fcm.googleapis.com/1' },
      { id: 's2', endpoint: 'https://web.push.apple.com/2' },
    ])
    const sender: PushSender = { send: vi.fn(async () => {}) }

    const r = await deliverNotification(s, sender, notification)

    expect(s.listForUser).toHaveBeenCalledWith('u-juan')
    expect(sender.send).toHaveBeenCalledTimes(2)
    const [sub, payload, options] = (sender.send as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(sub).toEqual({ endpoint: 'https://fcm.googleapis.com/1', keys: { p256dh: 'k', auth: 'a' } })
    expect(JSON.parse(payload)).toMatchObject({ tag: `conversation-${CONV}`, renotify: true })
    expect(options).toMatchObject({ urgency: 'high', topic: CONV.replace(/-/g, '') })
    expect(r).toEqual({ sent: 2, removed: 0, failed: 0 })
    expect(s.succeeded).toEqual(['s1', 's2'])
  })

  it('borra la suscripción cuando el servicio responde 410 o 404', async () => {
    const s = store([
      { id: 's1', endpoint: 'https://fcm.googleapis.com/1' },
      { id: 's2', endpoint: 'https://fcm.googleapis.com/2' },
      { id: 's3', endpoint: 'https://fcm.googleapis.com/3' },
    ])
    const sender: PushSender = {
      send: vi.fn(async (sub) => {
        if (sub.endpoint.endsWith('/1')) throw pushError(410)
        if (sub.endpoint.endsWith('/2')) throw pushError(404)
      }),
    }

    const r = await deliverNotification(s, sender, notification)

    expect(s.removed.sort()).toEqual(['s1', 's2'])
    expect(r).toEqual({ sent: 1, removed: 2, failed: 0 })
  })

  it('otros errores se cuentan pero no borran la suscripción', async () => {
    const s = store([{ id: 's1', endpoint: 'https://fcm.googleapis.com/1' }])
    const sender: PushSender = {
      send: vi.fn(async () => {
        throw pushError(500)
      }),
    }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})

    const r = await deliverNotification(s, sender, notification)

    expect(s.removed).toEqual([])
    expect(r).toEqual({ sent: 0, removed: 0, failed: 1 })
    err.mockRestore()
  })

  it('sin dispositivos no envía nada', async () => {
    const s = store([])
    const sender: PushSender = { send: vi.fn() }
    expect(await deliverNotification(s, sender, notification)).toEqual({
      sent: 0,
      removed: 0,
      failed: 0,
    })
    expect(sender.send).not.toHaveBeenCalled()
  })
})

describe('deliverToSubscriptions', () => {
  it('manda el payload de prueba tal cual', async () => {
    const s = store([])
    const sender: PushSender = { send: vi.fn(async () => {}) }
    await deliverToSubscriptions(
      s,
      sender,
      [{ id: 's1', endpoint: 'https://fcm.googleapis.com/1', p256dh: 'k', auth: 'a' }],
      buildTestPushPayload('Prueba', 'Cuerpo'),
      { TTL: 60, urgency: 'high' },
    )
    const payload = JSON.parse((sender.send as ReturnType<typeof vi.fn>).mock.calls[0][1])
    expect(payload.test).toBe(true)
    expect(payload.title).toBe('Prueba')
  })
})
