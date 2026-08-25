import { describe, expect, it } from 'vitest'
import { splitHours } from './format'

describe('splitHours', () => {
  it('splits on newlines, which is what the textarea produces', () => {
    expect(splitHours('Lunes a viernes 8-6\nSábados 8-2')).toEqual([
      'Lunes a viernes 8-6',
      'Sábados 8-2',
    ])
  })

  it('splits on the middle dot used by the values already stored', () => {
    expect(
      splitHours(
        'Lunes a viernes de 8:00 a. m. a 6:00 p. m. · Sábados de 8:00 a. m. a 2:00 p. m. · Domingos y festivos cerrado',
      ),
    ).toEqual([
      'Lunes a viernes de 8:00 a. m. a 6:00 p. m.',
      'Sábados de 8:00 a. m. a 2:00 p. m.',
      'Domingos y festivos cerrado',
    ])
  })

  it('splits on semicolons too', () => {
    expect(splitHours('Lun-Vie 8-6; Sab 8-2')).toEqual(['Lun-Vie 8-6', 'Sab 8-2'])
  })

  it('keeps the periods inside a line intact', () => {
    // El punto de "a. m." no debe partir nada: solo separan \n, · y ;.
    expect(splitHours('Sábados de 8:00 a. m. a 2:00 p. m.')).toEqual([
      'Sábados de 8:00 a. m. a 2:00 p. m.',
    ])
  })

  it('collapses blank lines instead of rendering empty rows', () => {
    expect(splitHours('Lunes a viernes\n\n\nSábados')).toEqual([
      'Lunes a viernes',
      'Sábados',
    ])
  })

  it('returns an empty list for nothing to show', () => {
    expect(splitHours(null)).toEqual([])
    expect(splitHours(undefined)).toEqual([])
    expect(splitHours('')).toEqual([])
    expect(splitHours('   \n  ')).toEqual([])
  })

  it('leaves a single line as one line', () => {
    expect(splitHours('Todos los días 8-8')).toEqual(['Todos los días 8-8'])
  })
})
