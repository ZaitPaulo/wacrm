// Shared result shapes the dashboard components consume. Centralised
// here so each component stays thin and the page-level loader wires
// them up without type gymnastics.

export interface MetricDelta {
  current: number
  previous: number
}

export interface MetricsBundle {
  activeConversations: MetricDelta
  newContactsToday: MetricDelta
  openDealsValue: number
  openDealsCount: number
  messagesSentToday: MetricDelta
}

export interface ConversationsSeriesPoint {
  day: string // YYYY-MM-DD local
  incoming: number
  outgoing: number
}

export interface PipelineStageSlice {
  id: string
  name: string
  color: string
  dealCount: number
  totalValue: number
}

export interface PipelineDonutData {
  stages: PipelineStageSlice[]
  totalValue: number
}

export interface ResponseTimeBucket {
  /** 0 = Mon … 6 = Sun (Monday-first). */
  dow: number
  /** Average first-response time in minutes. Null means no samples. */
  avgMinutes: number | null
  samples: number
}

export interface ResponseTimeSummary {
  buckets: ResponseTimeBucket[]
  thisWeekAvg: number | null
  lastWeekAvg: number | null
}

// ============================================================
// Compraventa de vehículos — migración 508.
// ============================================================

export interface NamedCount {
  name: string
  count: number
}

export interface InventorySnapshot {
  /** Conteo por estado: available / reserved / sold / hidden. */
  byStatus: Record<string, number>
  /** Suma de precios de lista del stock disponible: capital inmovilizado. */
  availableValue: number
  availableCount: number
  byBrand: NamedCount[]
  byBodyType: NamedCount[]
  /** Total de vehículos de la cuenta, para distinguir "vacío" de "sin datos". */
  total: number
}

/** Tramos de antigüedad del stock. El último es la señal de alerta. */
export type AgeBucketKey = '0-30' | '31-60' | '61-90' | '90+'

export interface AgeBucket {
  key: AgeBucketKey
  count: number
  /** Valor inmovilizado en ese tramo — lo que duele del stock parado. */
  value: number
}

export interface InventoryAging {
  buckets: AgeBucket[]
  /** Vehículos disponibles considerados (excluye vendidos). */
  total: number
}

export interface SalesPerformance {
  unitsSold: number
  revenue: number
  /** Null cuando no hubo ventas: evita promedios sobre cero unidades. */
  avgTicket: number | null
  /** Días de adquisición a venta. Null si ninguna unidad tenía fecha de compra. */
  avgDaysInStock: number | null
  /** Sobre cuántas de las vendidas se pudo calcular `avgDaysInStock`. */
  daysSampleSize: number
}

export interface BrandMargin {
  brand: string
  units: number
  profit: number
  /** Margen porcentual sobre ingresos, 0-100. */
  marginPct: number
}

/**
 * Resumen de margen. Sólo llega con datos si la RLS de
 * `vehicle_acquisitions` dejó leer los costos (admin+).
 */
export interface MarginSummary {
  profit: number
  revenue: number
  marginPct: number
  /** Unidades vendidas CON costo registrado: la base del cálculo. */
  unitsWithCost: number
  /**
   * Unidades vendidas SIN costo registrado. Se muestran aparte en vez de
   * asumir costo 0, que reportaría 100% de utilidad.
   */
  unitsWithoutCost: number
  byBrand: BrandMargin[]
}

export interface VehicleInterestRow {
  vehicleId: string
  label: string
  inquiries: number
  /** Si el vehículo terminó vendido — cierra el ciclo consulta → venta. */
  sold: boolean
}

export interface VehicleInterest {
  rows: VehicleInterestRow[]
  totalInquiries: number
  /** Proporción 0-100 de consultas sobre vehículos que se vendieron. */
  conversionPct: number | null
}

export type ActivityKind =
  | 'message'
  | 'deal'
  | 'broadcast'
  | 'automation'
  | 'contact'

export interface ActivityItem {
  id: string
  kind: ActivityKind
  /** Primary line of text rendered in the feed. Pre-formatted. */
  text: string
  /** ISO timestamp the item happened at, drives relative-time + sort. */
  at: string
  /** Optional deep-link for the whole row (not all items have a target). */
  href?: string
}
