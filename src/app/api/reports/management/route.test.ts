import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockSupabase, state, authMock } = vi.hoisted(() => {
  const state: {
    profiles: { user_id: string; full_name: string }[]
    rpcRows: unknown[]
    rpcError: { message: string } | null
    rpcArgs: Record<string, unknown> | null
  } = { profiles: [], rpcRows: [], rpcError: null, rpcArgs: null }

  const mockSupabase = {
    from: vi.fn().mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          in: vi.fn().mockImplementation((_col: string, ids: string[]) =>
            Promise.resolve({
              data: state.profiles.filter((p) => ids.includes(p.user_id)),
              error: null,
            }),
          ),
        }),
      }),
    })),
    rpc: vi.fn().mockImplementation((_fn: string, args: Record<string, unknown>) => {
      state.rpcArgs = args
      return Promise.resolve({ data: state.rpcRows, error: state.rpcError })
    }),
  }

  const authMock = {
    requireRole: vi.fn(),
  }

  return { mockSupabase, state, authMock }
})

vi.mock('@/lib/auth/account', async () => {
  const { NextResponse } = await import('next/server')
  class UnauthorizedError extends Error {
    readonly status = 401 as const
  }
  class ForbiddenError extends Error {
    readonly status = 403 as const
  }
  return {
    UnauthorizedError,
    ForbiddenError,
    requireRole: authMock.requireRole,
    toErrorResponse: (err: unknown) => {
      const status =
        err instanceof UnauthorizedError || err instanceof ForbiddenError
          ? err.status
          : 500
      return NextResponse.json({ error: String(err) }, { status })
    },
  }
})

import { GET } from './route'
import * as account from '@/lib/auth/account'

const ADMIN = {
  supabase: mockSupabase,
  userId: 'user-1',
  accountId: 'acc-1',
  role: 'admin',
  account: { id: 'acc-1', name: 'Cuenta' },
}
const AGENT_ID = 'b8e22c86-9d53-4489-a848-fd755bb770c9'

const req = (q = '') => new Request(`http://localhost/api/reports/management${q}`)

describe('GET /api/reports/management', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.profiles = [
      { user_id: 'user-1', full_name: 'Ana Owner' },
      { user_id: AGENT_ID, full_name: 'Robinson' },
    ]
    state.rpcRows = []
    state.rpcError = null
    state.rpcArgs = null
    authMock.requireRole.mockResolvedValue(ADMIN)
  })

  it('401 sin sesión', async () => {
    authMock.requireRole.mockRejectedValue(new account.UnauthorizedError('Unauthorized'))
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })

  it('403 para un asesor', async () => {
    authMock.requireRole.mockRejectedValue(new account.ForbiddenError('Forbidden'))
    const res = await GET(req())
    expect(res.status).toBe(403)
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })

  it('exige rol admin', async () => {
    await GET(req())
    expect(authMock.requireRole).toHaveBeenCalledWith('admin')
  })

  it('400 con rango invertido', async () => {
    const res = await GET(req('?from=2026-10-10&to=2026-10-01'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/posterior/)
  })

  it('400 si el asesor no es miembro de la cuenta', async () => {
    const res = await GET(req('?agent=11111111-2222-4333-8444-555555555555'))
    expect(res.status).toBe(400)
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })

  it('500 si la consulta falla', async () => {
    state.rpcError = { message: 'boom' }
    const res = await GET(req())
    expect(res.status).toBe(500)
  })

  it('200 con el archivo para admin, y pasa los filtros a la función', async () => {
    const res = await GET(req(`?from=2026-09-01&to=2026-09-30&agent=${AGENT_ID}`))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    expect(res.headers.get('Content-Disposition')).toMatch(
      /^attachment; filename="informe-gestion-\d{4}-\d{2}-\d{2}\.xlsx"$/,
    )
    const bytes = new Uint8Array(await res.arrayBuffer())
    // Un .xlsx es un zip: empieza con "PK".
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)

    expect(state.rpcArgs).toMatchObject({
      p_account_id: 'acc-1',
      p_from: new Date(2026, 8, 1).toISOString(),
      p_to: new Date(2026, 9, 1).toISOString(),
      p_agent: AGENT_ID,
      p_limit: 10_001,
    })
  }, 60_000)
})
