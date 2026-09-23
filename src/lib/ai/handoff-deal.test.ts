import { describe, it, expect } from 'vitest'
import { buildHandoffDealTitle } from './handoff-deal'
import type { HandoffRequest } from './types'

// La CREACIÓN del negocio del traspaso vive en la base desde el cambio
// sticky-weighted-assignment (`ai_handoff_assign` →
// `ensure_open_deal_for_contact`) y se prueba en
// supabase/tests/sticky_weighted_assignment.test.sql: título rico antes
// que el genérico, uno por contacto, embudo Ventas / primera etapa,
// moneda de la cuenta, asignado al profiles.id del asesor.

function request(over: Partial<HandoffRequest> = {}): HandoffRequest {
  return {
    nombre: 'Carlos',
    presupuesto: '30 millones',
    interes: 'Mazda 3 2018',
    credito: true,
    ocupacion: 'independiente',
    ingresos: '4 millones',
    motivo: 'credito',
    ...over,
  }
}


describe('buildHandoffDealTitle', () => {
  it('junta el nombre del cliente y el vehículo que pidió', () => {
    expect(buildHandoffDealTitle(request())).toBe('Carlos — Mazda 3 2018')
  })

  // ESCENARIO: Traspaso urgente sin presupuesto — solo hay nombre.
  // No se rellena el hueco con un "Sin vehículo" que se leería como
  // dato: lo que falta va señalado como falta en la nota, no en el
  // título.
  it('se queda con lo que hay cuando el bot no averiguó el resto', () => {
    expect(buildHandoffDealTitle(request({ interes: null }))).toBe('Carlos')
    expect(buildHandoffDealTitle(request({ nombre: '  ' }))).toBe('Mazda 3 2018')
  })

  it('no inventa nada cuando no hay calificación', () => {
    expect(buildHandoffDealTitle(null)).toBe('Traspaso del asistente')
    expect(buildHandoffDealTitle(request({ nombre: null, interes: null }))).toBe(
      'Traspaso del asistente',
    )
  })
})
