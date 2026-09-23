import { describe, expect, it } from 'vitest'

import {
  detectPushSupport,
  isApplePushUserAgent,
  pushCardState,
  sameApplicationServerKey,
  shouldAlertInApp,
  unblockHelpKey,
  urlBase64ToUint8Array,
  viewedConversationId,
} from './client'

const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; SM-A146M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36'
const CHROME_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1'
const SAFARI_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
const FIREFOX =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0'

const FULL = { hasServiceWorker: true, hasPushManager: true, hasNotification: true }

describe('detectPushSupport', () => {
  it('Chrome de Android: compatible sin instalar nada', () => {
    expect(detectPushSupport({ ...FULL, userAgent: CHROME_ANDROID, standalone: false, maxTouchPoints: 5 })).toBe('supported')
  })

  it('iPhone en Safari sin agregar a inicio: hay que instalarlo', () => {
    expect(
      detectPushSupport({
        hasServiceWorker: true,
        hasPushManager: false,
        hasNotification: false,
        userAgent: IPHONE_SAFARI,
        standalone: false,
        maxTouchPoints: 5,
      }),
    ).toBe('ios-install-required')
  })

  it('iPhone en Chrome (también WebKit): hay que instalarlo desde Safari', () => {
    expect(
      detectPushSupport({ ...FULL, hasPushManager: false, userAgent: IPHONE_CHROME, standalone: false, maxTouchPoints: 5 }),
    ).toBe('ios-install-required')
  })

  it('iPad que se presenta como Mac (pantalla táctil) cuenta como iOS', () => {
    expect(
      detectPushSupport({ ...FULL, hasPushManager: false, userAgent: SAFARI_MAC, standalone: false, maxTouchPoints: 5 }),
    ).toBe('ios-install-required')
  })

  it('iPhone instalado en inicio con iOS 16.4+: compatible', () => {
    expect(detectPushSupport({ ...FULL, userAgent: IPHONE_SAFARI, standalone: true, maxTouchPoints: 5 })).toBe('supported')
  })

  it('iPhone instalado pero con iOS viejo (sin PushManager): no compatible', () => {
    expect(
      detectPushSupport({ ...FULL, hasPushManager: false, userAgent: IPHONE_SAFARI, standalone: true, maxTouchPoints: 5 }),
    ).toBe('ios-too-old')
  })

  it('navegador sin service worker: no compatible', () => {
    expect(
      detectPushSupport({ ...FULL, hasServiceWorker: false, userAgent: CHROME_DESKTOP, standalone: false, maxTouchPoints: 0 }),
    ).toBe('unsupported')
  })
})

describe('isApplePushUserAgent', () => {
  it.each([
    [IPHONE_SAFARI, true],
    [IPHONE_CHROME, true],
    [SAFARI_MAC, true],
    [CHROME_ANDROID, false],
    [CHROME_DESKTOP, false],
    [FIREFOX, false],
  ])('%s → %s', (ua, expected) => {
    expect(isApplePushUserAgent(ua)).toBe(expected)
  })
})

describe('pushCardState', () => {
  const base = { support: 'supported' as const, serverEnabled: true, permission: 'default' as const, subscribed: false }
  it('orden de prioridad de los estados', () => {
    expect(pushCardState({ ...base, support: 'unsupported' })).toBe('unsupported')
    expect(pushCardState({ ...base, support: 'ios-install-required' })).toBe('ios-install')
    expect(pushCardState({ ...base, support: 'ios-too-old' })).toBe('ios-too-old')
    expect(pushCardState({ ...base, serverEnabled: false })).toBe('server-disabled')
    expect(pushCardState({ ...base, permission: 'denied' })).toBe('blocked')
    expect(pushCardState({ ...base, permission: 'granted', subscribed: true })).toBe('enabled')
    expect(pushCardState({ ...base, permission: 'granted', subscribed: false })).toBe('disabled')
    expect(pushCardState(base)).toBe('disabled')
  })
})

describe('unblockHelpKey', () => {
  it.each([
    [CHROME_ANDROID, 'chromeAndroid'],
    [CHROME_DESKTOP, 'chromeDesktop'],
    [FIREFOX, 'firefox'],
    [SAFARI_MAC, 'safari'],
    [IPHONE_SAFARI, 'ios'],
  ])('%s → %s', (ua, key) => {
    expect(unblockHelpKey(ua)).toBe(key)
  })
})

describe('urlBase64ToUint8Array / sameApplicationServerKey', () => {
  it('decodifica base64url sin relleno', () => {
    expect(Array.from(urlBase64ToUint8Array('AQID_-8'))).toEqual([1, 2, 3, 255, 239])
  })

  it('compara la clave con la de la suscripción existente', () => {
    const key = urlBase64ToUint8Array('AQID')
    expect(sameApplicationServerKey(key.buffer as ArrayBuffer, 'AQID')).toBe(true)
    expect(sameApplicationServerKey(key.buffer as ArrayBuffer, 'AQIE')).toBe(false)
    expect(sameApplicationServerKey(null, 'AQID')).toBe(false)
  })
})

describe('viewedConversationId', () => {
  it('solo en la bandeja y con ?c=', () => {
    expect(viewedConversationId('/inbox', '?c=abc')).toBe('abc')
    expect(viewedConversationId('/inbox', '')).toBeNull()
    expect(viewedConversationId('/notifications', '?c=abc')).toBeNull()
  })
})

describe('shouldAlertInApp', () => {
  const NOW = Date.parse('2026-09-23T15:00:00Z')
  const row = {
    id: 'n1',
    type: 'new_message' as const,
    conversation_id: 'conv-b',
    read_at: null,
    created_at: '2026-09-23T14:59:58Z',
  }
  const base = {
    eventType: 'INSERT' as const,
    row,
    oldCreatedAt: undefined,
    visible: true,
    viewingConversationId: 'conv-a',
    suppressForSystemAlert: false,
    now: NOW,
  }

  it('avisa por un aviso nuevo de otra conversación con la pestaña visible', () => {
    expect(shouldAlertInApp(base)).toBe('alert')
  })

  it('avisa cuando un new_message se refresca (otro mensaje)', () => {
    expect(
      shouldAlertInApp({ ...base, eventType: 'UPDATE', oldCreatedAt: '2026-09-23T14:59:00Z' }),
    ).toBe('alert')
  })

  it('no avisa por un UPDATE que no movió created_at (p. ej. marcar leído)', () => {
    expect(
      shouldAlertInApp({ ...base, eventType: 'UPDATE', oldCreatedAt: row.created_at }),
    ).toBe('ignore')
  })

  it('no avisa por un aviso ya leído', () => {
    expect(shouldAlertInApp({ ...base, row: { ...row, read_at: '2026-09-23T15:00:00Z' } })).toBe('ignore')
  })

  it('si ya está mirando esa conversación lo marca leído en vez de avisar', () => {
    expect(shouldAlertInApp({ ...base, viewingConversationId: 'conv-b' })).toBe('mark-read')
  })

  it('mirando la conversación pero con la pestaña oculta no marca nada', () => {
    expect(shouldAlertInApp({ ...base, viewingConversationId: 'conv-b', visible: false })).toBe('ignore')
  })

  it('con la pestaña oculta no avisa (lo hace el sistema operativo)', () => {
    expect(shouldAlertInApp({ ...base, visible: false })).toBe('ignore')
  })

  it('en Safari/iOS con avisos activados en este dispositivo no duplica', () => {
    expect(shouldAlertInApp({ ...base, suppressForSystemAlert: true })).toBe('ignore')
  })

  it('ignora eventos viejos (reconexión de Realtime)', () => {
    expect(shouldAlertInApp({ ...base, row: { ...row, created_at: '2026-09-23T14:50:00Z' } })).toBe('ignore')
  })

  it('una asignación de la conversación que ya está mirando no suena (y no se toca)', () => {
    expect(
      shouldAlertInApp({
        ...base,
        viewingConversationId: 'conv-b',
        row: { ...row, type: 'conversation_assigned' },
      }),
    ).toBe('ignore')
  })
})
