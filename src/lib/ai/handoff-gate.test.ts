import { describe, it, expect } from 'vitest'
import { evaluateHandoffGate, REQUIRED_HANDOFF_FIELDS } from './handoff-gate'
import type { HandoffRequest } from './types'

function request(overrides: Partial<HandoffRequest> = {}): HandoffRequest {
  return {
    nombre: 'Carlos',
    presupuesto: '30000000',
    interes: 'Kia Sportage 2019',
    credito: true,
    motivo: 'visita',
    ...overrides,
  }
}

describe('evaluateHandoffGate — datos completos', () => {
  it('deja pasar la transferencia', () => {
    expect(evaluateHandoffGate({ request: request(), attempts: 0 })).toEqual({
      transfer: true,
      missing: [],
      urgent: false,
    })
  })

  // credito=false es un dato, no una ausencia. Es la trampa clásica de
  // chequear con `if (!value)`: un cliente que NO necesita crédito se
  // quedaría atascado para siempre.
  it('acepta credito=false como dato presente', () => {
    const res = evaluateHandoffGate({ request: request({ credito: false }), attempts: 0 })
    expect(res.transfer).toBe(true)
    expect(res.missing).toEqual([])
  })
})

describe('evaluateHandoffGate — datos incompletos', () => {
  it('bloquea cuando falta el presupuesto y lo nombra', () => {
    const res = evaluateHandoffGate({ request: request({ presupuesto: null }), attempts: 0 })
    expect(res.transfer).toBe(false)
    expect(res.missing).toEqual(['presupuesto'])
  })

  it('bloquea cuando falta el vehículo de interés', () => {
    const res = evaluateHandoffGate({ request: request({ interes: null }), attempts: 0 })
    expect(res.transfer).toBe(false)
    expect(res.missing).toEqual(['interes'])
  })

  it('lista todos los campos faltantes de un sentinel desnudo', () => {
    const bare: HandoffRequest = {
      nombre: null,
      presupuesto: null,
      interes: null,
      credito: null,
      motivo: 'otro',
    }
    const res = evaluateHandoffGate({ request: bare, attempts: 0 })
    expect(res.transfer).toBe(false)
    expect(res.missing).toEqual([...REQUIRED_HANDOFF_FIELDS])
  })

  // El escape por intentos es solo para urgencias. Una venta puede
  // esperar; si no, el gate no serviría de nada pasados unos turnos.
  it('sigue bloqueando al quinto intento no urgente', () => {
    const res = evaluateHandoffGate({ request: request({ presupuesto: null }), attempts: 5 })
    expect(res.transfer).toBe(false)
  })
})

describe('evaluateHandoffGate — urgencia', () => {
  it('transfiere un reclamo con solo el nombre', () => {
    const res = evaluateHandoffGate({
      request: request({
        motivo: 'reclamo',
        presupuesto: null,
        interes: null,
        credito: null,
      }),
      attempts: 0,
    })
    expect(res).toEqual({ transfer: true, missing: [], urgent: true })
  })

  it('transfiere a quien pide un humano con solo el nombre', () => {
    const res = evaluateHandoffGate({
      request: request({ motivo: 'pide_humano', presupuesto: null, interes: null }),
      attempts: 0,
    })
    expect(res.transfer).toBe(true)
    expect(res.urgent).toBe(true)
  })

  it('retiene una urgencia sin nombre y pide solo el nombre', () => {
    const res = evaluateHandoffGate({
      request: request({ motivo: 'reclamo', nombre: null, presupuesto: null }),
      attempts: 0,
    })
    expect(res.transfer).toBe(false)
    // Ni presupuesto ni interés: a un cliente molesto no se le pide eso.
    expect(res.missing).toEqual(['nombre'])
    expect(res.urgent).toBe(true)
  })

  it('transfiere al segundo intento urgente aunque el nombre siga faltando', () => {
    const res = evaluateHandoffGate({
      request: request({ motivo: 'pide_humano', nombre: null }),
      attempts: 1,
    })
    expect(res.transfer).toBe(true)
    expect(res.urgent).toBe(true)
  })
})
