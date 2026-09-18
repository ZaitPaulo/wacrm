import { describe, it, expect } from 'vitest'
import { ensureVehicleLinks } from './vehicle-links'
import type { InventoryEntry } from './inventory-index'

const BASE = 'https://loramotors.co/vehiculo'

function entry(overrides: Partial<InventoryEntry> & { id: string }): InventoryEntry {
  return {
    brand: 'KIA',
    model: 'SORENTO RADICAL',
    year: 2015,
    price: 64_000_000,
    url: `${BASE}/${overrides.id}`,
    ...overrides,
  }
}

const SORENTO = entry({ id: 'sorento' })
const SPORTAGE = entry({ id: 'sportage', model: 'NEW SPORTAGE LX', year: 2011, price: 46_000_000 })
const MARCH_17 = entry({ id: 'march17', brand: 'NISSAN', model: 'MARCH', year: 2017, price: 37_000_000 })
const MARCH_ADV = entry({
  id: 'march16',
  brand: 'NISSAN',
  model: 'MARCH ADVANCE',
  year: 2016,
  price: 39_000_000,
})
const BEAT_A = entry({ id: 'beat-a', brand: 'CHEVROLET', model: 'BEAT LT', year: 2020, price: 45_500_000 })
const BEAT_B = entry({ id: 'beat-b', brand: 'CHEVROLET', model: 'BEAT LT', year: 2020, price: 47_000_000 })

describe('ensureVehicleLinks', () => {
  // El caso real del 2026-09-17, con la Sportage y la Sorento sin enlace.
  it('agrega el enlace de los vehículos nombrados que no lo traen', () => {
    const text =
      'Tengo varias que te entran:\n\n' +
      'Una Kia New Sportage LX 2011 automática en $46.000.000.\n\n' +
      `Una Kia Sorento LX 2013 en $50.000.000: ${BASE}/otro\n\n` +
      'Y una Kia Sorento Radical 2015, también automática, en $64.000.000.'
    const out = ensureVehicleLinks(text, [SORENTO, SPORTAGE])
    expect(out.startsWith(text)).toBe(true)
    expect(out).toContain(`${BASE}/sportage`)
    expect(out).toContain(`${BASE}/sorento`)
  })

  it('no toca un texto que ya trae todos los enlaces', () => {
    const text = `Una Kia Sorento Radical 2015 en $64.000.000:\n${BASE}/sorento`
    expect(ensureVehicleLinks(text, [SORENTO])).toBe(text)
  })

  it('no agrega nada por una mención sin año', () => {
    const text = 'También hay Kia Sorento y Nissan March, ¿te muestro?'
    expect(ensureVehicleLinks(text, [SORENTO, MARCH_17])).toBe(text)
  })

  it('no confunde dos versiones del mismo modelo', () => {
    const text = 'Un Nissan March Advance 2016 automático en $39.000.000.'
    const out = ensureVehicleLinks(text, [MARCH_17, MARCH_ADV])
    expect(out).toContain(`${BASE}/march16`)
    expect(out).not.toContain(`${BASE}/march17`)
  })

  it('reconoce el modelo nombrado por su primera palabra', () => {
    const text = 'Un Nissan March 2017 mecánico en $37.000.000.'
    const out = ensureVehicleLinks(text, [MARCH_17, MARCH_ADV])
    expect(out).toContain(`${BASE}/march17`)
    expect(out).not.toContain(`${BASE}/march16`)
  })

  it('ignora mayúsculas y tildes', () => {
    const text = 'la KIA SORENTO RADICAL 2015 está en 64 millones'
    expect(ensureVehicleLinks(text, [SORENTO])).toContain(`${BASE}/sorento`)
  })

  it('exige que el año vaya pegado al modelo', () => {
    const text = 'La Sorento Radical es muy buena. Por cierto, el Rio es 2015.'
    expect(ensureVehicleLinks(text, [SORENTO])).toBe(text)
  })

  it('desempata por precio cuando hay dos iguales', () => {
    const text = 'El Chevrolet Beat LT 2020 en $47.000.000 te sirve.'
    const out = ensureVehicleLinks(text, [BEAT_A, BEAT_B])
    expect(out).toContain(`${BASE}/beat-b`)
    expect(out).not.toContain(`${BASE}/beat-a`)
  })

  it('manda los dos cuando el precio no desempata', () => {
    const text = 'Tengo el Chevrolet Beat LT 2020, cuéntame si te gusta.'
    const out = ensureVehicleLinks(text, [BEAT_A, BEAT_B])
    expect(out).toContain(`${BASE}/beat-a`)
    expect(out).toContain(`${BASE}/beat-b`)
  })

  it('da por cubierto el grupo si ya trae el enlace de uno de los iguales', () => {
    const text = `El Chevrolet Beat LT 2020:\n${BASE}/beat-a`
    expect(ensureVehicleLinks(text, [BEAT_A, BEAT_B])).toBe(text)
  })

  it('agrega como mucho tres enlaces', () => {
    const muchos = [1, 2, 3, 4].map((n) =>
      entry({ id: `m${n}`, model: `MODELO${n}`, year: 2010 + n, price: n * 10_000_000 }),
    )
    const text = 'Modelo1 2011, Modelo2 2012, Modelo3 2013 y Modelo4 2014.'
    const out = ensureVehicleLinks(text, muchos)
    expect(out.match(/\/vehiculo\//g)).toHaveLength(3)
  })

  it('reconoce modelos con guion o sin él', () => {
    const bt = entry({ id: 'bt50', brand: 'MAZDA', model: 'BT 50 4X4 GASOLINA', year: 2011, price: 60_000_000 })
    const cx = entry({ id: 'cx30', brand: 'MAZDA', model: 'CX-30 TOURING', year: 2022, price: 95_000_000 })
    expect(ensureVehicleLinks('La Mazda BT 50 2011 automática.', [bt])).toContain(`${BASE}/bt50`)
    expect(ensureVehicleLinks('La Mazda BT-50 2011 automática.', [bt])).toContain(`${BASE}/bt50`)
    expect(ensureVehicleLinks('Una Mazda CX30 2022.', [cx])).toContain(`${BASE}/cx30`)
    expect(ensureVehicleLinks('Una Mazda CX-30 Touring 2022.', [cx])).toContain(`${BASE}/cx30`)
  })

  it('reconoce un modelo de un carácter por la marca', () => {
    const m3 = entry({ id: 'm3', brand: 'MAZDA', model: '3 TOURING', year: 2021, price: 86_000_000 })
    expect(ensureVehicleLinks('un Mazda 3 2021 automático', [m3])).toContain(`${BASE}/m3`)
    expect(ensureVehicleLinks('tengo 3 opciones del 2021', [m3])).toBe('tengo 3 opciones del 2021')
  })

  it('escribe las siglas del modelo en mayúsculas', () => {
    const rio = entry({ id: 'rio', model: 'RIO UB EX', year: 2018, price: 49_000_000 })
    expect(ensureVehicleLinks('Un Kia Rio UB EX 2018.', [rio])).toContain(
      `Kia Rio UB EX 2018: ${BASE}/rio`,
    )
    const onix = entry({ id: 'onix', brand: 'CHEVROLET', model: 'ONIX LTZ', year: 2017, price: 41_000_000 })
    expect(ensureVehicleLinks('Un Chevrolet Onix LTZ 2017.', [onix])).toContain('Chevrolet Onix LTZ 2017')
  })

  it('ignora los vehículos sin URL', () => {
    const text = 'Una Kia Sorento Radical 2015.'
    expect(ensureVehicleLinks(text, [{ ...SORENTO, url: null }])).toBe(text)
  })
})
