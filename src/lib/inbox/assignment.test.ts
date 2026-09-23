import { describe, it, expect } from 'vitest'
import {
  administra,
  asesorAlTomar,
  destinatarioValido,
  puedeCambiarAsignacion,
  puedeControlarIa,
} from './assignment'

describe('administra', () => {
  it('owner y admin administran; agent y viewer no', () => {
    expect(administra('owner')).toBe(true)
    expect(administra('admin')).toBe(true)
    expect(administra('agent')).toBe(false)
    expect(administra('viewer')).toBe(false)
  })
})

// P2: el asesor de un contacto solo lo cambia un owner/admin a mano.
describe('puedeCambiarAsignacion', () => {
  it('owner y admin reasignan y sueltan', () => {
    expect(puedeCambiarAsignacion({ role: 'owner' })).toBe(true)
    expect(puedeCambiarAsignacion({ role: 'admin' })).toBe(true)
  })

  // Antes un agent podía pasarle su conversación a un compañero; con el
  // asesor pegajoso, eso rompería "el mismo lead, el mismo asesor".
  it('el agent no reasigna ni suelta, tampoco lo suyo', () => {
    expect(puedeCambiarAsignacion({ role: 'agent' })).toBe(false)
  })

  it('viewer nunca', () => {
    expect(puedeCambiarAsignacion({ role: 'viewer' })).toBe(false)
  })
})

describe('puedeControlarIa', () => {
  it('el agent pausa o reactiva la IA en el hilo que tiene asignado', () => {
    expect(
      puedeControlarIa({ role: 'agent', userId: 'u-juan', currentAssigneeId: 'u-juan' }),
    ).toBe(true)
  })

  it('el agent no controla la IA en el hilo de otro ni en uno sin asesor', () => {
    expect(
      puedeControlarIa({ role: 'agent', userId: 'u-juan', currentAssigneeId: 'u-brayan' }),
    ).toBe(false)
    expect(
      puedeControlarIa({ role: 'agent', userId: 'u-juan', currentAssigneeId: null }),
    ).toBe(false)
  })

  it('owner y admin controlan la IA en cualquier hilo', () => {
    expect(
      puedeControlarIa({ role: 'admin', userId: 'u-a', currentAssigneeId: 'u-brayan' }),
    ).toBe(true)
    expect(puedeControlarIa({ role: 'owner', userId: 'u-o', currentAssigneeId: null })).toBe(true)
  })

  it('viewer nunca', () => {
    expect(
      puedeControlarIa({ role: 'viewer', userId: 'u-v', currentAssigneeId: 'u-v' }),
    ).toBe(false)
  })
})

// "Tomar el control" pausa la IA; solo asigna a quien lo pulsa si el hilo
// no tenía asesor. Nunca le quita el cliente a otro.
describe('asesorAlTomar', () => {
  it('asigna a quien toma cuando el hilo no tenía asesor', () => {
    expect(
      asesorAlTomar({ assignToMe: true, userId: 'u-admin', currentAssigneeId: null }),
    ).toBe('u-admin')
  })

  it('no reemplaza a un asesor existente', () => {
    expect(
      asesorAlTomar({ assignToMe: true, userId: 'u-admin', currentAssigneeId: 'u-juan' }),
    ).toBeUndefined()
  })

  it('sin assign_to_me no cambia nada', () => {
    expect(
      asesorAlTomar({ assignToMe: false, userId: 'u-admin', currentAssigneeId: null }),
    ).toBeUndefined()
  })
})

describe('destinatarioValido', () => {
  const miembros = ['u-juan', 'u-brayan']

  it('acepta a un miembro de la cuenta', () => {
    expect(destinatarioValido({ targetUserId: 'u-brayan', miembros })).toBe(true)
  })

  it('rechaza un UUID que no es de la cuenta', () => {
    expect(destinatarioValido({ targetUserId: 'u-otra-cuenta', miembros })).toBe(false)
  })

  it('null (soltar) no es asunto de esta regla', () => {
    expect(destinatarioValido({ targetUserId: null, miembros })).toBe(true)
  })
})
