import type { DealVehicle, VehicleStatus } from '@/types'

/** Lo mínimo para nombrar un vehículo; sirve también para el embed de `Deal.vehicle`. */
export type VehicleLabelInput = Pick<DealVehicle, 'brand' | 'model' | 'year' | 'license_plate'>

/** Consulta de la vitrina (`vehicle_inquiries`) del contacto del negocio. */
export interface VehicleInquiryRef {
  vehicle_id: string
  created_at: string
}

/** Resultado de {@link rankVehicleOptions}: sugeridos arriba y el resto debajo. */
export interface RankedVehicleOptions<T extends DealVehicle> {
  suggested: T[]
  others: T[]
}

/** Estado del título en el formulario, con la memoria del último autollenado. */
export interface VehicleSelectionState {
  title: string
  /** Título que puso el último vehículo elegido, o null si nunca se autollenó. */
  autoTitle: string | null
}

/** Estados que el selector ofrece. Vendidos y ocultos solo salen si ya están vinculados. */
const OFFERABLE_STATUSES: readonly VehicleStatus[] = ['available', 'reserved']

/** "Marca Modelo Año", sin placa: es el título que se autollena. */
function baseLabel(v: Pick<DealVehicle, 'brand' | 'model' | 'year'>): string {
  return `${v.brand.trim()} ${v.model.trim()} ${v.year}`
}

/**
 * Título que el autollenado pone en el negocio: "Marca Modelo Año", sin placa.
 * Al reabrir un negocio con vehículo, el formulario lo usa como `autoTitle`
 * inicial: si el título sigue siendo este, cambiar de vehículo lo reemplaza.
 */
export function formatVehicleTitle(v: Pick<DealVehicle, 'brand' | 'model' | 'year'>): string {
  return baseLabel(v)
}

/**
 * Nombre visible del vehículo: "Marca Modelo Año", y " · PLACA" si tiene placa.
 * Lo usan el selector, la tarjeta de la bandeja, el formulario y las tarjetas
 * del tablero.
 */
export function formatVehicleLabel(v: VehicleLabelInput): string {
  const plate = v.license_plate?.trim()
  return plate ? `${baseLabel(v)} · ${plate}` : baseLabel(v)
}

/** Minúsculas y sin tildes, para comparar "Méndez" con "mendez". */
function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Todos los términos de la búsqueda (AND) aparecen en "marca modelo año placa". */
function matchesQuery(v: DealVehicle, terms: string[]): boolean {
  if (terms.length === 0) return true
  const haystack = normalize(`${v.brand} ${v.model} ${v.year} ${v.license_plate ?? ''}`)
  return terms.every((term) => haystack.includes(term))
}

/** Orden alfabético por marca y modelo (sin distinguir mayúsculas ni tildes), luego año. */
function compareVehicles(a: DealVehicle, b: DealVehicle): number {
  const opts: Intl.CollatorOptions = { sensitivity: 'base', numeric: true }
  return (
    a.brand.localeCompare(b.brand, 'es', opts) ||
    a.model.localeCompare(b.model, 'es', opts) ||
    a.year - b.year
  )
}

/**
 * Opciones del selector de vehículo del negocio.
 *
 * - Solo se ofrecen vehículos `available` y `reserved`; el `selectedId` (el
 *   vehículo ya vinculado al negocio que se edita) se incluye siempre, aunque
 *   esté vendido u oculto.
 * - La búsqueda parte `query` en términos y exige todos (AND) sobre
 *   "marca modelo año placa", sin distinguir mayúsculas ni tildes. Una
 *   búsqueda vacía deja pasar todo.
 * - `suggested`: los vehículos que el contacto consultó desde la vitrina, del
 *   más reciente al más antiguo (`created_at` desc), sin repetir, y solo los
 *   que pasan los filtros anteriores.
 * - `others`: el resto, ordenado por marca, modelo y año.
 *
 * No modifica los arreglos recibidos.
 */
export function rankVehicleOptions<T extends DealVehicle>(
  vehicles: T[],
  inquiries: VehicleInquiryRef[],
  query: string,
  opts?: { selectedId?: string | null },
): RankedVehicleOptions<T> {
  const selectedId = opts?.selectedId ?? null
  const terms = normalize(query).split(/\s+/).filter(Boolean)

  const visible = vehicles.filter(
    (v) =>
      (OFFERABLE_STATUSES.includes(v.status) || v.id === selectedId) && matchesQuery(v, terms),
  )
  const byId = new Map(visible.map((v) => [v.id, v]))

  const suggested: T[] = []
  const suggestedIds = new Set<string>()
  const newestFirst = [...inquiries].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  )
  for (const inquiry of newestFirst) {
    const vehicle = byId.get(inquiry.vehicle_id)
    if (!vehicle || suggestedIds.has(vehicle.id)) continue
    suggestedIds.add(vehicle.id)
    suggested.push(vehicle)
  }

  const others = visible.filter((v) => !suggestedIds.has(v.id)).sort(compareVehicles)
  return { suggested, others }
}

/**
 * Autollenado al elegir un vehículo en el formulario.
 *
 * - `value` pasa siempre a ser el precio del vehículo (una foto: si el precio
 *   cambia después, el negocio no se recalcula).
 * - El título pasa a "Marca Modelo Año" solo si está vacío o si sigue siendo el
 *   que autollenó el vehículo anterior (`autoTitle`); un título escrito a mano
 *   se respeta. En ese caso `autoTitle` no cambia.
 *
 * Quitar el vehículo no pasa por aquí: no toca ni título ni valor.
 */
export function applyVehicleSelection(
  state: VehicleSelectionState,
  vehicle: Pick<DealVehicle, 'brand' | 'model' | 'year' | 'price'>,
): VehicleSelectionState & { value: number } {
  const value = Number(vehicle.price)
  const replaceTitle = state.title.trim() === '' || state.title === state.autoTitle
  if (!replaceTitle) return { title: state.title, autoTitle: state.autoTitle, value }

  const label = baseLabel(vehicle)
  return { title: label, autoTitle: label, value }
}

/**
 * Embudo propuesto al crear un negocio desde la bandeja: el llamado "Ventas"
 * (sin distinguir mayúsculas ni espacios alrededor) o, si no hay, el más
 * antiguo por `created_at`. Si hubiera varios "Ventas", el más antiguo de
 * ellos. Devuelve null si no hay embudos.
 */
export function pickDefaultPipeline<T extends { id: string; name: string; created_at: string }>(
  pipelines: T[],
): T | null {
  const oldest = (list: T[]): T | null =>
    list.reduce<T | null>(
      (best, p) => (best === null || Date.parse(p.created_at) < Date.parse(best.created_at) ? p : best),
      null,
    )

  const ventas = pipelines.filter((p) => p.name.trim().toLowerCase() === 'ventas')
  return oldest(ventas) ?? oldest(pipelines)
}
