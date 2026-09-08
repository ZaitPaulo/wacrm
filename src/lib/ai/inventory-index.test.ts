import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  buildInventoryIndex,
  clearInventoryIndexCache,
  INVENTORY_INDEX_LIMIT,
} from './inventory-index'

interface Row {
  public_ref: string | null
  brand: string
  model: string
  year: number
  price: number
  mileage: number | null
  transmission: string | null
  body_type: string | null
}

function vehiculo(overrides: Partial<Row> = {}): Row {
  return {
    public_ref: 'ABC123',
    brand: 'RENAULT',
    model: 'SANDERO GT',
    year: 2010,
    price: 22_000_000,
    mileage: 179_200,
    transmission: 'manual',
    body_type: 'hatchback',
    ...overrides,
  }
}

/** Cuenta las consultas para poder verificar el caché. */
let consultas = 0

function db(rows: Row[], error: unknown = null) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => {
      consultas++
      return Promise.resolve({ data: error ? null : rows, error })
    },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: () => chain } as any
}

beforeEach(() => {
  consultas = 0
  clearInventoryIndexCache()
})
afterEach(() => vi.useRealTimers())

describe('buildInventoryIndex — formato', () => {
  it('arma una línea por vehículo con lo que se filtra', async () => {
    const idx = await buildInventoryIndex(db([vehiculo()]), 'acct-1')
    expect(idx?.text).toBe(
      'ABC123 · RENAULT SANDERO GT 2010 · $22M · 179k kms · mecánica · hatchback',
    )
    expect(idx?.total).toBe(1)
    expect(idx?.truncated).toBe(false)
  })

  it('traduce transmisión y carrocería como las dice el cliente', async () => {
    const idx = await buildInventoryIndex(
      db([vehiculo({ transmission: 'automatic', body_type: 'suv' })]),
      'acct-1',
    )
    expect(idx?.text).toContain('automática')
    // "camioneta" es la palabra que usa la gente, y ya está en el sync.
    expect(idx?.text).toContain('camioneta')
  })

  it('escribe los precios con decimal solo cuando hace falta', async () => {
    const idx = await buildInventoryIndex(
      db([
        vehiculo({ price: 22_000_000, public_ref: 'A' }),
        vehiculo({ price: 59_900_000, public_ref: 'B' }),
      ]),
      'acct-1',
    )
    expect(idx?.text).toContain('$22M')
    expect(idx?.text).toContain('$59.9M')
  })

  // Un campo vacío no puede dejar un hueco raro como "· ·" ni un "null".
  it('omite los campos que faltan sin romper la línea', async () => {
    const idx = await buildInventoryIndex(
      db([vehiculo({ mileage: null, transmission: null, body_type: null, public_ref: null })]),
      'acct-1',
    )
    expect(idx?.text).toBe('RENAULT SANDERO GT 2010 · $22M')
    expect(idx?.text).not.toContain('null')
    expect(idx?.text).not.toContain('· ·')
  })

  it('devuelve null cuando la cuenta no tiene inventario disponible', async () => {
    expect(await buildInventoryIndex(db([]), 'acct-1')).toBeNull()
  })

  // Un fallo de lectura no puede tumbar la respuesta al cliente: se
  // responde sin índice, como antes de este cambio.
  it('devuelve null cuando la consulta falla', async () => {
    expect(await buildInventoryIndex(db([], { message: 'boom' }), 'acct-1')).toBeNull()
  })
})

describe('buildInventoryIndex — recorte', () => {
  it('marca como incompleto lo que pasa del tope', async () => {
    const muchos = Array.from({ length: INVENTORY_INDEX_LIMIT + 10 }, (_, i) =>
      vehiculo({ public_ref: `R${i}` }),
    )
    const idx = await buildInventoryIndex(db(muchos), 'acct-1')
    expect(idx?.truncated).toBe(true)
    expect(idx?.total).toBe(INVENTORY_INDEX_LIMIT + 10)
    expect(idx?.text.split('\n')).toHaveLength(INVENTORY_INDEX_LIMIT)
  })

  it('no marca nada cuando cabe entero', async () => {
    const idx = await buildInventoryIndex(db([vehiculo(), vehiculo()]), 'acct-1')
    expect(idx?.truncated).toBe(false)
  })
})

describe('buildInventoryIndex — caché', () => {
  it('no vuelve a consultar dentro del intervalo', async () => {
    await buildInventoryIndex(db([vehiculo()]), 'acct-1')
    await buildInventoryIndex(db([vehiculo()]), 'acct-1')
    expect(consultas).toBe(1)
  })

  // Una cuenta jamás puede ver el inventario de otra.
  it('no comparte índice entre cuentas', async () => {
    const a = await buildInventoryIndex(db([vehiculo({ brand: 'KIA' })]), 'acct-1')
    const b = await buildInventoryIndex(db([vehiculo({ brand: 'MAZDA' })]), 'acct-2')
    expect(a?.text).toContain('KIA')
    expect(b?.text).toContain('MAZDA')
    expect(consultas).toBe(2)
  })

  it('vuelve a consultar pasado el intervalo', async () => {
    vi.useFakeTimers()
    await buildInventoryIndex(db([vehiculo()]), 'acct-1')
    vi.advanceTimersByTime(61_000)
    await buildInventoryIndex(db([vehiculo()]), 'acct-1')
    expect(consultas).toBe(2)
  })
})
