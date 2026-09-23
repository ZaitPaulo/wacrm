import { describe, it, expect } from 'vitest'

import {
  ASSIGNMENT_SETTINGS_ERROR_CODES,
  assignmentSettingsErrorKey,
  parseAssignmentSettingsInput,
} from './settings'

const AGENTES = ['u-juan', 'u-brayan', 'u-robinson']

function parse(body: unknown) {
  return parseAssignmentSettingsInput(body, { agentIds: AGENTES })
}

describe('parseAssignmentSettingsInput — porcentajes', () => {
  it('acepta una lista que suma 100 con asesores agent', () => {
    expect(
      parse({
        weights: [
          { user_id: 'u-juan', percent: 34 },
          { user_id: 'u-brayan', percent: 33 },
          { user_id: 'u-robinson', percent: 33 },
        ],
      }),
    ).toEqual({
      ok: true,
      value: {
        weights: [
          { user_id: 'u-juan', percent: 34 },
          { user_id: 'u-brayan', percent: 33 },
          { user_id: 'u-robinson', percent: 33 },
        ],
      },
    })
  })

  it('un asesor fijo es 100 % a una persona', () => {
    expect(parse({ weights: [{ user_id: 'u-juan', percent: 100 }] }).ok).toBe(true)
  })

  it('rechaza una suma distinta de 100', () => {
    expect(
      parse({ weights: [{ user_id: 'u-juan', percent: 50 }, { user_id: 'u-brayan', percent: 40 }] }),
    ).toEqual({ ok: false, code: 'weights_sum' })
  })

  it('rechaza porcentajes no enteros o fuera de 1..100', () => {
    for (const percent of [0, 101, 33.5, -1, '50', null]) {
      expect(parse({ weights: [{ user_id: 'u-juan', percent }] })).toEqual({
        ok: false,
        code: 'weights_percent_range',
      })
    }
  })

  it('rechaza un asesor repetido', () => {
    expect(
      parse({ weights: [{ user_id: 'u-juan', percent: 50 }, { user_id: 'u-juan', percent: 50 }] }),
    ).toEqual({ ok: false, code: 'weights_duplicate' })
  })

  it('rechaza a quien no es agent de la cuenta (un admin, otra cuenta)', () => {
    expect(parse({ weights: [{ user_id: 'u-angelica', percent: 100 }] })).toEqual({
      ok: false,
      code: 'weights_not_agent',
    })
  })

  it('rechaza una lista vacía', () => {
    expect(parse({ weights: [] })).toEqual({ ok: false, code: 'weights_empty' })
  })

  it('rechaza una forma que no es lista de {user_id, percent}', () => {
    expect(parse({ weights: 'todos' })).toEqual({ ok: false, code: 'weights_invalid' })
    expect(parse({ weights: [{ id: 'u-juan', percent: 100 }] })).toEqual({
      ok: false,
      code: 'weights_invalid',
    })
    expect(parse({ weights: [null] })).toEqual({ ok: false, code: 'weights_invalid' })
  })
})

describe('parseAssignmentSettingsInput — plazos', () => {
  // P4 va en HORAS (decisión del Director del 2026-09-23); la
  // reactivación del bot sigue en días.
  it('acepta X en horas (1 a 720) y N en días (1 a 365)', () => {
    expect(parse({ stale_assign_after_hours: 3, bot_reactivate_after_days: 7 })).toEqual({
      ok: true,
      value: { stale_assign_after_hours: 3, bot_reactivate_after_days: 7 },
    })
    expect(parse({ stale_assign_after_hours: 720 }).ok).toBe(true)
  })

  it('null desactiva cada regla', () => {
    expect(parse({ stale_assign_after_hours: null, bot_reactivate_after_days: null })).toEqual({
      ok: true,
      value: { stale_assign_after_hours: null, bot_reactivate_after_days: null },
    })
  })

  it('rechaza horas fuera de 1..720 o no enteras', () => {
    for (const v of [0, 721, 2.5, '3']) {
      expect(parse({ stale_assign_after_hours: v })).toEqual({
        ok: false,
        code: 'stale_hours_invalid',
      })
    }
  })

  it('rechaza días de reactivación fuera de 1..365 o no enteros', () => {
    for (const v of [0, 366, 2.5, '3']) {
      expect(parse({ bot_reactivate_after_days: v })).toEqual({
        ok: false,
        code: 'reactivate_days_invalid',
      })
    }
  })

  // El nombre viejo (en días) ya no existe: no se acepta en silencio.
  it('no reconoce stale_assign_after_days', () => {
    expect(parse({ stale_assign_after_days: 3 })).toEqual({ ok: false, code: 'invalid_body' })
  })

  // La activación de P4 la fecha la base: el cliente no puede mandarla.
  it('ignora stale_assign_enabled_at si viene en el cuerpo', () => {
    expect(parse({ stale_assign_after_hours: 3, stale_assign_enabled_at: '2020-01-01' })).toEqual({
      ok: true,
      value: { stale_assign_after_hours: 3 },
    })
  })
})

describe('parseAssignmentSettingsInput — cuerpo', () => {
  it('rechaza lo que no es un objeto o no trae ningún campo conocido', () => {
    for (const body of [null, 'x', [], {}, { otra: 1 }]) {
      expect(parse(body)).toEqual({ ok: false, code: 'invalid_body' })
    }
  })

  it('es parcial: solo trae lo que vino', () => {
    expect(parse({ bot_reactivate_after_days: 10 })).toEqual({
      ok: true,
      value: { bot_reactivate_after_days: 10 },
    })
  })
})

describe('assignmentSettingsErrorKey', () => {
  it('cada código tiene su clave de Settings.assignment.errors', () => {
    for (const code of Object.values(ASSIGNMENT_SETTINGS_ERROR_CODES)) {
      expect(assignmentSettingsErrorKey(code)).toBe(code)
    }
  })

  it('un código desconocido cae al mensaje genérico', () => {
    expect(assignmentSettingsErrorKey('vaya')).toBe('save_failed')
    expect(assignmentSettingsErrorKey(undefined)).toBe('save_failed')
  })
})
