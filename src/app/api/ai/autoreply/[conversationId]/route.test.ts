import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  /** Lo último que se escribió en `conversations`, y con QUÉ cliente. */
  updatePayload: null as Record<string, unknown> | null,
  /** 'sesion' | 'admin' — es la mitad de lo que hay que probar acá. */
  escritoPor: null as string | null,
  /** Quién tiene hoy asignada la conversación que se lee. */
  asignadoActual: null as string | null,
  /** `ai_autoreply_disabled` de la conversación antes de la llamada. */
  iaPausada: true as boolean | null,
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

/**
 * Cliente falso que apunta QUIÉN escribió. La reactivación tiene que ir
 * por el de service-role —la RLS la rechaza— y la pausa por el de
 * sesión, que es lo que conserva la comprobación de visibilidad.
 */
function cliente(quien: string) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: {
                  id: 'conv-1',
                  assigned_agent_id: mocks.asignadoActual,
                  ai_autoreply_disabled: mocks.iaPausada,
                },
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
    }),
  }
}

import { POST } from './route'

function request(body: unknown) {
  return new Request('http://localhost/api/ai/autoreply/conv-1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const params = { params: Promise.resolve({ conversationId: 'conv-1' }) }

function comoRol(role: string, userId = 'user-1') {
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
  // Por defecto, el hilo es de quien llama: es el estado desde el que se
  // pulsa "Reactivar IA" tras un traspaso.
  mocks.asignadoActual = 'user-1'
  // ...y con la IA pausada, que es lo que deja ese traspaso.
  mocks.iaPausada = true
  mocks.requireRole.mockReset()
  comoRol('agent')
})

describe('POST /api/ai/autoreply/[conversationId] — reanudar', () => {
  // Reactivar deja el hilo como nuevo para el gate de datos y le da cupo
  // nuevo al bot.
  it('reactiva la IA y resetea los contadores', async () => {
    const res = await POST(request({ paused: false }), params)

    expect(res.status).toBe(200)
    expect(mocks.updatePayload).toEqual({
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
      ai_handoff_attempts: 0,
    })
  })

  // P2 (sticky-weighted-assignment): el asesor de un contacto es
  // pegajoso. Antes reactivar ponía `assigned_agent_id = null`; ahora el
  // bot atiende y, cuando traspase, va a este mismo asesor.
  it('NO toca al asesor', async () => {
    await POST(request({ paused: false }), params)

    expect(mocks.updatePayload).not.toHaveProperty('assigned_agent_id')
  })

  it('conserva la nota del traspaso', async () => {
    await POST(request({ paused: false }), params)

    expect(mocks.updatePayload).not.toHaveProperty('ai_handoff_summary')
  })

  // La fila sigue siendo del agent: la RLS la deja pasar con su sesión.
  it('escribe con la sesión, sin service-role', async () => {
    await POST(request({ paused: false }), params)

    expect(mocks.escritoPor).toBe('sesion')
  })

  it('un agent no controla la IA en el hilo de otro asesor', async () => {
    mocks.asignadoActual = 'user-brayan'

    const res = await POST(request({ paused: false }), params)

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'not_assignee' })
    expect(mocks.updatePayload).toBeNull()
  })

  it('un agent no controla la IA en un hilo sin asesor', async () => {
    mocks.asignadoActual = null

    const res = await POST(request({ paused: false }), params)

    expect(res.status).toBe(403)
    expect(mocks.updatePayload).toBeNull()
  })

  // Reactivar ya no suelta el hilo, así que hacerlo con la IA activa es
  // inocuo (como pulsar dos veces) y deja de rechazarse.
  it('reactivar con la IA ya activa se acepta', async () => {
    mocks.iaPausada = false

    const res = await POST(request({ paused: false }), params)

    expect(res.status).toBe(200)
  })

  it('un admin reactiva el hilo de otro asesor, sin quitárselo', async () => {
    comoRol('admin')
    mocks.asignadoActual = 'user-brayan'

    const res = await POST(request({ paused: false }), params)

    expect(res.status).toBe(200)
    expect(mocks.updatePayload).not.toHaveProperty('assigned_agent_id')
    expect(mocks.escritoPor).toBe('sesion')
  })
})

describe('POST /api/ai/autoreply/[conversationId] — tomar el control', () => {
  it('pausa la IA sin tocar el contador', async () => {
    const res = await POST(request({ paused: true, assign_to_me: true }), params)

    expect(res.status).toBe(200)
    expect(mocks.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(mocks.updatePayload).not.toHaveProperty('ai_handoff_attempts')
    expect(mocks.escritoPor).toBe('sesion')
  })

  // El hilo ya es de quien lo toma: no hay nada que reasignar.
  it('el agent que toma su propio hilo no reescribe el asesor', async () => {
    await POST(request({ paused: true, assign_to_me: true }), params)

    expect(mocks.updatePayload).not.toHaveProperty('assigned_agent_id')
  })

  // Tomar el control no le quita el cliente a nadie.
  it('un admin que toma el hilo de Brayan no se lo quita', async () => {
    comoRol('admin', 'user-admin')
    mocks.asignadoActual = 'user-brayan'

    const res = await POST(request({ paused: true, assign_to_me: true }), params)

    expect(res.status).toBe(200)
    expect(mocks.updatePayload).toEqual({ ai_autoreply_disabled: true })
  })

  it('un admin que toma un hilo sin asesor se lo asigna', async () => {
    comoRol('admin', 'user-admin')
    mocks.asignadoActual = null

    const res = await POST(request({ paused: true, assign_to_me: true }), params)

    expect(res.status).toBe(200)
    expect(mocks.updatePayload).toEqual({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'user-admin',
    })
    expect(await res.json()).toMatchObject({ assigned_agent_id: 'user-admin' })
  })
})
