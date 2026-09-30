import { describe, expect, it } from 'vitest'
import {
  firstNameForGreeting,
  greetingVariableIndices,
  isPlaceholderValue,
} from './template-prefill'

describe('greetingVariableIndices', () => {
  it('encuentra la variable que sigue a un saludo', () => {
    expect(greetingVariableIndices('Hola {{1}}, ¿sigues buscando vehículo?')).toEqual([1])
    expect(greetingVariableIndices('Buenos días {{2}}, tu cita es el {{1}}')).toEqual([2])
    expect(greetingVariableIndices('Hola, {{1}}. Te escribimos de LoraMotors')).toEqual([1])
    expect(greetingVariableIndices('¡Buenas tardes {{1}}!')).toEqual([1])
  })

  it('no toca variables que no son un saludo', () => {
    expect(greetingVariableIndices('Tu cita es el {{1}}')).toEqual([])
    expect(greetingVariableIndices('Sin variables')).toEqual([])
  })
})

describe('firstNameForGreeting', () => {
  it('toma la primera palabra con letras y la capitaliza', () => {
    expect(firstNameForGreeting('JEFERSON veroes')).toBe('Jeferson')
    expect(firstNameForGreeting('maximiliano')).toBe('Maximiliano')
    expect(firstNameForGreeting('Dios es amor')).toBe('Dios')
    expect(firstNameForGreeting('😎 Luis Hdz')).toBe('Luis')
    expect(firstNameForGreeting('Fabián')).toBe('Fabián')
  })

  it('no inventa un nombre donde no lo hay', () => {
    expect(firstNameForGreeting('⭐')).toBeNull()
    expect(firstNameForGreeting('573017070823')).toBeNull()
    expect(firstNameForGreeting('J')).toBeNull()
    expect(firstNameForGreeting('')).toBeNull()
    expect(firstNameForGreeting(null)).toBeNull()
    expect(firstNameForGreeting(',,,,,,')).toBeNull()
  })
})

describe('isPlaceholderValue', () => {
  it('marca números y un solo carácter', () => {
    expect(isPlaceholderValue('1')).toBe(true)
    expect(isPlaceholderValue(' 12 ')).toBe(true)
    expect(isPlaceholderValue('J')).toBe(true)
    expect(isPlaceholderValue('.')).toBe(true)
  })

  it('deja pasar un valor real', () => {
    expect(isPlaceholderValue('Ana')).toBe(false)
    expect(isPlaceholderValue('Jeferson')).toBe(false)
    expect(isPlaceholderValue('15 de octubre')).toBe(false)
  })

  it('un campo vacío no es relleno: lo ataja la regla de obligatorio', () => {
    expect(isPlaceholderValue('')).toBe(false)
    expect(isPlaceholderValue('   ')).toBe(false)
  })
})
