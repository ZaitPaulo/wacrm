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

// ------------------------------------------------------------
// Rendimiento por asesor
//
// Es la única métrica del dashboard que NO se agrega en el cliente: la
// calcula la RPC `agent_performance_metrics()` (migración 532). El
// porqué está en `queries.ts`, junto a la función que la carga.
// ------------------------------------------------------------

/**
 * Rol con el que un miembro está en la cuenta (`account_role_enum` en la
 * base). Se declara acá y no se importa de `@/types` para que el tipo de
 * la fila no arrastre dependencias del modelo entero.
 */
export type AccountRole = 'owner' | 'admin' | 'agent' | 'viewer'

/** Una etapa del embudo con cuántos negocios abiertos tiene el asesor. */
export interface AgentStageBreakdown {
  stageId: string
  stageName: string
  /** Color de la etapa tal como lo guarda `pipeline_stages`. */
  color: string
  pipelineId: string
  /** Posición dentro del embudo; las etapas ya vienen ordenadas por ella. */
  position: number
  deals: number
}

/**
 * Una fila de la tabla de rendimiento.
 *
 * Hay fila para todo miembro con rol `agent` —aunque esté en cero— y
 * para cualquier otro miembro CON CARTERA: en producción, la
 * administradora que lleva la campaña de propietarios con 70
 * conversaciones. Quien no atiende no aparece. Más una última fila
 * "Sin asignar" con lo que no tiene detrás a ningún miembro vigente.
 *
 * OJO, son dos preguntas distintas: quién sale en una fila (quien
 * atiende) no es quién puede VER la tabla (solo `owner` y `admin`).
 */
export interface AgentPerformanceRow {
  /** `auth.users.id` del asesor. Null en la fila "Sin asignar". */
  agentUserId: string | null
  /** `profiles.id` del asesor — NO es el mismo id que `agentUserId`. */
  agentProfileId: string | null
  /** Null en la fila "Sin asignar"; la interfaz pone ahí su etiqueta. */
  fullName: string | null
  /**
   * Con qué rol está esta persona en la cuenta. Null en la fila "Sin
   * asignar", que no es una persona.
   *
   * Hace falta porque la tabla ya no lista solo asesores: un miembro con
   * otro rol sale si tiene cartera, y una fila que aparece sin decir por
   * qué está ahí es una interfaz que miente por omisión.
   */
  accountRole: AccountRole | null
  /**
   * La fila del trabajo sin dueño: lo que no tiene a nadie asignado y lo
   * que quedó a nombre de alguien que ya no es miembro de la cuenta, sin
   * importar el rol que tuviera. Va siempre al final de la lista.
   *
   * Cada conversación abierta cae en exactamente una fila, así que la
   * suma de `openConversations` cuadra con el total de la cuenta.
   */
  isUnassigned: boolean
  /** Conversaciones abiertas que tiene asignadas ahora. Sin ventana de tiempo. */
  openConversations: number
  /**
   * De esas conversaciones abiertas, cuántas NO tienen ningún negocio
   * abierto: clientes conversando que nunca entraron al embudo.
   *
   * Permite leer "10 de 13 · 3 sin negocio" en vez de poner 13 clientes
   * al lado de un desglose de etapas que suma 10 sin explicar que son
   * cosas distintas.
   *
   * NO se calcula restando `openConversations - openDeals`: los dos
   * conteos se agrupan por claves distintas —`assigned_agent_id` uno y
   * `deals.assigned_to` el otro—, así que un negocio asignado a alguien
   * cuya conversación es de otro haría que la resta mintiera. Siempre
   * `<= openConversations`.
   */
  openConversationsWithoutDeal: number
  openDeals: number
  /**
   * Null cuando no tiene ningún negocio abierto: es "sin datos", no
   * "todas las etapas en cero". Solo vienen las etapas con al menos uno.
   */
  dealsByStage: AgentStageBreakdown[] | null
  /**
   * Promedio de segundos hasta la primera respuesta del asesor. Null
   * cuando no hay ninguna muestra —y en la fila "Sin asignar", donde no
   * hay a quién medir—. Nunca 0 por ausencia de datos.
   */
  avgFirstResponseSeconds: number | null
  /** Cuántos entrantes entraron en el promedio. */
  responseSamples: number
}
