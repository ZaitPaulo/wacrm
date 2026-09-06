import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BRAND_COLOR,
  requestPhotosHref,
  resolveBrandColor,
  splitHours,
} from './format'

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

describe('resolveBrandColor', () => {
  it('returns valid 6-digit hex color as provided', () => {
    expect(resolveBrandColor('#e21b22')).toBe('#e21b22')
    expect(resolveBrandColor('#E21B22')).toBe('#E21B22')
    expect(resolveBrandColor('#0059bb')).toBe('#0059bb')
    expect(resolveBrandColor('#123456')).toBe('#123456')
  })

  it('falls back to DEFAULT_BRAND_COLOR for null, undefined or empty string', () => {
    expect(resolveBrandColor(null)).toBe(DEFAULT_BRAND_COLOR)
    expect(resolveBrandColor(undefined)).toBe(DEFAULT_BRAND_COLOR)
    expect(resolveBrandColor('')).toBe(DEFAULT_BRAND_COLOR)
    expect(resolveBrandColor('   ')).toBe(DEFAULT_BRAND_COLOR)
  })

  it('falls back to DEFAULT_BRAND_COLOR for invalid formats', () => {
    expect(resolveBrandColor('red')).toBe(DEFAULT_BRAND_COLOR)
    expect(resolveBrandColor('#fff')).toBe(DEFAULT_BRAND_COLOR)
    expect(resolveBrandColor('#12345')).toBe(DEFAULT_BRAND_COLOR)
    expect(resolveBrandColor('#1234567')).toBe(DEFAULT_BRAND_COLOR)
    expect(resolveBrandColor('123456')).toBe(DEFAULT_BRAND_COLOR)
    expect(resolveBrandColor('#gggggg')).toBe(DEFAULT_BRAND_COLOR)
    expect(resolveBrandColor('#12 456')).toBe(DEFAULT_BRAND_COLOR)
  })
})

describe('requestPhotosHref', () => {
  const baseVehicle = {
    brand: 'Renault',
    model: 'Duster',
    year: 2022,
  }

  it('strips non-digits from phone number and creates wa.me link', () => {
    const href = requestPhotosHref('+57 (300) 123-4567', baseVehicle)
    expect(href).toMatch(/^https:\/\/wa\.me\/573001234567\?text=/)
  })

  it('includes brand, model, year in message without ref tag when public_ref is missing', () => {
    const href = requestPhotosHref('573001234567', baseVehicle)
    const url = new URL(href)
    const text = url.searchParams.get('text') ?? ''
    expect(text).toContain('Renault')
    expect(text).toContain('Duster')
    expect(text).toContain('2022')
    expect(text).not.toContain('[Ref:')
  })

  it('appends formatted ref tag at the end when public_ref is present', () => {
    const href = requestPhotosHref('573001234567', {
      ...baseVehicle,
      public_ref: 'X7K2M9',
    })
    const url = new URL(href)
    const text = url.searchParams.get('text') ?? ''
    expect(text).toContain('Renault')
    expect(text).toContain('Duster')
    expect(text).toContain('2022')
    expect(text).toMatch(/\[Ref:\s*X7K2M9\]$/)
  })
})

