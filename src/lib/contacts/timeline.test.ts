import { describe, it, expect } from 'vitest'
import {
  eventText,
  kindsForFilters,
  nextPageParams,
  parseTimelineQuery,
  vehicleLabel,
  durationMinutes,
  groupTimelineByDay,
  TIMELINE_FILTERS,
  TIMELINE_KINDS,
  type TimelineEvent,
} from './timeline'

const ev = (kind: TimelineEvent['kind'], data: Record<string, unknown> = {}): TimelineEvent => ({
  occurred_at: '2026-10-10T10:00:00.000Z',
  kind,
  source_id: 'id-1',
  sort_key: `${kind}:id-1`,
  actor_user_id: null,
  actor_name: null,
  data,
  link: null,
})

describe('kindsForFilters', () => {
  it('sin filtros no restringe', () => {
    expect(kindsForFilters([])).toBeNull()
  })

  it('el filtro de citas trae la cita, sus eventos y las llamadas', () => {
    expect(kindsForFilters(['appointments'])).toEqual(['appointment', 'appointment_event', 'interaction'])
  })

  it('junta varios filtros sin repetir', () => {
    expect(kindsForFilters(['notes', 'conversations', 'notes'])).toEqual([
      'note',
      'document',
      'first_contact',
      'conversation',
      'assignment',
    ])
  })

  it('cada kind está en exactamente un filtro', () => {
    const all = Object.values(TIMELINE_FILTERS).flat()
    expect([...all].sort()).toEqual([...TIMELINE_KINDS].sort())
  })
})

describe('parseTimelineQuery', () => {
  it('descarta kinds desconocidos y repetidos', () => {
    const q = parseTimelineQuery(new URLSearchParams('kinds=note,hack,note,sale'))
    expect(q.kinds).toEqual(['note', 'sale'])
  })

  it('sin kinds válidos no filtra', () => {
    expect(parseTimelineQuery(new URLSearchParams('kinds=hack')).kinds).toBeNull()
  })

  it('acepta el cursor completo', () => {
    const q = parseTimelineQuery(
      new URLSearchParams('before=2026-10-03T08:00:00Z&before_key=note:abc'),
    )
    expect(q.before).toBe('2026-10-03T08:00:00Z')
    expect(q.beforeKey).toBe('note:abc')
  })

  it('ignora un cursor a medias para no saltar eventos', () => {
    const q = parseTimelineQuery(new URLSearchParams('before=2026-10-03T08:00:00Z'))
    expect(q.before).toBeNull()
    expect(q.beforeKey).toBeNull()
  })

  it('ignora una fecha inválida', () => {
    const q = parseTimelineQuery(new URLSearchParams('before=ayer&before_key=note:abc'))
    expect(q.before).toBeNull()
  })

  it('acota el límite', () => {
    expect(parseTimelineQuery(new URLSearchParams('limit=5000')).limit).toBe(200)
    expect(parseTimelineQuery(new URLSearchParams('limit=-1')).limit).toBe(30)
  })
})

describe('nextPageParams', () => {
  it('sin página llena no hay más', () => {
    expect(nextPageParams([ev('note')], 2)).toBeNull()
  })

  it('con página llena el cursor es la última fila', () => {
    const last = { ...ev('sale'), occurred_at: '2026-01-01T00:00:00.000Z', sort_key: 'sale:x' }
    expect(nextPageParams([ev('note'), last], 2)).toEqual({
      before: '2026-01-01T00:00:00.000Z',
      before_key: 'sale:x',
    })
  })
})

describe('eventText', () => {
  it('primer contacto por anuncio', () => {
    expect(eventText(ev('first_contact', { channel: 'whatsapp', ad: { headline: 'Carros' } }))).toEqual({
      key: 'firstContactAd',
      values: { channel: 'whatsapp', ad: 'Carros' },
    })
  })

  it('primer contacto sin anuncio', () => {
    expect(eventText(ev('first_contact', { channel: 'instagram', ad: null })).key).toBe('firstContact')
  })

  it('conversación con su conteo', () => {
    expect(eventText(ev('conversation', { channel: 'whatsapp', message_count: 240 }))).toEqual({
      key: 'conversation',
      values: { channel: 'whatsapp', count: 240 },
    })
  })

  it('traspaso del bot, entre asesores y de vuelta al bot', () => {
    expect(eventText(ev('assignment', { from_agent_id: null, to_agent_id: 'u', to_agent_name: 'Angélica' })).key).toBe(
      'assignmentFromBot',
    )
    expect(
      eventText(ev('assignment', { from_agent_id: 'a', to_agent_id: 'b', from_agent_name: 'Juan', to_agent_name: 'Ana' })),
    ).toEqual({ key: 'assignmentTransfer', values: { from: 'Juan', to: 'Ana' } })
    expect(eventText(ev('assignment', { from_agent_id: 'a', to_agent_id: null })).key).toBe('assignmentToBot')
  })

  it('eventos de cita', () => {
    expect(eventText(ev('appointment_event', { event: 'status_changed', to: 'attended' }))).toEqual({
      key: 'appointmentStatus',
      values: { status: 'attended' },
    })
    expect(eventText(ev('appointment_event', { event: 'customer_confirmed' })).key).toBe(
      'appointmentCustomerConfirmed',
    )
  })

  it('cambio de etapa y cierre', () => {
    expect(
      eventText(ev('deal_stage', { title: 'CX-30', from_stage_name: 'Prospecto', to_stage_name: 'Negociación' })),
    ).toEqual({ key: 'dealStage', values: { title: 'CX-30', from: 'Prospecto', to: 'Negociación' } })
    expect(eventText(ev('deal_closed', { title: 'CX-30', to_status: 'won' })).key).toBe('dealWon')
    expect(eventText(ev('deal_closed', { title: 'CX-30', to_status: 'lost' })).key).toBe('dealLost')
  })

  it('compra y retoma se distinguen', () => {
    const vehicle = { brand: 'Chevrolet', model: 'Spark', year: 2015 }
    expect(eventText(ev('acquisition', { vehicle, acquisition_kind: 'trade_in' }))).toEqual({
      key: 'acquisitionTradeIn',
      values: { vehicle: 'Chevrolet Spark 2015' },
    })
    expect(eventText(ev('acquisition', { vehicle, acquisition_kind: null })).key).toBe('acquisitionPurchase')
  })
})

describe('vehicleLabel y durationMinutes', () => {
  it('arma el nombre del vehículo con lo que haya', () => {
    expect(vehicleLabel({ brand: 'Mazda', model: 'CX-30', year: 2022 })).toBe('Mazda CX-30 2022')
    expect(vehicleLabel({ brand: 'Mazda' })).toBe('Mazda')
    expect(vehicleLabel(null)).toBe('')
  })

  it('redondea la duración hacia arriba', () => {
    expect(durationMinutes(240)).toBe(4)
    expect(durationMinutes(241)).toBe(5)
    expect(durationMinutes(null)).toBeNull()
    expect(durationMinutes(-3)).toBeNull()
  })
})

describe('groupTimelineByDay', () => {
  const at = (iso: string, id: string): TimelineEvent => ({ ...ev('note'), occurred_at: iso, source_id: id, sort_key: `note:${id}` })

  it('agrupa eventos seguidos del mismo día y respeta el orden', () => {
    const days = groupTimelineByDay([
      at('2026-10-28T15:00:00', 'a'),
      at('2026-10-28T09:00:00', 'b'),
      at('2026-10-26T12:00:00', 'c'),
    ])
    expect(days.map((d) => [d.day, d.events.map((e) => e.source_id)])).toEqual([
      ['2026-10-28', ['a', 'b']],
      ['2026-10-26', ['c']],
    ])
  })

  it('sin eventos no hay días', () => {
    expect(groupTimelineByDay([])).toEqual([])
  })
})
