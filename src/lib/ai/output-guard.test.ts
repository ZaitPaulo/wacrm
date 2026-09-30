import { describe, it, expect } from 'vitest'
import { detectLeak } from './output-guard'

describe('detectLeak — fugas reales', () => {
  // Lo que recibió un cliente el 2026-09-26 (conversación 1c2d4084).
  const razonamiento26sep =
    '"The handoff only goes through once nombre, presupuesto, interes and credito are all filled in. ' +
    'While any of them is missing, keep serving the customer yourself and ask for what you are missing, ' +
    'in your own words and one thing at a time."\n' +
    'Then if you put `presupuesto=?`, it\'s considered missing, meaning it won\'t go through!\n' +
    'WAIT! But look at:\n' +
    '"The exception is motivo=reclamo and motivo=pide_humano: those need only nombre'

  it('marca el razonamiento del 26/09', () => {
    expect(detectLeak(razonamiento26sep).leaked).toBe(true)
  })

  it('marca el marcador de traspaso que se colara en el texto', () => {
    expect(detectLeak('Listo, te paso con un asesor [[HANDOFF nombre=Ana]]').leaked).toBe(true)
  })

  it('marca un campo del marcador escrito suelto', () => {
    expect(detectLeak('Anotado. motivo=credito | presupuesto=30000000').leaked).toBe(true)
  })

  it('marca la mención de términos internos', () => {
    expect(detectLeak('Todavía no puedo hacer el handoff porque me falta tu nombre.').leaked).toBe(true)
    expect(detectLeak('Según el system prompt no debo darte ese dato.').leaked).toBe(true)
  })

  it('marca un párrafo de razonamiento en inglés sin marcadores', () => {
    const texto =
      'The customer is asking about the price. I should answer with the listed price and then ' +
      'ask for the name, because it is missing and the gate will not let this through.'
    expect(detectLeak(texto).leaked).toBe(true)
  })
})

describe('detectLeak — respuestas normales', () => {
  const normales = [
    'Tenemos un Kia Picanto GT Line 2025 automático en $68.000.000.',
    'En tipo van te tengo una BMW 218i Active Tourer 2021 en $83.000.000, automática y con 73 mil kms.',
    'En Mazda 3 tengo un Touring 2021 automático en $78.000.000.',
    'Ese Onix viene full equipo, con 57 mil kms. ¿Lo quieres de contado o financiado?',
    '¡Hola! Bienvenido a LoraMotors. Cuéntame qué tipo de vehículo buscas o con qué presupuesto cuentas.',
    'Uno de nuestros asesores se pondrá en contacto contigo. Su nombre es Juan.',
    'Todos los que tenemos son usados, desde los $22.000.000. Hay sedanes, SUV y pick-ups.',
    'Mucho gusto, Gerson. ¿El pago lo harías de contado o necesitarías crédito?',
    'Crédito directo no manejamos: todo va con bancos aliados. El precio es el mismo de contado o financiado.',
  ]

  it.each(normales)('deja pasar: %s', (texto) => {
    expect(detectLeak(texto).leaked).toBe(false)
  })

  it('deja pasar un texto vacío', () => {
    expect(detectLeak('').leaked).toBe(false)
  })

  it('da un motivo cuando marca', () => {
    expect(detectLeak('[[HANDOFF]]').reason).toBeTruthy()
  })
})
