import { describe, expect, it } from 'vitest'

import { getVapidConfig, isAllowedPushEndpoint, secretMatches } from './config'

describe('getVapidConfig', () => {
  it('lee las tres variables', () => {
    expect(
      getVapidConfig({
        VAPID_PUBLIC_KEY: ' pub ',
        VAPID_PRIVATE_KEY: 'priv',
        VAPID_SUBJECT: 'mailto:ventas@loramotors.co',
      }),
    ).toEqual({
      publicKey: 'pub',
      privateKey: 'priv',
      subject: 'mailto:ventas@loramotors.co',
    })
  })

  it('sin clave privada no hay configuración', () => {
    expect(getVapidConfig({ VAPID_PUBLIC_KEY: 'pub' })).toBeNull()
  })

  it('sin clave pública no hay configuración', () => {
    expect(getVapidConfig({ VAPID_PRIVATE_KEY: 'priv' })).toBeNull()
  })

  it('el subject por defecto es un mailto genérico válido', () => {
    const c = getVapidConfig({ VAPID_PUBLIC_KEY: 'a', VAPID_PRIVATE_KEY: 'b' })
    expect(c?.subject.startsWith('mailto:')).toBe(true)
  })
})

describe('secretMatches', () => {
  it('acepta el secreto exacto', () => {
    expect(secretMatches('abc123', 'abc123')).toBe(true)
  })
  it('rechaza uno distinto, uno vacío o sin configurar', () => {
    expect(secretMatches('abc124', 'abc123')).toBe(false)
    expect(secretMatches('', 'abc123')).toBe(false)
    expect(secretMatches(null, 'abc123')).toBe(false)
    expect(secretMatches('abc', undefined)).toBe(false)
    expect(secretMatches('', '')).toBe(false)
  })
  it('rechaza longitudes distintas sin lanzar', () => {
    expect(secretMatches('abc', 'abc123')).toBe(false)
  })
})

describe('isAllowedPushEndpoint', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc:def',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAA',
    'https://web.push.apple.com/QGuQyavXutnMH',
    'https://wns2-by3p.notify.windows.com/w/?token=BQYAAA',
    'https://android.googleapis.com/gcm/send/abc',
  ])('acepta el servicio de push %s', (url) => {
    expect(isAllowedPushEndpoint(url)).toBe(true)
  })

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://api-gw:8000/rest/v1/profiles',
    'http://app:3000/api/push/dispatch',
    'https://evil.example/fcm.googleapis.com',
    'https://fcm.googleapis.com.evil.example/x',
    'https://127.0.0.1/x',
    'no es una url',
  ])('rechaza %s (evita que el servidor haga POST a donde diga el cliente)', (url) => {
    expect(isAllowedPushEndpoint(url)).toBe(false)
  })
})
