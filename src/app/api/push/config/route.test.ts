import { afterEach, describe, expect, it, vi } from 'vitest'

import { GET } from './route'

afterEach(() => vi.unstubAllEnvs())

describe('GET /api/push/config', () => {
  it('devuelve la clave pública, nunca la privada', async () => {
    vi.stubEnv('VAPID_PUBLIC_KEY', 'BPubKey')
    vi.stubEnv('VAPID_PRIVATE_KEY', 'secreta')
    const res = await GET()
    const json = await res.json()
    expect(json).toEqual({ enabled: true, publicKey: 'BPubKey' })
    expect(JSON.stringify(json)).not.toContain('secreta')
  })

  it('sin VAPID dice que no está disponible', async () => {
    vi.stubEnv('VAPID_PUBLIC_KEY', '')
    vi.stubEnv('VAPID_PRIVATE_KEY', '')
    expect(await (await GET()).json()).toEqual({ enabled: false, publicKey: null })
  })
})
