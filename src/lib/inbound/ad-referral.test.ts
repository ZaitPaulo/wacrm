import { describe, it, expect } from 'vitest'
import { parseAdReferral } from './ad-referral'

// Forma documentada por Meta para los anuncios con clic a WhatsApp.
const REFERRAL = {
  source_url: 'https://fb.me/abc123',
  source_id: '120210000000000',
  source_type: 'ad',
  headline: 'Carros usados en Barranquilla',
  body: 'Financiación con bancos aliados. Escríbenos.',
  media_type: 'image',
  image_url: 'https://scontent.xx.fbcdn.net/foto.jpg',
  ctwa_clid: 'ARAkLkA8rmlFeiCktEJQ',
}

describe('parseAdReferral', () => {
  it('conserva los campos que manda Meta', () => {
    expect(parseAdReferral(REFERRAL)).toEqual(REFERRAL)
  })

  it('acepta un referral parcial', () => {
    expect(parseAdReferral({ source_type: 'ad', source_id: '1' })).toEqual({
      source_type: 'ad',
      source_id: '1',
    })
  })

  it('descarta campos que no son texto y claves desconocidas', () => {
    expect(
      parseAdReferral({ source_type: 'ad', headline: 42, raro: 'x', welcome_message: { text: 'hola' } }),
    ).toEqual({ source_type: 'ad' })
  })

  it('devuelve null sin referral o con uno vacío', () => {
    expect(parseAdReferral(undefined)).toBeNull()
    expect(parseAdReferral(null)).toBeNull()
    expect(parseAdReferral('ad')).toBeNull()
    expect(parseAdReferral({})).toBeNull()
  })

  it('recorta textos desmedidos', () => {
    const out = parseAdReferral({ source_type: 'ad', body: 'x'.repeat(5000) })
    expect(out?.body).toHaveLength(1000)
  })
})
