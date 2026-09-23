import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  updatePayload: null as Record<string, unknown> | null,
  /** 'sesion' | 'admin': con qué cliente se escribió. */
  escritoPor: null as string | null,
  asignadoActual: null as string | null,
  /** Miembros de la cuenta, tal como los devuelve `profiles`. */
  miembros: [] as { user_id: string }[],
  /** Para simular que la conversación no es visible / no existe. */
  conversacionVisible: true,
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() =>
    Response.json({ error: 'auth failed' }, { status: 403 }),
  ),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ success: true })),
  rateLimitResponse: vi.fn(() =>
    Response.json({ error: 'rate limited' }, { status: 429 }),
  ),
  RATE_LIMITS: { send: { limit: 30, windowMs: 60_000 } },
}))

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => cliente('admin'),
}))

function cliente(quien: string) {
  return {
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: mocks.miembros, error: null }),
          }),
        }
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: mocks.conversacionVisible
                    ? { id: 'conv-1', assigned_agent_id: mocks.asignadoActual }
                    : null,
                  error: null,
                }),
            }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          mocks.updatePayload = payload
          mocks.escritoPor = quien
          return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }
        },
      }
    },
  }
}

import { PATCH } from './route'

function request(body: unknown) {
  return new Request('http://localhost/api/conversations/conv-1/assignee', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const params = { params: Promise.resolve({ conversationId: 'conv-1' }) }

function comoRol(role: string, userId = 'u-juan') {
  mocks.requireRole.mockResolvedValue({
    supabase: cliente('sesion'),
    accountId: 'account-1',
    userId,
    role,
  })
}

beforeEach(() => {
  mocks.updatePayload = null
  mocks.escritoPor = null
  mocks.asignadoActual = 'u-juan'
  mocks.miembros = [{ user_id: 'u-juan' }, { user_id: 'u-brayan' }, { user_id: 'u-ange' }]
  mocks.conversacionVisible = true
  mocks.requireRole.mockReset()
  comoRol('admin', 'u-ange')
})

describe('PATCH /api/conversations/[id]/assignee', () => {
  // P2 (sticky-weighted-assignment): el asesor de un contacto solo lo
  // cambia un owner/admin a mano. La ruta pide 'admin' y un agent recibe
  // 403 de requireRole.
  it('exige rol admin', async () => {
    await PATCH(request({ assigned_agent_id: 'u-brayan' }), params)
    expect(mocks.requireRole).toHaveBeenCalledWith('admin')
  })

  it('un agent no reasigna, ni siquiera su propia conversación', async () => {
    mocks.requireRole.mockReset().mockRejectedValue(new Error('forbidden'))

    const res = await PATCH(request({ assigned_agent_id: 'u-brayan' }), params)

    expect(res.status).toBe(403)
    expect(mocks.updatePayload).toBeNull()
  })

  it('un agent tampoco la suelta', async () => {
    mocks.requireRole.mockReset().mockRejectedValue(new Error('forbidden'))

    const res = await PATCH(request({ assigned_agent_id: null }), params)

    expect(res.status).toBe(403)
    expect(mocks.updatePayload).toBeNull()
  })

  it('el admin reasigna cualquier conversación de su cuenta', async () => {
    mocks.asignadoActual = 'u-brayan'

    const res = await PATCH(request({ assigned_agent_id: 'u-juan' }), params)

    expect(res.status).toBe(200)
    expect(mocks.updatePayload).toEqual({ assigned_agent_id: 'u-juan' })
  })

  it('el admin sí puede soltarla', async () => {
    const res = await PATCH(request({ assigned_agent_id: null }), params)

    expect(res.status).toBe(200)
    expect(mocks.updatePayload).toEqual({ assigned_agent_id: null })
  })

  // Escribe con SU SESIÓN: `notify_conversation_assigned` nombra a quien
  // reasignó con `auth.uid()`, que con service-role es NULL ("Angélica te
  // asignó…" frente a "Se te asignó…"). Y con sesión siguen mandando la
  // RLS y el trigger de la 520. Ya no hay rama de service-role.
  it('escribe con la sesión, nunca con service-role', async () => {
    mocks.asignadoActual = 'u-brayan'

    await PATCH(request({ assigned_agent_id: 'u-juan' }), params)

    expect(mocks.escritoPor).toBe('sesion')
  })

  // `conversations.assigned_agent_id` no tiene clave ajena.
  it('rechaza un destinatario que no es miembro de la cuenta', async () => {
    const res = await PATCH(request({ assigned_agent_id: 'u-de-otra-cuenta' }), params)

    expect(res.status).toBe(400)
    expect(mocks.updatePayload).toBeNull()
  })

  it('404 cuando la conversación no es de la cuenta', async () => {
    mocks.conversacionVisible = false

    const res = await PATCH(request({ assigned_agent_id: 'u-brayan' }), params)

    expect(res.status).toBe(404)
    expect(mocks.updatePayload).toBeNull()
  })

  it('no escribe cuando el asesor ya era el asignado', async () => {
    const res = await PATCH(request({ assigned_agent_id: 'u-juan' }), params)

    expect(res.status).toBe(200)
    expect(mocks.updatePayload).toBeNull()
  })

  it('rechaza un cuerpo sin assigned_agent_id', async () => {
    expect((await PATCH(request({}), params)).status).toBe(400)
    expect((await PATCH(request({ assigned_agent_id: 42 }), params)).status).toBe(400)
  })
})
