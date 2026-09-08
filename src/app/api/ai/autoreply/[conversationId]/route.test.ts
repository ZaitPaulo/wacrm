import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  /** Lo último que la ruta escribió en `conversations`. */
  updatePayload: null as Record<string, unknown> | null,
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

import { POST } from './route'

const supabase = {
  from: () => ({
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { id: 'conv-1' }, error: null }),
        }),
      }),
    }),
    update: (payload: Record<string, unknown>) => {
      mocks.updatePayload = payload
      return {
        eq: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }
    },
  }),
}

function request(body: unknown) {
  return new Request('http://localhost/api/ai/autoreply/conv-1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const params = { params: Promise.resolve({ conversationId: 'conv-1' }) }

beforeEach(() => {
  mocks.updatePayload = null
  mocks.requireRole.mockReset()
  mocks.requireRole.mockResolvedValue({
    supabase,
    accountId: 'account-1',
    userId: 'user-1',
    role: 'agent',
  })
})

describe('POST /api/ai/autoreply/[conversationId]', () => {
  // Reactivar tiene que dejar el hilo como nuevo también para el gate de
  // datos: si el contador quedara en 1, la próxima urgencia transferiría
  // de inmediato por el escape del segundo intento, sin darle al bot su
  // turno de recolectar el nombre.
  it('resetea el contador de transferencias rechazadas al reanudar', async () => {
    const res = await POST(request({ paused: false }), params)

    expect(res.status).toBe(200)
    expect(mocks.updatePayload).toMatchObject({
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
      ai_handoff_summary: null,
      ai_handoff_attempts: 0,
      assigned_agent_id: null,
    })
  })

  it('no toca el contador al pausar', async () => {
    const res = await POST(request({ paused: true, assign_to_me: true }), params)

    expect(res.status).toBe(200)
    expect(mocks.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'user-1',
    })
    expect(mocks.updatePayload).not.toHaveProperty('ai_handoff_attempts')
  })
})
