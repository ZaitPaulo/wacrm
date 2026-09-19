import { describe, it, expect } from 'vitest'
import type { DealVehicle, VehicleStatus } from '@/types'
import {
  applyVehicleSelection,
  formatVehicleLabel,
  formatVehicleTitle,
  pickDefaultPipeline,
  rankVehicleOptions,
  type VehicleInquiryRef,
} from './deal-vehicle'

const MAZDA_PRICE = 37_000_000
const KIA_PRICE = 30_000_000
const EMPTY_QUERY = ''

/** Vehículo mínimo; el id se deriva de marca, modelo y año. */
function vehicle(
  brand: string,
  model: string,
  year: number,
  opts: { plate?: string | null; price?: number; status?: VehicleStatus } = {},
): DealVehicle {
  return {
    id: `${brand}-${model}-${year}`.toLowerCase().replace(/\s+/g, '-'),
    brand,
    model,
    year,
    license_plate: opts.plate ?? null,
    price: opts.price ?? 0,
    status: opts.status ?? 'available',
  }
}

function inquiry(v: DealVehicle, createdAt: string): VehicleInquiryRef {
  return { vehicle_id: v.id, created_at: createdAt }
}

const MAZDA_3_2012 = vehicle('Mazda', '3', 2012, { plate: 'ABC123', price: MAZDA_PRICE })
const MAZDA_2_2012 = vehicle('Mazda', '2', 2012, { status: 'reserved' })
const MAZDA_3_2015 = vehicle('Mazda', '3', 2015)
const KIA_PICANTO_2012 = vehicle('Kia', 'Picanto', 2012, { price: KIA_PRICE })
const CITROEN_C3_2018 = vehicle('Citroën', 'C3', 2018, { plate: 'XYZ789' })
const RENAULT_SOLD = vehicle('Renault', 'Logan', 2019, { status: 'sold' })
const CHEVROLET_HIDDEN = vehicle('Chevrolet', 'Spark', 2014, { status: 'hidden' })

// Desordenados a propósito: `others` debe salir por marca, modelo y año.
const INVENTORY = [
  MAZDA_3_2015,
  RENAULT_SOLD,
  KIA_PICANTO_2012,
  MAZDA_3_2012,
  CHEVROLET_HIDDEN,
  CITROEN_C3_2018,
  MAZDA_2_2012,
]

const T1 = '2026-09-10T10:00:00Z'
const T2 = '2026-09-12T10:00:00Z'
const T3 = '2026-09-15T10:00:00Z'

const ids = (list: DealVehicle[]) => list.map((v) => v.id)

describe('formatVehicleLabel', () => {
  it('devuelve "Marca Modelo Año" y la placa cuando la tiene', () => {
    expect(formatVehicleLabel(MAZDA_3_2012)).toBe('Mazda 3 2012 · ABC123')
  })

  it('omite la placa si es null o vacía', () => {
    expect(formatVehicleLabel(KIA_PICANTO_2012)).toBe('Kia Picanto 2012')
    expect(formatVehicleLabel({ ...KIA_PICANTO_2012, license_plate: '  ' })).toBe('Kia Picanto 2012')
  })

  it('acepta el embed del negocio, sin precio ni estado', () => {
    const embed = { id: 'x', brand: 'Kia', model: 'Picanto', year: 2012, license_plate: null }
    expect(formatVehicleLabel(embed)).toBe('Kia Picanto 2012')
  })
})

describe('formatVehicleTitle', () => {
  it('devuelve "Marca Modelo Año" sin placa y sin espacios sobrantes', () => {
    expect(formatVehicleTitle(MAZDA_3_2012)).toBe('Mazda 3 2012')
    expect(formatVehicleTitle({ brand: ' Kia ', model: 'Picanto ', year: 2012 })).toBe('Kia Picanto 2012')
  })
})

describe('rankVehicleOptions', () => {
  it('sin búsqueda ni consultas ofrece disponibles y reservados ordenados por marca, modelo y año', () => {
    const { suggested, others } = rankVehicleOptions(INVENTORY, [], EMPTY_QUERY)
    expect(suggested).toEqual([])
    expect(ids(others)).toEqual(ids([CITROEN_C3_2018, KIA_PICANTO_2012, MAZDA_2_2012, MAZDA_3_2012, MAZDA_3_2015]))
  })

  it('"mazda 2012" exige todos los términos', () => {
    const { others } = rankVehicleOptions(INVENTORY, [], 'mazda 2012')
    expect(ids(others)).toEqual(ids([MAZDA_2_2012, MAZDA_3_2012]))
  })

  it('no distingue mayúsculas ni tildes, y tolera espacios de más', () => {
    expect(ids(rankVehicleOptions(INVENTORY, [], '  CITROEN  ').others)).toEqual(ids([CITROEN_C3_2018]))
    expect(ids(rankVehicleOptions(INVENTORY, [], 'citroën c3').others)).toEqual(ids([CITROEN_C3_2018]))
  })

  it('busca también por placa', () => {
    expect(ids(rankVehicleOptions(INVENTORY, [], 'abc123').others)).toEqual(ids([MAZDA_3_2012]))
  })

  it('sin coincidencias devuelve listas vacías', () => {
    expect(rankVehicleOptions(INVENTORY, [], 'ferrari')).toEqual({ suggested: [], others: [] })
  })

  it('sugiere lo consultado del más reciente al más antiguo, sin repetir ni duplicar en others', () => {
    // Consultó un Kia Picanto y después un Mazda 3, y otra vez el Kia antes del Mazda.
    const inquiries = [
      inquiry(KIA_PICANTO_2012, T1),
      inquiry(MAZDA_3_2012, T3),
      inquiry(KIA_PICANTO_2012, T2),
    ]
    const { suggested, others } = rankVehicleOptions(INVENTORY, inquiries, EMPTY_QUERY)
    expect(ids(suggested)).toEqual(ids([MAZDA_3_2012, KIA_PICANTO_2012]))
    expect(ids(others)).toEqual(ids([CITROEN_C3_2018, MAZDA_2_2012, MAZDA_3_2015]))
  })

  it('los sugeridos también pasan por la búsqueda', () => {
    const inquiries = [inquiry(KIA_PICANTO_2012, T1), inquiry(MAZDA_3_2012, T2)]
    const { suggested, others } = rankVehicleOptions(INVENTORY, inquiries, 'mazda')
    expect(ids(suggested)).toEqual(ids([MAZDA_3_2012]))
    expect(ids(others)).toEqual(ids([MAZDA_2_2012, MAZDA_3_2015]))
  })

  it('no ofrece vendidos ni ocultos, ni siquiera entre los sugeridos', () => {
    const inquiries = [inquiry(RENAULT_SOLD, T3), inquiry(CHEVROLET_HIDDEN, T2), inquiry(KIA_PICANTO_2012, T1)]
    const { suggested, others } = rankVehicleOptions(INVENTORY, inquiries, EMPTY_QUERY)
    expect(ids(suggested)).toEqual(ids([KIA_PICANTO_2012]))
    expect(ids([...suggested, ...others])).not.toContain(RENAULT_SOLD.id)
    expect(ids([...suggested, ...others])).not.toContain(CHEVROLET_HIDDEN.id)
  })

  it('ignora consultas de vehículos que no están en la lista', () => {
    const ghost = vehicle('Ford', 'Fiesta', 2010)
    const { suggested } = rankVehicleOptions(INVENTORY, [inquiry(ghost, T1)], EMPTY_QUERY)
    expect(suggested).toEqual([])
  })

  it('al editar, el vehículo ya vinculado sigue ofreciéndose aunque esté vendido', () => {
    const { others } = rankVehicleOptions(INVENTORY, [], EMPTY_QUERY, { selectedId: RENAULT_SOLD.id })
    expect(ids(others)).toContain(RENAULT_SOLD.id)
    expect(ids(others)).not.toContain(CHEVROLET_HIDDEN.id)
  })

  it('el vinculado vendido que el contacto consultó sale entre los sugeridos', () => {
    const inquiries = [inquiry(RENAULT_SOLD, T2), inquiry(KIA_PICANTO_2012, T1)]
    const { suggested, others } = rankVehicleOptions(INVENTORY, inquiries, EMPTY_QUERY, {
      selectedId: RENAULT_SOLD.id,
    })
    expect(ids(suggested)).toEqual(ids([RENAULT_SOLD, KIA_PICANTO_2012]))
    expect(ids(others)).not.toContain(RENAULT_SOLD.id)
  })

  it('una búsqueda de solo espacios equivale a no buscar', () => {
    expect(rankVehicleOptions(INVENTORY, [], '   ')).toEqual(rankVehicleOptions(INVENTORY, [], EMPTY_QUERY))
  })

  it('no modifica los arreglos recibidos', () => {
    const vehicles = [...INVENTORY]
    const inquiries = [inquiry(KIA_PICANTO_2012, T1), inquiry(MAZDA_3_2012, T2)]
    const inquiriesCopy = [...inquiries]
    rankVehicleOptions(vehicles, inquiries, EMPTY_QUERY)
    expect(vehicles).toEqual(INVENTORY)
    expect(inquiries).toEqual(inquiriesCopy)
  })
})

describe('applyVehicleSelection', () => {
  const MAZDA_TITLE = 'Mazda 3 2012'
  const KIA_TITLE = 'Kia Picanto 2012'

  it('con el título vacío pone "Marca Modelo Año" (sin placa) y el precio', () => {
    expect(applyVehicleSelection({ title: '', autoTitle: null }, MAZDA_3_2012)).toEqual({
      title: MAZDA_TITLE,
      autoTitle: MAZDA_TITLE,
      value: MAZDA_PRICE,
    })
  })

  it('un título con solo espacios cuenta como vacío', () => {
    expect(applyVehicleSelection({ title: '   ', autoTitle: null }, MAZDA_3_2012).title).toBe(MAZDA_TITLE)
  })

  it('respeta un título escrito a mano pero llena el valor', () => {
    const manual = 'Retoma de Juan'
    expect(applyVehicleSelection({ title: manual, autoTitle: null }, MAZDA_3_2012)).toEqual({
      title: manual,
      autoTitle: null,
      value: MAZDA_PRICE,
    })
  })

  it('al cambiar de vehículo reemplaza el título autollenado y el valor', () => {
    const first = applyVehicleSelection({ title: '', autoTitle: null }, MAZDA_3_2012)
    const second = applyVehicleSelection(first, KIA_PICANTO_2012)
    expect(second).toEqual({ title: KIA_TITLE, autoTitle: KIA_TITLE, value: KIA_PRICE })
  })

  it('si el asesor editó el título autollenado, ya no lo reemplaza', () => {
    const first = applyVehicleSelection({ title: '', autoTitle: null }, MAZDA_3_2012)
    const edited = { ...first, title: `${MAZDA_TITLE} de Juan` }
    const second = applyVehicleSelection(edited, KIA_PICANTO_2012)
    expect(second.title).toBe(edited.title)
    expect(second.value).toBe(KIA_PRICE)
  })

  it('al reabrir un negocio cuyo título es el del vehículo vinculado, cambiar de vehículo lo reemplaza', () => {
    // El formulario siembra autoTitle con formatVehicleTitle(deal.vehicle).
    const reopened = { title: MAZDA_TITLE, autoTitle: formatVehicleTitle(MAZDA_3_2012) }
    expect(applyVehicleSelection(reopened, KIA_PICANTO_2012).title).toBe(KIA_TITLE)
  })

  it('al reabrir un negocio con título propio, cambiar de vehículo no lo toca', () => {
    const reopened = { title: 'Retoma de Juan', autoTitle: formatVehicleTitle(MAZDA_3_2012) }
    expect(applyVehicleSelection(reopened, KIA_PICANTO_2012).title).toBe('Retoma de Juan')
  })

  it('convierte a número un precio que llegue como texto (NUMERIC)', () => {
    const asText = { ...MAZDA_3_2012, price: String(MAZDA_PRICE) as unknown as number }
    expect(applyVehicleSelection({ title: '', autoTitle: null }, asText).value).toBe(MAZDA_PRICE)
  })
})

describe('pickDefaultPipeline', () => {
  const pipeline = (id: string, name: string, createdAt: string) => ({ id, name, created_at: createdAt })
  const SALES_PIPELINE = pipeline('p-sales-en', 'Sales Pipeline', T1)
  const VENTAS = pipeline('p-ventas', '  VENTAS ', T3)
  const POSTVENTA = pipeline('p-postventa', 'Postventa', T2)

  it('propone "Ventas" sin distinguir mayúsculas ni espacios, aunque no sea el más antiguo', () => {
    expect(pickDefaultPipeline([SALES_PIPELINE, POSTVENTA, VENTAS])).toBe(VENTAS)
  })

  it('sin "Ventas" propone el más antiguo por fecha de creación', () => {
    expect(pickDefaultPipeline([POSTVENTA, SALES_PIPELINE])).toBe(SALES_PIPELINE)
  })

  it('con varios "Ventas" elige el más antiguo de ellos', () => {
    const olderVentas = pipeline('p-ventas-old', 'ventas', T1)
    expect(pickDefaultPipeline([VENTAS, olderVentas])).toBe(olderVentas)
  })

  it('no confunde "Ventas" con nombres que solo lo contienen', () => {
    const ventas2 = pipeline('p-ventas-2', 'Ventas 2', T1)
    expect(pickDefaultPipeline([ventas2, POSTVENTA])).toBe(ventas2)
    expect(pickDefaultPipeline([ventas2, VENTAS])).toBe(VENTAS)
  })

  it('sin embudos devuelve null', () => {
    expect(pickDefaultPipeline([])).toBeNull()
  })
})
