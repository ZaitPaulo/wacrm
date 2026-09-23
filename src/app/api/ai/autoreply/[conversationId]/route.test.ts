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
  // Reactivar tiene que dejar el hilo como nuevo también para el gate de
  // datos: si el contador quedara en 1, la próxima urgencia transferiría
  // de inmediato por el escape del segundo intento, sin darle al bot su
  // turno de recolectar el nombre.
  it('resetea el contador de transferencias rechazadas', async () => {
    const res = await POST(request({ paused: false }), params)

    expect(res.status).toBe(200)
    expect(mocks.updatePayload).toMatchObject({
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
      ai_handoff_attempts: 0,
      assigned_agent_id: null,
    })
  })

  // ESCENARIO: Reactivar conserva el contexto.
  //
  // La nota del traspaso lleva el motivo y los datos de calificación que
  // el bot recogió. Borrarla dejaba al siguiente que tomara el hilo
  // empezando de cero, justo cuando el hilo se queda sin dueño.
  it('conserva la nota del traspaso', async () => {
    const res = await POST(request({ paused: false }), params)

    expect(res.status).toBe(200)
    expect(mocks.updatePayload).not.toHaveProperty('ai_handoff_summary')
  })

  // EL DEFECTO QUE ESTO ARREGLA. Con el cliente de sesión la RLS rechaza
  // la fila resultante —el asesor se deja el hilo invisible a sí mismo en
  // la misma sentencia— y el asesor recibía un 500. Los tres miembros que
  // atienden en producción tienen rol `agent`, o sea que NINGUNO podía
  // reactivar el bot.
  it('escribe con el cliente de service-role, no con el de sesión', async () => {
    const res = await POST(request({ paused: false }), params)

    expect(res.status).toBe(200)
    expect(mocks.escritoPor).toBe('admin')
  })

  // Service-role apaga la RLS Y el trigger de la 520, así que la regla
  // pasa a comprobarse acá: un asesor solo suelta lo que es suyo.
  it('un agent no puede devolver al bot un hilo de otro asesor', async () => {
    mocks.asignadoActual = 'user-brayan'

    const res = await POST(request({ paused: false }), params)

    expect(res.status).toBe(403)
    // Y no se escribió nada: la guarda va antes del UPDATE.
    expect(mocks.updatePayload).toBeNull()
    expect(mocks.escritoPor).toBeNull()
  })

  it('un agent tampoco puede devolver al bot un hilo sin asignar', async () => {
    mocks.asignadoActual = null

    const res = await POST(request({ paused: false }), params)

    expect(res.status).toBe(403)
    expect(mocks.updatePayload).toBeNull()
  })

  // LA TRANSICIÓN. Service-role salta el trigger de la 520, así que si
  // la ruta no mirara que la IA estaba pausada, `paused: false` serviría
  // para soltar cualquier hilo propio con la IA ya activa.
  it('un agent no puede soltar un hilo suyo cuya IA ya estaba activa', async () => {
    mocks.iaPausada = false

    const res = await POST(request({ paused: false }), params)

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'ai_already_active' })
    expect(mocks.updatePayload).toBeNull()
    expect(mocks.escritoPor).toBeNull()
  })

  it('un estado de IA desconocido se trata como activo, y se rechaza', async () => {
    mocks.iaPausada = null

    const res = await POST(request({ paused: false }), params)

    expect(res.status).toBe(403)
    expect(mocks.updatePayload).toBeNull()
  })

  it('el rechazo por hilo ajeno trae su propio código', async () => {
    mocks.asignadoActual = 'user-brayan'

    const res = await POST(request({ paused: false }), params)

    expect(await res.json()).toMatchObject({ code: 'not_assignee' })
  })

  // El admin puede dejar sin asignar sin excepción que invocar: la
  // condición de transición es solo para el `agent`.
  it('un admin sí puede reactivar aunque la IA ya estuviera activa', async () => {
    comoRol('admin')
    mocks.iaPausada = false

    const res = await POST(request({ paused: false }), params)

    expect(res.status).toBe(200)
    expect(mocks.updatePayload).toMatchObject({ assigned_agent_id: null })
  })

  // El admin administra la cuenta entera: puede devolver al bot
  // cualquier hilo, también uno que lleva otro. Y lo hace con SU SESIÓN:
  // la RLS le deja porque la fila le sigue siendo visible, así que no
  // hay motivo para apagarla. Solo se sale del camino normal quien no
  // cabe en él.
  it('un admin devuelve al bot el hilo de otro, y con su propia sesión', async () => {
    comoRol('admin')
    mocks.asignadoActual = 'user-brayan'

    const res = await POST(request({ paused: false }), params)

    expect(res.status).toBe(200)
    expect(mocks.escritoPor).toBe('sesion')
  })
})

describe('POST /api/ai/autoreply/[conversationId] — pausar', () => {
  it('no toca el contador al pausar', async () => {
    const res = await POST(request({ paused: true, assign_to_me: true }), params)

    expect(res.status).toBe(200)
    expect(mocks.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'user-1',
    })
    expect(mocks.updatePayload).not.toHaveProperty('ai_handoff_attempts')
  })

  // Pausar NO necesita service-role: la fila resultante sigue siendo
  // visible para quien la escribe, así que la RLS la deja pasar y se
  // conserva como segunda barrera. Solo se sale del camino normal lo que
  // de verdad no cabe en él.
  it('pausar sigue escribiendo con el cliente de sesión', async () => {
    const res = await POST(request({ paused: true, assign_to_me: true }), params)

    expect(res.status).toBe(200)
    expect(mocks.escritoPor).toBe('sesion')
  })

  // Tomar un hilo no es soltarlo: acá no aplica la guarda de asignación,
  // y un asesor puede tomar uno que estaba sin asignar si la RLS se lo
  // deja ver (un admin se lo pasó, por ejemplo).
  it('pausar no exige ser el asignado actual', async () => {
    mocks.asignadoActual = null

    const res = await POST(request({ paused: true, assign_to_me: true }), params)

    expect(res.status).toBe(200)
    expect(mocks.escritoPor).toBe('sesion')
  })
})
