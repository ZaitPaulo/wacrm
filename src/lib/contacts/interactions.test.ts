import { describe, it, expect } from 'vitest'
import { parseInteractionInput, parseInteractionPatch } from './interactions'

const NOW = new Date('2026-10-19T17:00:00.000Z')

describe('parseInteractionInput', () => {
  it('acepta una llamada saliente completa', () => {
    const r = parseInteractionInput(
      {
        kind: 'call_outbound',
        outcome: 'answered',
        duration_seconds: 240,
        occurred_at: '2026-10-19T10:00:00.000Z',
        note: '  pide financiación  ',
      },
      NOW,
    )
    expect(r).toEqual({
      ok: true,
      value: {
        kind: 'call_outbound',
        outcome: 'answered',
        duration_seconds: 240,
        occurred_at: '2026-10-19T10:00:00.000Z',
        note: 'pide financiación',
      },
    })
  })

  it('sin fecha usa ahora', () => {
    const r = parseInteractionInput({ kind: 'walk_in' }, NOW)
    expect(r.ok && r.value.occurred_at).toBe(NOW.toISOString())
  })

  it('rechaza una fecha futura', () => {
    expect(parseInteractionInput({ kind: 'walk_in', occurred_at: '2026-10-20T10:00:00Z' }, NOW)).toEqual({
      ok: false,
      error: 'future_date',
    })
  })

  it('tolera un minuto de desfase', () => {
    expect(parseInteractionInput({ kind: 'walk_in', occurred_at: '2026-10-19T17:00:30Z' }, NOW).ok).toBe(true)
  })

  it('rechaza un resultado en una visita', () => {
    expect(parseInteractionInput({ kind: 'walk_in', outcome: 'answered' }, NOW)).toEqual({
      ok: false,
      error: 'outcome_not_call',
    })
  })

  it('rechaza tipo, resultado y duración inválidos', () => {
    expect(parseInteractionInput({ kind: 'email' }, NOW)).toEqual({ ok: false, error: 'invalid_kind' })
    expect(parseInteractionInput({ kind: 'call_inbound', outcome: 'maybe' }, NOW)).toEqual({
      ok: false,
      error: 'invalid_outcome',
    })
    expect(parseInteractionInput({ kind: 'call_inbound', duration_seconds: -5 }, NOW)).toEqual({
      ok: false,
      error: 'invalid_duration',
    })
    expect(parseInteractionInput({ kind: 'call_inbound', duration_seconds: 1.5 }, NOW)).toEqual({
      ok: false,
      error: 'invalid_duration',
    })
  })

  it('una nota vacía queda en null', () => {
    const r = parseInteractionInput({ kind: 'other', note: '   ' }, NOW)
    expect(r.ok && r.value.note).toBeNull()
  })
})

describe('parseInteractionPatch', () => {
  it('solo trae los campos enviados', () => {
    expect(parseInteractionPatch({ duration_seconds: 360 }, 'call_outbound', NOW)).toEqual({
      ok: true,
      value: { duration_seconds: 360 },
    })
  })

  it('no deja poner resultado a una visita', () => {
    expect(parseInteractionPatch({ outcome: 'answered' }, 'walk_in', NOW)).toEqual({
      ok: false,
      error: 'outcome_not_call',
    })
  })

  it('no deja mover la interacción al futuro', () => {
    expect(parseInteractionPatch({ occurred_at: '2027-01-01T00:00:00Z' }, 'other', NOW)).toEqual({
      ok: false,
      error: 'future_date',
    })
  })
})
