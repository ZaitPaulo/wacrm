import { describe, expect, it } from 'vitest'
import { suggestedWarrantyPrice, WARRANTY_MARKUP } from './specs'

// ============================================================
// Recargo de la garantía.
//
// La regla la dio el cliente en la reunión: 1,5 M para vehículos y
// 2,0 M para camionetas. Se cumple en toda su lista de precios (los
// tres Mazda 2 del formato van exactamente +1.500.000).
//
// Lo que se fija aquí es sobre todo QUÉ cuenta como camioneta, que es
// la parte que un lector de otro país no puede adivinar del código.
// ============================================================

describe('suggestedWarrantyPrice', () => {
  it('suma 1,5 M a un vehículo de pasajeros', () => {
    for (const body of ['sedan', 'hatchback', 'coupe', 'wagon', 'convertible']) {
      expect(suggestedWarrantyPrice(62_000_000, body)).toBe(63_500_000)
    }
  })

  it('suma 2 M a una camioneta', () => {
    // En Colombia "camioneta" cubre SUV, pick-up y van.
    for (const body of ['suv', 'pickup', 'van']) {
      expect(suggestedWarrantyPrice(62_000_000, body)).toBe(64_000_000)
    }
  })

  it('trata como vehículo lo que no tiene carrocería declarada', () => {
    // Es el recargo menor: proponer de más obligaría al operador a
    // corregir a la baja, que es el error que sí cuesta una venta.
    expect(suggestedWarrantyPrice(62_000_000, null)).toBe(63_500_000)
    expect(suggestedWarrantyPrice(62_000_000, undefined)).toBe(63_500_000)
    expect(suggestedWarrantyPrice(62_000_000, 'other')).toBe(63_500_000)
  })

  it('reproduce las tres filas del formato del cliente', () => {
    // Mazda 2, todos sedán/hatchback → +1,5 M.
    expect(suggestedWarrantyPrice(62_000_000, 'hatchback')).toBe(63_500_000)
    expect(suggestedWarrantyPrice(75_000_000, 'hatchback')).toBe(76_500_000)
    expect(suggestedWarrantyPrice(73_000_000, 'hatchback')).toBe(74_500_000)
  })

  it('no propone nada sin precio del que partir', () => {
    // Devolver solo el recargo dejaría "1.500.000" en el campo como si
    // fuera un precio de venta.
    expect(suggestedWarrantyPrice(null, 'sedan')).toBeNull()
    expect(suggestedWarrantyPrice(undefined, 'sedan')).toBeNull()
    expect(suggestedWarrantyPrice(0, 'sedan')).toBeNull()
    expect(suggestedWarrantyPrice(Number.NaN, 'sedan')).toBeNull()
  })

  it('expone los recargos como constantes, no como números sueltos', () => {
    expect(WARRANTY_MARKUP.vehicle).toBe(1_500_000)
    expect(WARRANTY_MARKUP.camioneta).toBe(2_000_000)
  })
})
