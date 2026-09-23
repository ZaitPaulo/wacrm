import { describe, expect, it } from 'vitest'

import {
  PUSH_BODY_MAX,
  PUSH_TTL_SECONDS,
  buildPushPayload,
  buildTestPushPayload,
  pushSendOptions,
  pushTopic,
} from './payload'

const CONV = '8f57b8e0-ec39-4471-9657-ca22fdf8fcab'

function notif(over: Partial<Parameters<typeof buildPushPayload>[0]> = {}) {
  return {
    id: 'n-1',
    type: 'new_message' as const,
    title: 'Mensaje de Juan',
    body: 'Hola, ¿sigue disponible?',
    conversation_id: CONV,
    ...over,
  }
}

describe('buildPushPayload', () => {
  it('usa un tag por conversación y pide volver a sonar', () => {
    const p = buildPushPayload(notif())
    expect(p.tag).toBe(`conversation-${CONV}`)
    expect(p.renotify).toBe(true)
    expect(p.url).toBe(`/inbox?c=${CONV}`)
    expect(p.title).toBe('Mensaje de Juan')
    expect(p.body).toBe('Hola, ¿sigue disponible?')
    expect(p.notificationId).toBe('n-1')
    expect(p.type).toBe('new_message')
    expect(p.test).toBe(false)
  })

  it('una asignación comparte el tag de su conversación', () => {
    const p = buildPushPayload(notif({ type: 'conversation_assigned' }))
    expect(p.tag).toBe(`conversation-${CONV}`)
  })

  it('sin conversación abre la página de notificaciones y usa el id como tag', () => {
    const p = buildPushPayload(notif({ conversation_id: null }))
    expect(p.url).toBe('/notifications')
    expect(p.tag).toBe('notification-n-1')
  })

  it('recorta cuerpos largos, como el resumen de un traspaso del bot', () => {
    const p = buildPushPayload(notif({ body: 'x'.repeat(500) }))
    expect(p.body.length).toBeLessThanOrEqual(PUSH_BODY_MAX + 1)
    expect(p.body.endsWith('…')).toBe(true)
  })

  it('tolera un cuerpo nulo', () => {
    expect(buildPushPayload(notif({ body: null })).body).toBe('')
  })

  it('no usa una conversación con formato raro para armar la URL', () => {
    const p = buildPushPayload(notif({ conversation_id: '../../x?y' }))
    expect(p.url).toBe('/notifications')
  })
})

describe('pushTopic', () => {
  it('es el id de la conversación sin guiones (32 caracteres válidos)', () => {
    const t = pushTopic(notif())
    expect(t).toBe(CONV.replace(/-/g, ''))
    expect(t).toMatch(/^[A-Za-z0-9_-]{1,32}$/)
  })

  it('sin conversación no hay topic', () => {
    expect(pushTopic(notif({ conversation_id: null }))).toBeUndefined()
  })
})

describe('pushSendOptions', () => {
  it('urgencia alta, TTL acotado y topic de la conversación', () => {
    expect(pushSendOptions(notif())).toEqual({
      TTL: PUSH_TTL_SECONDS,
      urgency: 'high',
      topic: CONV.replace(/-/g, ''),
    })
  })
})

describe('buildTestPushPayload', () => {
  it('se marca como prueba para que el service worker lo muestre siempre', () => {
    const p = buildTestPushPayload('Aviso de prueba', 'Así se verán')
    expect(p.test).toBe(true)
    expect(p.tag).toBe('push-test')
    expect(p.url).toBe('/notifications')
  })
})
