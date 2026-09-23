import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  settings: null as Record<string, unknown> | null,
  weights: [] as { user_id: string; percent: number }[],
  profiles: [] as { user_id: string; full_name: string; account_role: string }[],
  upserts: [] as Record<string, unknown>[],
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
  rpcError: null as { code?: string; message: string } | null,
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: 'forbidden' }, { status: 403 })),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ success: true })),
  rateLimitResponse: vi.fn(() => Response.json({ error: 'rate limited' }, { status: 429 })),
  RATE_LIMITS: { adminAction: { limit: 10, windowMs: 60_000 } },
}))

/** Cliente de sesión falso: responde a las tres tablas y a la RPC. */
function cliente() {
  return {
    from(table: string) {
      const filtros: Record<string, unknown> = {}
      const datos = () => {
        if (table === 'assignment_weights') return mocks.weights
        if (table === 'profiles') {
          return mocks.profiles.filter(
            (p) => !filtros.account_role || p.account_role === filtros.account_role,
          )
        }
        return []
      }
      const chain = {
        select: () => chain,
        eq: (col: string, v: unknown) => {
          filtros[col] = v
          return chain
        },
        order: () => chain,
        maybeSingle: () => Promise.resolve({ data: mocks.settings, error: null }),
        upsert: (row: Record<string, unknown>) => {
          mocks.upserts.push(row)
          return Promise.resolve({ error: null })
        },
        then: (resolve: (v: unknown) => unknown) => resolve({ data: datos(), error: null }),
      }
      return chain
    },
    rpc(fn: string, args: Record<string, unknown>) {
      mocks.rpcCalls.push({ fn, args })
      return Promise.resolve({ data: null, error: mocks.rpcError })
    },
  }
}

import { GET, PUT } from './route'

function put(body: unknown) {
  return PUT(
    new Request('http://localhost/api/assignment/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

beforeEach(() => {
  mocks.settings = null
  mocks.weights = []
  mocks.profiles = [
    { user_id: 'u-ange', full_name: 'Angélica', account_role: 'admin' },
    { user_id: 'u-juan', full_name: 'Juan', account_role: 'agent' },
    { user_id: 'u-brayan', full_name: 'Brayan', account_role: 'agent' },
  ]
  mocks.upserts = []
  mocks.rpcCalls = []
  mocks.rpcError = null
  mocks.requireRole.mockReset().mockResolvedValue({
    supabase: cliente(),
    accountId: 'acct-1',
    userId: 'u-ange',
    role: 'admin',
  })
})

describe('GET /api/assignment/settings', () => {
  it('exige admin', async () => {
    mocks.requireRole.mockReset().mockRejectedValue(new Error('forbidden'))
    expect((await GET()).status).toBe(403)
  })

  it('sin configuración devuelve los valores por defecto', async () => {
    const body = await (await GET()).json()
    expect(body).toMatchObject({
      stale_assign_after_hours: null,
      stale_assign_enabled_at: null,
      bot_reactivate_after_days: 7,
      weights: [],
      agents: [
        { user_id: 'u-juan', full_name: 'Juan' },
        { user_id: 'u-brayan', full_name: 'Brayan' },
      ],
    })
  })

  it('marca como no elegible a quien ya no es agent', async () => {
    mocks.settings = {
      stale_assign_after_hours: 3,
      stale_assign_enabled_at: '2026-09-23T00:00:00Z',
      bot_reactivate_after_days: 10,
      weights_updated_at: '2026-09-23T00:00:00Z',
    }
    mocks.weights = [
      { user_id: 'u-juan', percent: 60 },
      { user_id: 'u-ange', percent: 40 },
    ]
    const body = await (await GET()).json()
    expect(body.weights).toEqual([
      { user_id: 'u-juan', full_name: 'Juan', percent: 60, eligible: true },
      { user_id: 'u-ange', full_name: 'Angélica', percent: 40, eligible: false },
    ])
    expect(body.bot_reactivate_after_days).toBe(10)
  })
})

describe('PUT /api/assignment/settings', () => {
  it('guarda los porcentajes por la RPC, con la sesión', async () => {
    const res = await put({
      weights: [
        { user_id: 'u-juan', percent: 50 },
        { user_id: 'u-brayan', percent: 50 },
      ],
    })
    expect(res.status).toBe(200)
    expect(mocks.rpcCalls).toEqual([
      {
        fn: 'set_assignment_weights',
        args: {
          p_account_id: 'acct-1',
          p_weights: [
            { user_id: 'u-juan', percent: 50 },
            { user_id: 'u-brayan', percent: 50 },
          ],
        },
      },
    ])
    expect(mocks.upserts).toEqual([])
  })

  it('una suma distinta de 100 es 400 con su código, sin escribir', async () => {
    const res = await put({ weights: [{ user_id: 'u-juan', percent: 90 }] })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'weights_sum' })
    expect(mocks.rpcCalls).toEqual([])
  })

  it('un admin en la lista es 400 weights_not_agent', async () => {
    const res = await put({ weights: [{ user_id: 'u-ange', percent: 100 }] })
    expect(await res.json()).toMatchObject({ code: 'weights_not_agent' })
  })

  it('guarda los plazos sin mandar la fecha de activación', async () => {
    const res = await put({
      stale_assign_after_hours: 3,
      bot_reactivate_after_days: null,
      stale_assign_enabled_at: '2020-01-01',
    })
    expect(res.status).toBe(200)
    expect(mocks.upserts).toEqual([
      { account_id: 'acct-1', stale_assign_after_hours: 3, bot_reactivate_after_days: null },
    ])
  })

  it('horas inválidas son 400 con su código', async () => {
    const res = await put({ stale_assign_after_hours: 0 })
    expect(await res.json()).toMatchObject({ code: 'stale_hours_invalid' })
  })

  it('devuelve el plazo en horas', async () => {
    mocks.settings = {
      stale_assign_after_hours: 3,
      stale_assign_enabled_at: '2026-09-23T00:00:00Z',
      bot_reactivate_after_days: 7,
      weights_updated_at: '2026-09-23T00:00:00Z',
    }
    const body = await (await GET()).json()
    expect(body).toMatchObject({ stale_assign_after_hours: 3 })
    expect(body).not.toHaveProperty('stale_assign_after_days')
  })

  // La carrera que la validación previa no ve: un asesor cambió de rol.
  it('traduce el rechazo de la base por rol', async () => {
    mocks.rpcError = { code: '22023', message: 'weights_not_agent' }
    const res = await put({ weights: [{ user_id: 'u-juan', percent: 100 }] })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'weights_not_agent' })
  })

  it('un fallo desconocido de la base es 500 save_failed', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.rpcError = { code: 'XX000', message: 'boom' }
    const res = await put({ weights: [{ user_id: 'u-juan', percent: 100 }] })
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ code: 'save_failed' })
    spy.mockRestore()
  })
})
