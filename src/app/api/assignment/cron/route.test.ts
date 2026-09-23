import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}))

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ rpc: mocks.rpc }),
}))

import { GET } from './route'

function request(secret?: string) {
  return new Request('http://app:3000/api/assignment/cron', {
    headers: secret === undefined ? {} : { 'x-cron-secret': secret },
  })
}

beforeEach(() => {
  vi.stubEnv('AUTOMATION_CRON_SECRET', 'secreto-de-prueba')
  mocks.rpc.mockReset().mockResolvedValue({
    data: { skipped: false, assigned: 2, conversation_ids: ['c1', 'c2'] },
    error: null,
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GET /api/assignment/cron', () => {
  it('sin el secreto correcto responde 401 y no asigna nada', async () => {
    expect((await GET(request())).status).toBe(401)
    expect((await GET(request('otro'))).status).toBe(401)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('sin secreto configurado responde 503', async () => {
    vi.stubEnv('AUTOMATION_CRON_SECRET', '')
    expect((await GET(request('secreto-de-prueba'))).status).toBe(503)
  })

  it('corre el job en lotes acotados y devuelve cuántas asignó', async () => {
    const res = await GET(request('secreto-de-prueba'))

    expect(res.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('run_stale_assignment_job', { p_limit: 50 })
    expect(await res.json()).toEqual({ assigned: 2, skipped: false })
  })

  // Otra ejecución tenía el candado: no es un error.
  it('una corrida saltada por concurrencia responde 200', async () => {
    mocks.rpc.mockResolvedValue({
      data: { skipped: true, assigned: 0, conversation_ids: [] },
      error: null,
    })
    const res = await GET(request('secreto-de-prueba'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ assigned: 0, skipped: true })
  })

  // Un 500 hace que tick.sh lo registre como FALLO en el log del cron.
  it('un error de la base responde 500', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    expect((await GET(request('secreto-de-prueba'))).status).toBe(500)
    spy.mockRestore()
  })
})
