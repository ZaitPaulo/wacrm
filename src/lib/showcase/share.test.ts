import { describe, expect, it } from 'vitest'
import {
  vehicleShareMessage,
  vehicleShareUrl,
  whatsappShareHref,
  type ShareableVehicle,
} from './share'

// Traductor de mentira: devuelve la última parte de la clave, que para
// estos catálogos alcanza para ver que la etiqueta salió del catálogo
// correcto ('automatic', 'gasoline') sin arrastrar los mensajes reales.
const t = (key: string) => key.split('.').pop() ?? key

const base: ShareableVehicle = {
  id: 'abc-123',
  brand: 'Toyota',
  model: 'Corolla',
  year: 2020,
  price: 85000000,
  mileage: 45000,
  transmission: 'automatic',
  fuel_type: 'gasoline',
}

describe('vehicleShareUrl', () => {
  it('arma la ruta pública de la ficha', () => {
    expect(vehicleShareUrl('https://loramotors.co', 'abc-123')).toBe(
      'https://loramotors.co/vehiculo/abc-123',
    )
  })

  it('tolera la barra final de la base', () => {
    expect(vehicleShareUrl('https://loramotors.co/', 'abc-123')).toBe(
      'https://loramotors.co/vehiculo/abc-123',
    )
  })
})

describe('vehicleShareMessage', () => {
  const url = 'https://loramotors.co/vehiculo/abc-123'

  it('pone título, especificaciones y el link en su propio párrafo', () => {
    expect(vehicleShareMessage(base, { currency: 'COP', url, t })).toBe(
      'Toyota Corolla 2020 — $85.000.000\n' +
        '45.000 km · automatic · gasoline\n' +
        '\n' +
        url,
    )
  })

  it('omite la línea de especificaciones cuando no hay ninguna', () => {
    const bare = { ...base, mileage: null, transmission: null, fuel_type: null }
    expect(vehicleShareMessage(bare, { currency: 'COP', url, t })).toBe(
      `Toyota Corolla 2020 — $85.000.000\n\n${url}`,
    )
  })

  it('no deja el guion largo de labelOf cuando falta un dato suelto', () => {
    const partial = { ...base, transmission: null }
    const msg = vehicleShareMessage(partial, { currency: 'COP', url, t })
    expect(msg).toContain('45.000 km · gasoline')
    expect(msg).not.toContain('empty')
  })

  it('usa el símbolo de la moneda de la cuenta', () => {
    const msg = vehicleShareMessage(base, { currency: 'EUR', url, t })
    expect(msg).toContain('€85.000.000')
  })
})

describe('whatsappShareHref', () => {
  it('abre wa.me sin destinatario para que el usuario elija el chat', () => {
    const href = whatsappShareHref('Hola\n\nhttps://loramotors.co/vehiculo/x')
    expect(href.startsWith('https://wa.me/?text=')).toBe(true)
  })

  it('escapa saltos de línea y el link', () => {
    const href = whatsappShareHref('a b\nc')
    expect(href).toBe('https://wa.me/?text=a%20b%0Ac')
  })
})
