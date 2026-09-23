import { describe, it, expect } from 'vitest'
import { primerNombre } from './pick-agent'

// La elección del asesor (continuidad del contacto, preferido,
// porcentajes) se prueba en la base: supabase/tests/
// sticky_weighted_assignment.test.sql. Acá queda solo el nombre con el
// que el asesor se presenta al cliente.
describe('primerNombre', () => {
  it('se queda con el primer nombre', () => {
    expect(primerNombre('Juan Marino Arias Medina')).toBe('Juan')
  })

  it('tolera espacios de sobra', () => {
    expect(primerNombre('  Brayan   Hernández ')).toBe('Brayan')
  })

  it('sin nombre devuelve null, para no prometer a nadie', () => {
    expect(primerNombre('')).toBeNull()
    expect(primerNombre('   ')).toBeNull()
    expect(primerNombre(null)).toBeNull()
    expect(primerNombre(undefined)).toBeNull()
  })
})
