// ============================================================
// Hoja de vida del contacto — tipos y reglas puras.
//
// La línea de tiempo la arma `get_contact_timeline` (migración 555) y
// devuelve datos, no frases: este módulo traduce cada evento a una
// clave de next-intl con sus valores, y define los filtros y el cursor.
// Sin I/O, para poder probarlo sin base.
// ============================================================

export const TIMELINE_KINDS = [
  'first_contact',
  'conversation',
  'assignment',
  'appointment',
  'appointment_event',
  'deal_created',
  'deal_stage',
  'deal_closed',
  'inquiry',
  'sale',
  'consignment',
  'acquisition',
  'document',
  'note',
  'interaction',
] as const

export type TimelineKind = (typeof TIMELINE_KINDS)[number]

export function isTimelineKind(value: unknown): value is TimelineKind {
  return typeof value === 'string' && (TIMELINE_KINDS as readonly string[]).includes(value)
}

/** Una fila de `get_contact_timeline`. */
export interface TimelineEvent {
  occurred_at: string
  kind: TimelineKind
  source_id: string
  sort_key: string
  actor_user_id: string | null
  actor_name: string | null
  data: Record<string, unknown>
  link: Record<string, unknown> | null
}

/**
 * Filtros de la hoja de vida. Cada uno agrupa varios `kind`: el usuario
 * piensa en "citas y llamadas", no en "cita", "evento de cita" e
 * "interacción". Son pocos a propósito: con siete, el asesor no los usaba.
 */
export const TIMELINE_FILTERS = {
  conversations: ['first_contact', 'conversation', 'assignment'],
  appointments: ['appointment', 'appointment_event', 'interaction'],
  business: ['deal_created', 'deal_stage', 'deal_closed', 'inquiry', 'sale', 'consignment', 'acquisition'],
  notes: ['note', 'document'],
} as const satisfies Record<string, readonly TimelineKind[]>

export type TimelineFilter = keyof typeof TIMELINE_FILTERS

export const TIMELINE_FILTER_KEYS = Object.keys(TIMELINE_FILTERS) as TimelineFilter[]

/** Los `kind` de los filtros elegidos; `null` = todos (sin filtro). */
export function kindsForFilters(filters: readonly TimelineFilter[]): TimelineKind[] | null {
  if (filters.length === 0) return null
  const out = new Set<TimelineKind>()
  for (const f of filters) for (const k of TIMELINE_FILTERS[f]) out.add(k)
  return [...out]
}

export const TIMELINE_PAGE_SIZE = 30
const MAX_LIMIT = 200

export interface TimelineQuery {
  kinds: TimelineKind[] | null
  before: string | null
  beforeKey: string | null
  limit: number
}

/**
 * Lee los parámetros de `GET /api/contacts/[id]/timeline`. Los `kind`
 * desconocidos se descartan; un cursor a medias (fecha sin clave o al
 * revés) se ignora entero para no saltar eventos.
 */
export function parseTimelineQuery(params: URLSearchParams): TimelineQuery {
  const rawKinds = (params.get('kinds') ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(isTimelineKind)
  const kinds = rawKinds.length > 0 ? [...new Set(rawKinds)] : null

  const before = params.get('before')
  const beforeKey = params.get('before_key')
  const validCursor = !!before && !!beforeKey && !Number.isNaN(Date.parse(before))

  const rawLimit = Number.parseInt(params.get('limit') ?? '', 10)
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : TIMELINE_PAGE_SIZE

  return {
    kinds,
    before: validCursor ? before : null,
    beforeKey: validCursor ? beforeKey : null,
    limit,
  }
}

/** Parámetros de búsqueda de la página siguiente, o `null` si no hay más. */
export function nextPageParams(
  events: readonly TimelineEvent[],
  pageSize: number,
): { before: string; before_key: string } | null {
  if (events.length < pageSize) return null
  const last = events[events.length - 1]
  return { before: last.occurred_at, before_key: last.sort_key }
}

/** Un día de la hoja de vida con sus eventos, en el orden recibido. */
export interface TimelineDay {
  /** `yyyy-MM-dd` en la hora local de quien mira. */
  day: string
  events: TimelineEvent[]
}

function localDayKey(iso: string): string {
  const d = new Date(iso)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/**
 * Agrupa por día los eventos que ya vienen ordenados del más reciente al
 * más antiguo. Al "Cargar más", el primer día de la página nueva puede ser
 * el mismo que el último de la anterior: se une, no se repite el título.
 */
export function groupTimelineByDay(events: readonly TimelineEvent[]): TimelineDay[] {
  const days: TimelineDay[] = []
  for (const e of events) {
    const day = localDayKey(e.occurred_at)
    const last = days[days.length - 1]
    if (last && last.day === day) last.events.push(e)
    else days.push({ day, events: [e] })
  }
  return days
}

// ------------------------------------------------------------
// Texto de cada evento
// ------------------------------------------------------------

export interface VehicleRef {
  id?: string
  brand?: string
  model?: string
  year?: number
  license_plate?: string | null
}

export function vehicleLabel(v: unknown): string {
  const ref = (v ?? {}) as VehicleRef
  return [ref.brand, ref.model, ref.year].filter((p) => p !== undefined && p !== null && p !== '').join(' ')
}

/**
 * Clave de next-intl (bajo `Contacts.timeline.events`) y valores para el
 * título de un evento. Los valores son texto plano: el componente pone
 * los formatos de fecha y moneda que dependen de la cuenta.
 */
export interface EventText {
  key: string
  values: Record<string, string | number>
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v)
}

export function eventText(e: TimelineEvent): EventText {
  const d = e.data
  switch (e.kind) {
    case 'first_contact': {
      const ad = d.ad as { headline?: string } | null | undefined
      return ad?.headline
        ? { key: 'firstContactAd', values: { channel: str(d.channel), ad: ad.headline } }
        : { key: 'firstContact', values: { channel: str(d.channel) } }
    }
    case 'conversation':
      return {
        key: 'conversation',
        values: { channel: str(d.channel), count: Number(d.message_count ?? 0) },
      }
    case 'assignment':
      if (!d.to_agent_id) return { key: 'assignmentToBot', values: { from: str(d.from_agent_name) } }
      if (!d.from_agent_id) return { key: 'assignmentFromBot', values: { to: str(d.to_agent_name) } }
      return {
        key: 'assignmentTransfer',
        values: { from: str(d.from_agent_name), to: str(d.to_agent_name) },
      }
    case 'appointment':
      return { key: 'appointment', values: { purpose: str(d.purpose), status: str(d.status) } }
    case 'appointment_event':
      switch (d.event) {
        case 'created':
          return { key: 'appointmentCreated', values: { purpose: str(d.purpose) } }
        case 'rescheduled':
          return { key: 'appointmentRescheduled', values: { purpose: str(d.purpose) } }
        case 'reassigned':
          return {
            key: 'appointmentReassigned',
            values: { from: str(d.from_name), to: str(d.to_name) },
          }
        case 'status_changed':
          return { key: 'appointmentStatus', values: { status: str(d.to) } }
        case 'customer_confirmed':
          return { key: 'appointmentCustomerConfirmed', values: {} }
        default:
          return { key: 'appointmentCustomerChange', values: {} }
      }
    case 'deal_created':
      return { key: 'dealCreated', values: { title: str(d.title), stage: str(d.stage_name) } }
    case 'deal_stage':
      return {
        key: 'dealStage',
        values: { title: str(d.title), from: str(d.from_stage_name), to: str(d.to_stage_name) },
      }
    case 'deal_closed':
      return {
        key: d.to_status === 'won' ? 'dealWon' : 'dealLost',
        values: { title: str(d.title) },
      }
    case 'inquiry':
      return { key: 'inquiry', values: { vehicle: vehicleLabel(d.vehicle) } }
    case 'sale':
      return { key: 'sale', values: { vehicle: vehicleLabel(d.vehicle) } }
    case 'consignment':
      return { key: 'consignment', values: { vehicle: vehicleLabel(d.vehicle) } }
    case 'acquisition':
      return {
        key: d.acquisition_kind === 'trade_in' ? 'acquisitionTradeIn' : 'acquisitionPurchase',
        values: { vehicle: vehicleLabel(d.vehicle) },
      }
    case 'document':
      return { key: 'document', values: { name: str(d.file_name) } }
    case 'note':
      return { key: 'note', values: {} }
    case 'interaction':
      return { key: 'interaction', values: { kind: str(d.interaction_kind) } }
  }
}

/** Duración legible de una interacción en minutos (redondeo hacia arriba). */
export function durationMinutes(seconds: unknown): number | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return null
  return Math.ceil(seconds / 60)
}
