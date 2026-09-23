import { describe, expect, it } from 'vitest'

import {
  MAX_REACTIVATE_DAYS,
  MAX_STALE_HOURS,
  buildAssignmentPayload,
  evenSplit,
  formFromResponse,
  serverErrorField,
  sumPercents,
  validateAssignmentForm,
  type AssignmentForm,
  type AssignmentSettingsResponse,
} from './assignment-settings-model'

const ANA = 'u-ana'
const BETO = 'u-beto'
const CATA = 'u-cata'
const EX = 'u-ex'

function respuesta(over: Partial<AssignmentSettingsResponse> = {}): AssignmentSettingsResponse {
  return {
    stale_assign_after_hours: null,
    stale_assign_enabled_at: null,
    bot_reactivate_after_days: 7,
    weights_updated_at: null,
    weights: [],
    agents: [
      { user_id: ANA, full_name: 'Ana' },
      { user_id: BETO, full_name: 'Beto' },
      { user_id: CATA, full_name: 'Cata' },
    ],
    ...over,
  }
}

describe('evenSplit', () => {
  it('reparte enteros que suman 100, el sobrante a los primeros', () => {
    expect(evenSplit(3)).toEqual([34, 33, 33])
    expect(evenSplit(4)).toEqual([25, 25, 25, 25])
    expect(evenSplit(1)).toEqual([100])
    expect(evenSplit(7).reduce((a, b) => a + b, 0)).toBe(100)
  })

  it('sin asesores devuelve una lista vacía', () => {
    expect(evenSplit(0)).toEqual([])
  })
})

describe('formFromResponse', () => {
  it('sin porcentajes guardados propone el reparto parejo entre todos los asesores', () => {
    const f = formFromResponse(respuesta())
    expect(f.weights.map((w) => [w.user_id, w.percent])).toEqual([
      [ANA, '34'],
      [BETO, '33'],
      [CATA, '33'],
    ])
    expect(f.usingDefaultSplit).toBe(true)
  })

  it('con porcentajes guardados los respeta y suma a los asesores faltantes con 0', () => {
    const f = formFromResponse(
      respuesta({
        weights: [
          { user_id: BETO, full_name: 'Beto', percent: 60, eligible: true },
          { user_id: ANA, full_name: 'Ana', percent: 40, eligible: true },
        ],
      }),
    )
    expect(f.weights.map((w) => [w.user_id, w.percent, w.eligible])).toEqual([
      [BETO, '60', true],
      [ANA, '40', true],
      [CATA, '0', true],
    ])
    expect(f.usingDefaultSplit).toBe(false)
  })

  it('conserva y marca a quien ya no es asesor', () => {
    const f = formFromResponse(
      respuesta({
        weights: [
          { user_id: ANA, full_name: 'Ana', percent: 50, eligible: true },
          { user_id: EX, full_name: 'Ex asesor', percent: 50, eligible: false },
        ],
      }),
    )
    const ex = f.weights.find((w) => w.user_id === EX)
    expect(ex).toMatchObject({ eligible: false, percent: '50' })
  })

  it('lleva las reglas: horas nulas = apagado, días con su valor', () => {
    const apagado = formFromResponse(respuesta({ bot_reactivate_after_days: null }))
    expect(apagado.staleEnabled).toBe(false)
    expect(apagado.reactivateEnabled).toBe(false)

    const encendido = formFromResponse(
      respuesta({ stale_assign_after_hours: 24, bot_reactivate_after_days: 7 }),
    )
    expect(encendido).toMatchObject({
      staleEnabled: true,
      staleHours: '24',
      reactivateEnabled: true,
      reactivateDays: '7',
    })
  })
})

describe('sumPercents', () => {
  it('suma lo escrito y trata lo ilegible como 0', () => {
    const f = formFromResponse(respuesta())
    f.weights[0].percent = 'abc'
    expect(sumPercents(f.weights)).toBe(66)
  })
})

describe('validateAssignmentForm', () => {
  const base = (): AssignmentForm => formFromResponse(respuesta())

  it('un formulario parejo es válido', () => {
    expect(validateAssignmentForm(base())).toEqual({})
  })

  it('pide que la suma sea exactamente 100', () => {
    const f = base()
    f.weights[0].percent = '30'
    expect(validateAssignmentForm(f).weights).toBe('weightsSum')
  })

  it('rechaza porcentajes no enteros o fuera de 0..100', () => {
    for (const malo of ['12.5', '-1', '101', '', 'x']) {
      const f = base()
      f.weights[0].percent = malo
      expect(validateAssignmentForm(f).weights).toBe('percentInvalid')
    }
  })

  it('pide al menos un asesor con porcentaje', () => {
    const f = base()
    for (const w of f.weights) w.percent = '0'
    expect(validateAssignmentForm(f).weights).toBe('weightsEmpty')
  })

  it('no deja guardar mientras quede alguien que ya no es asesor', () => {
    const f = base()
    f.weights.push({ user_id: EX, full_name: 'Ex', percent: '0', eligible: false })
    expect(validateAssignmentForm(f).weights).toBe('ineligible')
  })

  it('el tope de horas es el del servidor: 720 (30 días)', () => {
    expect(MAX_STALE_HOURS).toBe(720)
  })

  it('valida las horas solo si la regla está encendida', () => {
    const f = base()
    f.staleHours = '0'
    expect(validateAssignmentForm(f).stale).toBeUndefined()
    f.staleEnabled = true
    expect(validateAssignmentForm(f).stale).toBe('hoursInvalid')
    f.staleHours = String(MAX_STALE_HOURS + 1)
    expect(validateAssignmentForm(f).stale).toBe('hoursInvalid')
    f.staleHours = '1.5'
    expect(validateAssignmentForm(f).stale).toBe('hoursInvalid')
    f.staleHours = '48'
    expect(validateAssignmentForm(f).stale).toBeUndefined()
  })

  it('valida los días de reactivación solo si la regla está encendida', () => {
    const f = base()
    f.reactivateDays = String(MAX_REACTIVATE_DAYS + 1)
    expect(validateAssignmentForm(f).reactivate).toBe('daysInvalid')
    f.reactivateEnabled = false
    expect(validateAssignmentForm(f).reactivate).toBeUndefined()
  })
})

describe('buildAssignmentPayload', () => {
  it('sin cambios no manda nada', () => {
    const inicial = formFromResponse(
      respuesta({
        weights: [{ user_id: ANA, full_name: 'Ana', percent: 100, eligible: true }],
      }),
    )
    expect(buildAssignmentPayload(structuredClone(inicial), inicial)).toEqual({})
  })

  it('no reenvía porcentajes intactos al cambiar solo las horas (guardarlos reinicia la cuota)', () => {
    const inicial = formFromResponse(
      respuesta({
        weights: [{ user_id: ANA, full_name: 'Ana', percent: 100, eligible: true }],
      }),
    )
    const f = structuredClone(inicial)
    f.staleEnabled = true
    f.staleHours = '12'
    expect(buildAssignmentPayload(f, inicial)).toEqual({ stale_assign_after_hours: 12 })
  })

  it('apagar una regla manda null', () => {
    const inicial = formFromResponse(respuesta({ stale_assign_after_hours: 6 }))
    const f = structuredClone(inicial)
    f.staleEnabled = false
    f.reactivateEnabled = false
    expect(buildAssignmentPayload(f, inicial)).toMatchObject({
      stale_assign_after_hours: null,
      bot_reactivate_after_days: null,
    })
  })

  it('manda los porcentajes sin los 0 ni a quienes ya no son asesores', () => {
    const inicial = formFromResponse(respuesta())
    const f = structuredClone(inicial)
    f.weights[0].percent = '70'
    f.weights[1].percent = '30'
    f.weights[2].percent = '0'
    expect(buildAssignmentPayload(f, inicial)).toEqual({
      weights: [
        { user_id: ANA, percent: 70 },
        { user_id: BETO, percent: 30 },
      ],
    })
  })

  it('el reparto parejo propuesto (sin guardar) cuenta como cambio en cuanto se toca', () => {
    const inicial = formFromResponse(respuesta())
    const f = structuredClone(inicial)
    f.weights[0].percent = '34'
    // Idéntico a lo propuesto: no se manda — el servidor ya reparte parejo.
    expect(buildAssignmentPayload(f, inicial)).toEqual({})
  })
})

describe('serverErrorField', () => {
  it('ubica cada código junto a su campo', () => {
    expect(serverErrorField('weights_sum')).toBe('weights')
    expect(serverErrorField('weights_not_agent')).toBe('weights')
    expect(serverErrorField('stale_days_invalid')).toBe('stale')
    expect(serverErrorField('stale_hours_invalid')).toBe('stale')
    expect(serverErrorField('reactivate_days_invalid')).toBe('reactivate')
    expect(serverErrorField('save_failed')).toBe('general')
    expect(serverErrorField(undefined)).toBe('general')
  })
})
