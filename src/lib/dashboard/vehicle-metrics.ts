// ============================================================
// Agregación PURA de las métricas de compraventa.
//
// Sin Supabase y sin fechas implícitas: todo lo que depende del reloj
// entra por parámetro (`now`). Eso hace que los tramos de antigüedad y
// los promedios se puedan probar en los bordes exactos sin congelar el
// tiempo global.
//
// El I/O vive en ./vehicle-queries.ts.
// ============================================================

import type {
  AgeBucket,
  AgeBucketKey,
  InventoryAging,
  InventorySnapshot,
  MarginSummary,
  NamedCount,
  SalesPerformance,
  VehicleInterest,
  VehicleInterestRow,
} from './types'

const DAY_MS = 24 * 60 * 60 * 1000

export interface VehicleRow {
  id: string
  brand: string | null
  model: string | null
  year: number | null
  body_type: string | null
  price: number | null
  status: string
  created_at: string
  sold_price: number | null
  sold_at: string | null
}

export interface AcquisitionRow {
  vehicle_id: string
  purchase_cost: number
  purchase_date: string | null
}

/** Cuenta ocurrencias y devuelve el top N, mayor primero. */
function topCounts(values: (string | null)[], limit: number): NamedCount[] {
  const counts = new Map<string, number>()
  for (const raw of values) {
    const name = (raw ?? '').trim()
    if (!name) continue
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

export function buildInventorySnapshot(rows: VehicleRow[]): InventorySnapshot {
  const byStatus: Record<string, number> = {}
  for (const v of rows) byStatus[v.status] = (byStatus[v.status] ?? 0) + 1

  const available = rows.filter((v) => v.status === 'available')

  return {
    byStatus,
    availableValue: available.reduce((sum, v) => sum + (v.price ?? 0), 0),
    availableCount: available.length,
    byBrand: topCounts(rows.map((v) => v.brand), 8),
    byBodyType: topCounts(rows.map((v) => v.body_type), 8),
    total: rows.length,
  }
}

/**
 * Antigüedad del stock disponible.
 *
 * Cuenta desde la fecha de compra cuando se conoce, y desde el alta en el
 * sistema cuando no. A diferencia del margen, aquí NO se excluye a los
 * vehículos sin adquisición: omitir un auto del aging lo escondería, y un
 * auto parado es un auto parado sepamos o no cuánto costó.
 */
export function buildInventoryAging(
  rows: VehicleRow[],
  acquisitions: AcquisitionRow[],
  now: Date = new Date(),
): InventoryAging {
  const purchaseDates = new Map(
    acquisitions
      .filter((a) => a.purchase_date)
      .map((a) => [a.vehicle_id, a.purchase_date as string]),
  )

  const empty: Record<AgeBucketKey, { count: number; value: number }> = {
    '0-30': { count: 0, value: 0 },
    '31-60': { count: 0, value: 0 },
    '61-90': { count: 0, value: 0 },
    '90+': { count: 0, value: 0 },
  }

  const available = rows.filter((v) => v.status === 'available')

  for (const v of available) {
    const since = purchaseDates.get(v.id) ?? v.created_at
    const days = Math.floor((now.getTime() - new Date(since).getTime()) / DAY_MS)
    const key = bucketForDays(days)
    empty[key].count += 1
    empty[key].value += v.price ?? 0
  }

  const buckets: AgeBucket[] = (
    ['0-30', '31-60', '61-90', '90+'] as AgeBucketKey[]
  ).map((key) => ({ key, count: empty[key].count, value: empty[key].value }))

  return { buckets, total: available.length }
}

/** Bordes cerrados: 30 días cae en 0-30, 31 en 31-60, 91 en 90+. */
export function bucketForDays(days: number): AgeBucketKey {
  if (days <= 30) return '0-30'
  if (days <= 60) return '31-60'
  if (days <= 90) return '61-90'
  return '90+'
}

/** Vendidos dentro del rango [from, to]. */
export function soldInRange(rows: VehicleRow[], from: Date, to: Date): VehicleRow[] {
  return rows.filter((v) => {
    if (v.status !== 'sold' || !v.sold_at) return false
    const at = new Date(v.sold_at).getTime()
    return at >= from.getTime() && at <= to.getTime()
  })
}

export function buildSalesPerformance(
  sold: VehicleRow[],
  acquisitions: AcquisitionRow[],
): SalesPerformance {
  const revenue = sold.reduce((sum, v) => sum + (v.sold_price ?? 0), 0)

  const purchaseDates = new Map(
    acquisitions
      .filter((a) => a.purchase_date)
      .map((a) => [a.vehicle_id, a.purchase_date as string]),
  )

  // Sólo las unidades con fecha de compra conocida entran al promedio de
  // días en stock; el tamaño de la muestra se devuelve para que la UI
  // pueda decir sobre cuántas se calculó.
  const spans: number[] = []
  for (const v of sold) {
    const bought = purchaseDates.get(v.id)
    if (!bought || !v.sold_at) continue
    const days = Math.floor(
      (new Date(v.sold_at).getTime() - new Date(bought).getTime()) / DAY_MS,
    )
    if (days >= 0) spans.push(days)
  }

  return {
    unitsSold: sold.length,
    revenue,
    avgTicket: sold.length ? revenue / sold.length : null,
    avgDaysInStock: spans.length
      ? spans.reduce((a, b) => a + b, 0) / spans.length
      : null,
    daysSampleSize: spans.length,
  }
}

/**
 * Margen bruto (venta − compra) de las unidades vendidas.
 *
 * Las unidades sin costo registrado quedan FUERA del cálculo y se
 * reportan aparte en `unitsWithoutCost`. Tratarlas como costo 0 haría
 * que el tablero informara 100% de utilidad, que es peor que informar
 * "no se sabe".
 *
 * Si `acquisitions` llega vacío porque la RLS no dejó leer (rol agent o
 * viewer), el resultado es un margen de cero unidades — indistinguible,
 * a propósito, de "no hay costos cargados".
 */
export function buildMarginSummary(
  sold: VehicleRow[],
  acquisitions: AcquisitionRow[],
): MarginSummary {
  const costs = new Map(acquisitions.map((a) => [a.vehicle_id, a.purchase_cost]))

  let profit = 0
  let revenue = 0
  let unitsWithCost = 0
  let unitsWithoutCost = 0
  const perBrand = new Map<string, { units: number; profit: number; revenue: number }>()

  for (const v of sold) {
    const cost = costs.get(v.id)
    if (cost === undefined) {
      unitsWithoutCost += 1
      continue
    }
    const sale = v.sold_price ?? 0
    const gain = sale - cost

    profit += gain
    revenue += sale
    unitsWithCost += 1

    const brand = (v.brand ?? '').trim() || '—'
    const acc = perBrand.get(brand) ?? { units: 0, profit: 0, revenue: 0 }
    acc.units += 1
    acc.profit += gain
    acc.revenue += sale
    perBrand.set(brand, acc)
  }

  return {
    profit,
    revenue,
    marginPct: revenue > 0 ? (profit / revenue) * 100 : 0,
    unitsWithCost,
    unitsWithoutCost,
    byBrand: [...perBrand.entries()]
      .map(([brand, a]) => ({
        brand,
        units: a.units,
        profit: a.profit,
        marginPct: a.revenue > 0 ? (a.profit / a.revenue) * 100 : 0,
      }))
      .sort((a, b) => b.profit - a.profit),
  }
}

export interface InquiryRow {
  vehicle_id: string
}

export function buildVehicleInterest(
  inquiries: InquiryRow[],
  vehicles: VehicleRow[],
  limit = 8,
): VehicleInterest {
  const byVehicle = new Map<string, number>()
  for (const q of inquiries) {
    byVehicle.set(q.vehicle_id, (byVehicle.get(q.vehicle_id) ?? 0) + 1)
  }

  const index = new Map(vehicles.map((v) => [v.id, v]))

  const rows: VehicleInterestRow[] = [...byVehicle.entries()]
    .map(([vehicleId, count]) => {
      const v = index.get(vehicleId)
      return {
        vehicleId,
        label: v ? `${v.brand ?? ''} ${v.model ?? ''} ${v.year ?? ''}`.trim() : '—',
        inquiries: count,
        sold: v?.status === 'sold',
      }
    })
    .sort((a, b) => b.inquiries - a.inquiries)

  const total = inquiries.length
  const converted = rows
    .filter((r) => r.sold)
    .reduce((sum, r) => sum + r.inquiries, 0)

  return {
    rows: rows.slice(0, limit),
    totalInquiries: total,
    conversionPct: total > 0 ? (converted / total) * 100 : null,
  }
}
