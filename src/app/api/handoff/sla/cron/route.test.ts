import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: () => ({}) }))
vi.mock('@/lib/handoff/sla-job', () => ({ runHandoffSlaJob: mocks.run }))

import { GET } from './route'

function request(secret?: string) {
  return new Request('http://app:3000/api/handoff/sla/cron', {
    headers: secret === undefined ? {} : { 'x-cron-secret': secret },
  })
}

beforeEach(() => {
  vi.stubEnv('AUTOMATION_CRON_SECRET', 'secreto-de-prueba')
  mocks.run.mockReset().mockResolvedValue({ checked: 3, reminded: 1, escalated: 0 })
})

afterEach(() => vi.unstubAllEnvs())

describe('GET /api/handoff/sla/cron', () => {
  it('sin el secreto correcto responde 401 y no corre el job', async () => {
    expect((await GET(request())).status).toBe(401)
    expect((await GET(request('otro'))).status).toBe(401)
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('sin secreto configurado responde 503', async () => {
    vi.stubEnv('AUTOMATION_CRON_SECRET', '')
    expect((await GET(request('secreto-de-prueba'))).status).toBe(503)
  })

  it('corre el job y devuelve lo que hizo', async () => {
    const res = await GET(request('secreto-de-prueba'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ checked: 3, reminded: 1, escalated: 0 })
  })

  it('un fallo del job responde 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.run.mockRejectedValue(new Error('db down'))
    expect((await GET(request('secreto-de-prueba'))).status).toBe(500)
  })
})
