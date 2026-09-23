import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildHandoffDealTitle, createHandoffDeal } from './handoff-deal'
import type { HandoffRequest } from './types'

interface FakeOptions {
  pipelines?: { id: string; name: string; created_at: string }[]
  pipelinesError?: { message: string } | null
  stages?: { id: string; position: number }[]
  stagesError?: { message: string } | null
  currency?: string | null
  /** Error que devuelve el insert de `deals`, si lo hay. */
  insertError?: { code?: string; message: string } | null
}

interface Captured {
  deal?: Record<string, unknown>
  pipelineConsultado?: string
}

/**
 * Cliente mínimo con las cuatro tablas que toca la creación del
 * negocio: embudos, etapas, la cuenta (por la moneda) y `deals`.
 */
function fakeDb(opts: FakeOptions, captured: Captured) {
  return {
    from(table: string) {
      if (table === 'pipelines') {
        const chain = {
          select: () => chain,
          eq: () =>
            Promise.resolve({
              data: opts.pipelines ?? [],
              error: opts.pipelinesError ?? null,
            }),
        }
        return chain
      }
      if (table === 'pipeline_stages') {
        const chain = {
          select: () => chain,
          eq: (_col: string, value: string) => {
            captured.pipelineConsultado = value
            return chain
          },
          order: () => chain,
          limit: () => chain,
          maybeSingle: () => {
            const ordenadas = [...(opts.stages ?? [])].sort(
              (a, b) => a.position - b.position,
            )
            return Promise.resolve({
              data: ordenadas[0] ?? null,
              error: opts.stagesError ?? null,
            })
          },
        }
        return chain
      }
      if (table === 'accounts') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () =>
            Promise.resolve({
              data: opts.currency === null ? null : { default_currency: opts.currency ?? 'COP' },
              error: null,
            }),
        }
        return chain
      }
      // deals
      const chain = {
        insert: (row: Record<string, unknown>) => {
          captured.deal = row
          return chain
        },
        select: () => chain,
        single: () =>
          Promise.resolve(
            opts.insertError
              ? { data: null, error: opts.insertError }
              : { data: { id: 'deal-1' }, error: null },
          ),
      }
      return chain
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const VENTAS = { id: 'p-ventas', name: 'Ventas', created_at: '2026-08-25T01:40:23Z' }
const POSVENTA = { id: 'p-post', name: 'Posventa', created_at: '2026-01-01T00:00:00Z' }
const ETAPAS = [
  { id: 'st-contactado', position: 1 },
  { id: 'st-prospecto', position: 0 },
  { id: 'st-cotizado', position: 2 },
]

function request(over: Partial<HandoffRequest> = {}): HandoffRequest {
  return {
    nombre: 'Carlos',
    presupuesto: '30 millones',
    interes: 'Mazda 3 2018',
    credito: true,
    ocupacion: 'independiente',
    ingresos: '4 millones',
    motivo: 'credito',
    ...over,
  }
}

const BASE = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  ownerUserId: 'u-owner',
  assignedProfileId: 'p-juan',
  summary: '🤖 El bot traspasó la conversación tras 2 respuestas.',
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('buildHandoffDealTitle', () => {
  it('junta el nombre del cliente y el vehículo que pidió', () => {
    expect(buildHandoffDealTitle(request())).toBe('Carlos — Mazda 3 2018')
  })

  // ESCENARIO: Traspaso urgente sin presupuesto — solo hay nombre.
  // No se rellena el hueco con un "Sin vehículo" que se leería como
  // dato: lo que falta va señalado como falta en la nota, no en el
  // título.
  it('se queda con lo que hay cuando el bot no averiguó el resto', () => {
    expect(buildHandoffDealTitle(request({ interes: null }))).toBe('Carlos')
    expect(buildHandoffDealTitle(request({ nombre: '  ' }))).toBe('Mazda 3 2018')
  })

  it('no inventa nada cuando no hay calificación', () => {
    expect(buildHandoffDealTitle(null)).toBe('Traspaso del asistente')
    expect(buildHandoffDealTitle(request({ nombre: null, interes: null }))).toBe(
      'Traspaso del asistente',
    )
  })
})

describe('createHandoffDeal — escenario del traspaso normal', () => {
  it('crea el negocio en Ventas / primera etapa, asignado al asesor', async () => {
    const captured: Captured = {}
    const res = await createHandoffDeal(
      fakeDb({ pipelines: [POSVENTA, VENTAS], stages: ETAPAS }, captured),
      { ...BASE, request: request() },
    )

    expect(res).toEqual({ status: 'created', dealId: 'deal-1' })
    // "Ventas" gana aunque Posventa sea más antiguo: mismo criterio que
    // la creación a mano desde la bandeja.
    expect(captured.pipelineConsultado).toBe('p-ventas')
    expect(captured.deal).toMatchObject({
      account_id: 'acct-1',
      user_id: 'u-owner',
      pipeline_id: 'p-ventas',
      // La de menor `position`, no la primera que devuelva la consulta.
      stage_id: 'st-prospecto',
      contact_id: 'contact-1',
      conversation_id: 'conv-1',
      status: 'open',
      assigned_to: 'p-juan',
      title: 'Carlos — Mazda 3 2018',
    })
  })

  it('conserva la nota del traspaso entera en el negocio', async () => {
    const captured: Captured = {}
    await createHandoffDeal(fakeDb({ pipelines: [VENTAS], stages: ETAPAS }, captured), {
      ...BASE,
      summary: 'Motivo: crédito · Nombre: Carlos · Presupuesto: (falta)',
      request: request({ presupuesto: null }),
    })

    // Lo que el bot no obtuvo queda señalado como falta, no relleno.
    expect(captured.deal?.notes).toContain('Presupuesto: (falta)')
    expect(captured.deal?.notes).toContain('Motivo: crédito')
  })

  // `presupuesto` es texto libre tal como lo dijo el cliente ("30
  // millones"). Convertirlo a número sería inventarle una cifra al
  // negocio; el dato sigue entero en la nota.
  it('no convierte el presupuesto en el valor del negocio', async () => {
    const captured: Captured = {}
    await createHandoffDeal(fakeDb({ pipelines: [VENTAS], stages: ETAPAS }, captured), {
      ...BASE,
      request: request(),
    })
    expect(captured.deal?.value).toBe(0)
  })

  it('usa la moneda de la cuenta y no el default de la columna', async () => {
    const captured: Captured = {}
    await createHandoffDeal(
      fakeDb({ pipelines: [VENTAS], stages: ETAPAS, currency: 'COP' }, captured),
      { ...BASE, request: request() },
    )
    expect(captured.deal?.currency).toBe('COP')
  })

  it('sin "Ventas" cae al embudo más antiguo', async () => {
    const captured: Captured = {}
    await createHandoffDeal(
      fakeDb(
        {
          pipelines: [
            { id: 'p-b', name: 'Otro', created_at: '2026-05-01T00:00:00Z' },
            { id: 'p-a', name: 'Viejo', created_at: '2026-01-01T00:00:00Z' },
          ],
          stages: ETAPAS,
        },
        captured,
      ),
      { ...BASE, request: request() },
    )
    expect(captured.deal?.pipeline_id).toBe('p-a')
  })
})

describe('createHandoffDeal — escenario de la cola compartida', () => {
  // ESCENARIO: El traspaso queda en la cola compartida.
  it('crea el negocio igual, sin asesor asignado', async () => {
    const captured: Captured = {}
    const res = await createHandoffDeal(
      fakeDb({ pipelines: [VENTAS], stages: ETAPAS }, captured),
      { ...BASE, assignedProfileId: null, request: request() },
    )

    expect(res.status).toBe('created')
    expect(captured.deal?.assigned_to).toBeNull()
  })
})

describe('createHandoffDeal — escenario de la segunda transferencia', () => {
  // ESCENARIO: Segunda transferencia del mismo hilo.
  //
  // La deduplicación la hace el índice único parcial de la migración
  // 532, no un SELECT previo: dos traspasos casi simultáneos pasarían
  // los dos el SELECT. Acá solo se lee el 23505 como "ya existe".
  it('lee la violación de unicidad como "ya hay negocio" y no como error', async () => {
    const captured: Captured = {}
    const res = await createHandoffDeal(
      fakeDb(
        {
          pipelines: [VENTAS],
          stages: ETAPAS,
          insertError: { code: '23505', message: 'duplicate key value' },
        },
        captured,
      ),
      { ...BASE, request: request() },
    )

    expect(res).toEqual({ status: 'already_open' })
    // No es un error: no se ensucia el log con algo esperado.
    expect(console.error).not.toHaveBeenCalled()
  })
})

describe('createHandoffDeal — un fallo no cuesta el traspaso', () => {
  // ESCENARIO: Error al insertar el negocio.
  it('no lanza cuando el insert falla, y lo deja en el registro', async () => {
    const captured: Captured = {}
    const res = await createHandoffDeal(
      fakeDb(
        {
          pipelines: [VENTAS],
          stages: ETAPAS,
          insertError: { code: '23502', message: 'null value in column' },
        },
        captured,
      ),
      { ...BASE, request: request() },
    )

    expect(res.status).toBe('failed')
    expect(console.error).toHaveBeenCalled()
  })

  it('no lanza cuando no se pueden leer los embudos', async () => {
    const res = await createHandoffDeal(
      fakeDb({ pipelinesError: { message: 'boom' } }, {}),
      { ...BASE, request: request() },
    )
    expect(res.status).toBe('failed')
  })

  // Una cuenta sin embudos no es un error del traspaso: es una cuenta
  // sin configurar. No hay dónde poner la tarjeta y se sigue.
  it('se salta la creación cuando la cuenta no tiene embudos', async () => {
    const res = await createHandoffDeal(fakeDb({ pipelines: [] }, {}), {
      ...BASE,
      request: request(),
    })
    expect(res).toEqual({ status: 'skipped', reason: 'la cuenta no tiene embudos' })
  })

  it('se salta la creación cuando el embudo no tiene etapas', async () => {
    const res = await createHandoffDeal(
      fakeDb({ pipelines: [VENTAS], stages: [] }, {}),
      { ...BASE, request: request() },
    )
    expect(res).toEqual({ status: 'skipped', reason: 'el embudo no tiene etapas' })
  })

  it('no lanza ante un cliente que revienta', async () => {
    const roto = {
      from: () => {
        throw new Error('conexión caída')
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
    const res = await createHandoffDeal(roto, { ...BASE, request: request() })
    expect(res.status).toBe('failed')
  })
})
