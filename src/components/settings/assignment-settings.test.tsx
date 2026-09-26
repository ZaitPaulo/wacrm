import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// Catálogo real: la prueba también falla si falta una clave o un
// argumento ICU está mal escrito.
const MESSAGES = JSON.parse(readFileSync(join(process.cwd(), 'messages', 'es.json'), 'utf8'))

vi.mock('next-intl', async () => {
  const actual = await vi.importActual<typeof import('next-intl')>('next-intl')
  return {
    ...actual,
    useTranslations: (namespace: string) =>
      actual.createTranslator({
        locale: 'es',
        messages: MESSAGES,
        namespace,
        onError: (err) => {
          throw err
        },
      }),
  }
})

import { AssignmentSettingsView, type AssignmentSettingsViewProps } from './assignment-settings'
import {
  formFromResponse,
  validateAssignmentForm,
  type AssignmentForm,
  type AssignmentSettingsResponse,
} from './assignment-settings-model'

const UI = MESSAGES.Settings.assignment.ui

const RESPUESTA: AssignmentSettingsResponse = {
  stale_assign_after_hours: null,
  stale_assign_enabled_at: null,
  bot_reactivate_after_days: 7,
  weights_updated_at: '2026-09-23T15:00:00Z',
  weights: [
    { user_id: 'u-ana', full_name: 'Ana Ruiz', percent: 50, eligible: true },
    { user_id: 'u-beto', full_name: 'Beto Gil', percent: 50, eligible: true },
  ],
  agents: [
    { user_id: 'u-ana', full_name: 'Ana Ruiz' },
    { user_id: 'u-beto', full_name: 'Beto Gil' },
  ],
  trade_in_agent_id: null,
  members: [
    { user_id: 'u-ange', full_name: 'Angélica Molero', role: 'admin' },
    { user_id: 'u-ana', full_name: 'Ana Ruiz', role: 'agent' },
    { user_id: 'u-beto', full_name: 'Beto Gil', role: 'agent' },
  ],
}

const noop = () => {}

function render(over: Partial<AssignmentSettingsViewProps> = {}, form?: AssignmentForm) {
  const f = form ?? formFromResponse(RESPUESTA)
  const props: AssignmentSettingsViewProps = {
    status: 'ready',
    canEdit: true,
    form: f,
    errors: validateAssignmentForm(f),
    serverError: null,
    dirty: false,
    saving: false,
    staleActiveSince: null,
    members: RESPUESTA.members,
    onRetry: noop,
    onPercentChange: noop,
    onEvenSplit: noop,
    onRemove: noop,
    onStaleToggle: noop,
    onStaleHoursChange: noop,
    onReactivateToggle: noop,
    onReactivateDaysChange: noop,
    onTradeInChange: noop,
    onSave: noop,
    ...over,
  }
  return renderToStaticMarkup(<AssignmentSettingsView {...props} />)
}

/** El texto visible sin etiquetas, para buscar frases partidas por nodos. */
function texto(html: string) {
  return html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&amp;/g, '&')
}

describe('AssignmentSettingsView — estados', () => {
  it('cargando: lo anuncia sin pintar el formulario', () => {
    const html = render({ status: 'loading', form: null })
    expect(html).toContain(UI.loading)
    expect(html).toContain('aria-busy="true"')
    expect(html).not.toContain(UI.weights.title)
  })

  it('error de carga: explica y ofrece reintentar', () => {
    const html = render({ status: 'error', form: null })
    expect(html).toContain(UI.loadFailed)
    expect(html).toContain(UI.retry)
    expect(html).toContain('role="alert"')
  })

  it('sin permiso: no muestra el formulario', () => {
    const html = render({ canEdit: false })
    expect(html).toContain(UI.adminOnly)
    expect(html).not.toContain(UI.weights.title)
    expect(html).not.toContain('<input')
  })

  it('sin asesores: estado vacío que manda a Equipo', () => {
    const form = formFromResponse({ ...RESPUESTA, weights: [], agents: [] })
    const html = render({}, form)
    expect(html).toContain(UI.weights.noAgents)
    expect(html).not.toContain(UI.weights.evenSplit)
  })
})

describe('AssignmentSettingsView — reparto', () => {
  it('explica la regla y lista cada asesor con su campo etiquetado', () => {
    const html = render()
    expect(html).toContain(UI.weights.explainer)
    expect(html).toContain('Ana Ruiz')
    expect(html).toContain('Beto Gil')
    expect(html).toContain('aria-label="Porcentaje de Ana Ruiz"')
    expect(html).toContain('inputMode="numeric"')
    expect(html).toContain(UI.weights.evenSplit)
  })

  it('la suma se anuncia en vivo', () => {
    const html = render()
    expect(html).toMatch(/aria-live="polite"[^>]*>[\s\S]*100 %/)
  })

  it('suma incompleta: dice cuánto falta, marca los campos y no deja guardar', () => {
    const form = formFromResponse(RESPUESTA)
    form.weights[0].percent = '47'
    const html = render({ dirty: true }, form)
    expect(texto(html)).toContain('97 % · faltan 3 %')
    expect(html).toContain(UI.validation.weightsSum)
    expect(html).toContain('aria-invalid="true"')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*(<[^>]+>)*[^<]*Guardar cambios/)
  })

  it('suma de más: dice cuánto sobra', () => {
    const form = formFromResponse(RESPUESTA)
    form.weights[0].percent = '60'
    expect(texto(render({ dirty: true }, form))).toContain('110 % · sobran 10 %')
  })

  it('marca a quien ya no es asesor y permite quitarlo', () => {
    const form = formFromResponse({
      ...RESPUESTA,
      weights: [
        ...RESPUESTA.weights,
        { user_id: 'u-ex', full_name: 'Ex Asesor', percent: 10, eligible: false },
      ],
    })
    const html = render({}, form)
    expect(html).toContain(UI.weights.ineligible)
    expect(html).toContain(UI.weights.ineligibleHint)
    expect(html).toContain('aria-label="Quitar a Ex Asesor del reparto"')
  })

  it('sin porcentajes guardados avisa que hoy se reparte parejo', () => {
    const form = formFromResponse({ ...RESPUESTA, weights: [] })
    expect(render({}, form)).toContain(UI.weights.defaultNote)
  })

  it('un asesor sin nombre no queda en blanco', () => {
    const form = formFromResponse({
      ...RESPUESTA,
      weights: [],
      agents: [{ user_id: 'u-x', full_name: '' }],
    })
    expect(render({}, form)).toContain(UI.weights.unnamed)
  })
})

describe('AssignmentSettingsView — reglas', () => {
  it('conversaciones sin asesor: campo en horas asociado a su etiqueta y su ayuda', () => {
    const form = formFromResponse({ ...RESPUESTA, stale_assign_after_hours: 12 })
    const html = render({ staleActiveSince: '23 de sept. de 2026' }, form)
    expect(html).toContain(UI.stale.title)
    expect(html).toContain(UI.stale.help)
    expect(html).toContain('for="assignment-stale-hours"')
    expect(html).toMatch(/id="assignment-stale-hours"[^>]*value="12"|value="12"[^>]*id="assignment-stale-hours"/)
    expect(html).toContain(UI.stale.unit)
    expect(html).toContain('Activa desde el 23 de sept. de 2026.')
  })

  it('regla apagada: el número queda deshabilitado y se dice qué pasa', () => {
    const form = formFromResponse({ ...RESPUESTA, bot_reactivate_after_days: null })
    const html = render({}, form)
    expect(html).toContain(UI.stale.off)
    expect(html).toContain(UI.reactivate.off)
    expect(html).toMatch(/<input[^>]*id="assignment-reactivate-days"[^>]*disabled=""/)
  })

  it('reactivación del bot con su ayuda', () => {
    const html = render()
    expect(html).toContain(UI.reactivate.title)
    expect(html).toContain(UI.reactivate.help)
    expect(html).toMatch(/id="assignment-reactivate-days"[^>]*value="7"|value="7"[^>]*id="assignment-reactivate-days"/)
  })

  it('horas inválidas: error junto al campo y enlazado con aria-describedby', () => {
    const form = formFromResponse(RESPUESTA)
    form.staleEnabled = true
    form.staleHours = '0'
    const html = render({ dirty: true }, form)
    expect(html).toContain(UI.validation.hoursInvalid)
    expect(html).toMatch(/id="assignment-stale-hours"[^>]*aria-describedby="[^"]*assignment-stale-error/)
  })
})

describe('AssignmentSettingsView — ventas y permutas', () => {
  it('selector etiquetado, con su ayuda, y "nadie" cuando no hay nadie', () => {
    const html = render()
    expect(html).toContain(UI.tradeIn.title)
    expect(html).toMatch(/<label[^>]*for="assignment-trade-in"/)
    expect(html).toMatch(/id="assignment-trade-in"[^>]*aria-describedby="assignment-trade-in-help"|aria-describedby="assignment-trade-in-help"[^>]*id="assignment-trade-in"/)
    expect(texto(html)).toContain(UI.tradeIn.help)
    expect(texto(html)).toContain(UI.tradeIn.none)
  })

  it('muestra el nombre de quien está elegido', () => {
    const form = formFromResponse({ ...RESPUESTA, trade_in_agent_id: 'u-ange' })
    expect(texto(render({}, form))).toContain('Angélica Molero')
  })

  it('si lo guardado ya no es miembro, lo dice', () => {
    const form = formFromResponse({ ...RESPUESTA, trade_in_agent_id: 'u-se-fue' })
    expect(texto(render({}, form))).toContain(UI.tradeIn.notMember)
  })

  it('el error del servidor sale junto al selector y se anuncia', () => {
    const html = render({
      dirty: true,
      serverError: { field: 'tradeIn', message: 'Ya no es miembro.' },
    })
    expect(html).toMatch(/id="assignment-trade-in-error"[^>]*role="alert"|role="alert"[^>]*id="assignment-trade-in-error"/)
  })
})

describe('AssignmentSettingsView — guardar', () => {
  it('con cambios válidos avisa y deja guardar', () => {
    const html = render({ dirty: true })
    expect(html).toContain(UI.unsaved)
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>[^<]*(<[^>]+>)*[^<]*Guardar cambios/)
  })

  it('sin cambios el botón queda deshabilitado', () => {
    const html = render({ dirty: false })
    expect(html).toContain(UI.noChanges)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*(<[^>]+>)*[^<]*Guardar cambios/)
  })

  it('el error del servidor sale junto a su campo y se anuncia', () => {
    const html = render({
      dirty: true,
      serverError: { field: 'weights', message: 'Solo los miembros con rol de asesor…' },
    })
    expect(html).toMatch(/id="assignment-weights-error"[^>]*role="alert"|role="alert"[^>]*id="assignment-weights-error"/)
    expect(html).toContain('Solo los miembros con rol de asesor…')
  })

  it('un error general del servidor sale junto al botón', () => {
    const html = render({
      dirty: true,
      serverError: { field: 'general', message: 'No se pudo guardar.' },
    })
    expect(html).toMatch(/id="assignment-general-error"[^>]*role="alert"[\s\S]*?No se pudo guardar\./)
  })

  it('guardando: el botón lo dice', () => {
    expect(render({ dirty: true, saving: true })).toContain(UI.saving)
  })
})
