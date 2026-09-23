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
  comoRol('agent')
})

describe('PATCH /api/conversations/[id]/assignee', () => {
  // EL DEFECTO QUE ESTO ARREGLA, preexistente desde la 520: la bandeja
  // hacía el UPDATE desde el navegador y la RLS lo rechazaba siempre que
  // la conversación dejaba de ser del asesor — o sea en el único caso en
  // que el desplegable sirve. El asesor veía "Failed to update
  // assignment" y no había forma de reasignar.
  it('el asesor le pasa su conversación a un compañero', async () => {
    const res = await PATCH(request({ assigned_agent_id: 'u-brayan' }), params)

    expect(res.status).toBe(200)
    expect(mocks.updatePayload).toEqual({ assigned_agent_id: 'u-brayan' })
    // Con service-role: es lo que la RLS no deja pasar.
    expect(mocks.escritoPor).toBe('admin')
  })

  // Service-role apaga la RLS y el trigger, así que la regla de la 520 se
  // comprueba en código antes de escribir.
  it('el asesor no puede reasignar la conversación de otro', async () => {
    mocks.asignadoActual = 'u-brayan'

    const res = await PATCH(request({ assigned_agent_id: 'u-juan' }), params)

    expect(res.status).toBe(403)
    expect(mocks.updatePayload).toBeNull()
  })

  it('el asesor no puede tomar una conversación sin asignar', async () => {
    mocks.asignadoActual = null

    const res = await PATCH(request({ assigned_agent_id: 'u-juan' }), params)

    expect(res.status).toBe(403)
    expect(mocks.updatePayload).toBeNull()
  })

  // "Un asesor puede pasar la conversación a otro miembro, pero no
  // dejarla sin asignar": la regla del trigger de la 520, que con
  // service-role ya no se aplica sola.
  it('el asesor no puede soltar la conversación', async () => {
    const res = await PATCH(request({ assigned_agent_id: null }), params)

    expect(res.status).toBe(403)
    expect(mocks.updatePayload).toBeNull()
  })

  it('el admin sí puede soltarla', async () => {
    comoRol('admin', 'u-ange')

    const res = await PATCH(request({ assigned_agent_id: null }), params)

    expect(res.status).toBe(200)
    expect(mocks.updatePayload).toEqual({ assigned_agent_id: null })
  })

  it('el admin reasigna cualquier conversación de su cuenta', async () => {
    comoRol('admin', 'u-ange')
    mocks.asignadoActual = 'u-brayan'

    const res = await PATCH(request({ assigned_agent_id: 'u-juan' }), params)

    expect(res.status).toBe(200)
    expect(mocks.updatePayload).toEqual({ assigned_agent_id: 'u-juan' })
  })

  // LAS DOS MITADES DE LA BIFURCACIÓN.
  //
  // El admin escribe con SU SESIÓN, y eso no es un detalle de
  // implementación: `notify_conversation_assigned` nombra a quien
  // reasignó leyendo `auth.uid()`, que con service-role es NULL. Con
  // sesión el aviso dice "Angélica te asignó una conversación con Juan";
  // por service-role diría "Se te asignó…", perdiendo información que
  // los admin tienen hoy.
  //
  // Si alguien unifica esto a una sola rama, esta prueba es la que lo
  // atrapa.
  it('el admin escribe con su sesión, para que el aviso conserve su nombre', async () => {
    comoRol('admin', 'u-ange')
    mocks.asignadoActual = 'u-brayan'

    await PATCH(request({ assigned_agent_id: 'u-juan' }), params)

    expect(mocks.escritoPor).toBe('sesion')
  })

  // El asesor no cabe en el camino normal: al pasar el hilo deja de
  // verlo y la RLS rechaza la fila resultante. Su aviso sale impersonal,
  // y no pierde nada — hasta ahora no podía reasignar en absoluto.
  it('el asesor escribe con service-role, que es lo único que le funciona', async () => {
    await PATCH(request({ assigned_agent_id: 'u-brayan' }), params)

    expect(mocks.escritoPor).toBe('admin')
  })

  // `conversations.assigned_agent_id` no tiene clave ajena, y con la RLS
  // apagada nada impediría escribir un UUID cualquiera. La conversación
  // quedaría a nombre de nadie: invisible para todos los asesores y fuera
  // de la fila "Sin asignar" del tablero.
  it('rechaza un destinatario que no es miembro de la cuenta', async () => {
    const res = await PATCH(
      request({ assigned_agent_id: 'u-de-otra-cuenta' }),
      params,
    )

    expect(res.status).toBe(400)
    expect(mocks.updatePayload).toBeNull()
  })

  // La lectura previa va con el cliente de SESIÓN a propósito: es lo que
  // conserva la comprobación de visibilidad de la 520. Si se hiciera con
  // el cliente admin, un asesor podría reasignar la cartera de sus
  // compañeros sabiendo el id de la conversación.
  it('404 cuando la conversación no es visible para quien llama', async () => {
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
