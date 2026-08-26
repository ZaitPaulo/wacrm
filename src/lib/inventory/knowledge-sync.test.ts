import { describe, expect, it } from 'vitest'
import { formatVehicleForKb } from './knowledge-sync'

// ============================================================
// Documento del knowledge base de un vehículo.
//
// Lo que se protege aquí es una regla de SEGURIDAD, no de formato: este
// texto alimenta las respuestas que el bot manda solo por WhatsApp
// cuando `auto_reply_enabled` está activo, y el prompt le dice al modelo
// que prefiera estos extractos para cualquier dato concreto. Todo lo que
// entre aquí es decible a un cliente.
//
// Las notas internas del inventario real traen el asesor, el banco de la
// prenda, el dueño anterior y observaciones como "2 reclamaciones de
// menor cuantía": nada de eso puede acabar en una respuesta automática.
// ============================================================

const base = {
  brand: 'MAZDA',
  model: '2 GRAND TOURING LX',
  year: 2018,
  price: 59_000_000,
  mileage: 90_500,
  color: 'MACHINE GRAY',
  transmission: 'automatic',
  engine_displacement: '1.5',
  plate_city: 'BARRANQUILLA',
  condition: 'used',
  features: {},
}

describe('formatVehicleForKb', () => {
  it('incluye lo que un comprador pregunta', () => {
    const { title, content } = formatVehicleForKb(base)
    expect(title).toBe('Vehículo: MAZDA 2 GRAND TOURING LX 2018')
    expect(content).toContain('59000000')
    expect(content).toContain('90500 km')
    expect(content).toContain('Color: MACHINE GRAY')
    expect(content).toContain('Transmisión: automática')
    expect(content).toContain('Motor: 1.5')
    expect(content).toContain('Placa de BARRANQUILLA')
    expect(content).toContain('Estado: usado')
  })

  it('traduce los códigos de specs en vez de volcar el enum', () => {
    expect(formatVehicleForKb({ ...base, transmission: 'manual' }).content).toContain(
      'Transmisión: mecánica',
    )
    expect(formatVehicleForKb({ ...base, condition: 'new' }).content).toContain(
      'Estado: nuevo',
    )
  })

  it('deja pasar un código desconocido tal cual en vez de romper', () => {
    const out = formatVehicleForKb({ ...base, transmission: 'dsg' }).content
    expect(out).toContain('Transmisión: dsg')
  })

  it('omite los campos que faltan sin dejar etiquetas huérfanas', () => {
    const out = formatVehicleForKb({
      ...base,
      mileage: null,
      color: null,
      transmission: null,
      engine_displacement: null,
      plate_city: null,
      condition: null,
    }).content
    expect(out).toBe('Vehículo disponible: MAZDA 2 GRAND TOURING LX 2018. Precio: 59000000.')
  })

  it('aplana las características para el texto del documento', () => {
    const out = formatVehicleForKb({
      ...base,
      features: { 'Aire acondicionado': true, Sunroof: 'sí' },
    }).content
    expect(out).toContain('Detalles: Aire acondicionado, Sunroof: sí.')
  })

  // El objeto que se le pasa ya no tiene ni internal_notes ni vin: el
  // select de syncVehicleKnowledge dejó de pedirlos. Si alguien los
  // vuelve a añadir, este test falla y obliga a justificarlo.
  it('no puede filtrar notas internas ni VIN aunque se los pasen', () => {
    const out = formatVehicleForKb({
      ...base,
      internal_notes: 'Asesor: BRAYAN | Banco: BANCOLOMBIA | Obs: 2 RECLAMACIONES',
      vin: '1HGBH41JXMN109186',
    } as Parameters<typeof formatVehicleForKb>[0])
    expect(out.content).not.toContain('BRAYAN')
    expect(out.content).not.toContain('BANCOLOMBIA')
    expect(out.content).not.toContain('RECLAMACIONES')
    expect(out.content).not.toContain('1HGBH41JXMN109186')
    expect(out.content.toLowerCase()).not.toContain('notas')
  })
})
