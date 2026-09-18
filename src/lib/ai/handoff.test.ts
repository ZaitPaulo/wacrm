import { describe, it, expect } from 'vitest'
import { buildHandoffSummary } from './handoff'

describe('buildHandoffSummary', () => {
  it('notes the reply count and quotes the last customer message', () => {
    const summary = buildHandoffSummary({
      messages: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello! How can I help?' },
        { role: 'user', content: 'I want a refund' },
      ],
      replyCount: 2,
    })
    expect(summary).toBe(
      '🤖 El bot traspasó la conversación tras 2 respuestas.\nÚltimo mensaje del cliente: “I want a refund”',
    )
  })

  it('uses the singular "reply" for a count of one', () => {
    const summary = buildHandoffSummary({
      messages: [{ role: 'user', content: 'help' }],
      replyCount: 1,
    })
    expect(summary).toContain('tras 1 respuesta.')
  })

  it('says "without replying" when the bot bailed on the first inbound', () => {
    const summary = buildHandoffSummary({
      messages: [{ role: 'user', content: 'agent please' }],
      replyCount: 0,
    })
    expect(summary).toContain('sin alcanzar a responder.')
    expect(summary).toContain('“agent please”')
  })

  it('picks the most recent customer turn, ignoring assistant turns', () => {
    const summary = buildHandoffSummary({
      messages: [
        { role: 'user', content: 'first' },
        { role: 'user', content: 'second' },
        { role: 'assistant', content: 'a reply' },
      ],
      replyCount: 1,
    })
    expect(summary).toContain('“second”')
  })

  it('collapses whitespace and truncates a long message', () => {
    const long = 'x'.repeat(300)
    const summary = buildHandoffSummary({
      messages: [{ role: 'user', content: long }],
      replyCount: 0,
    })
    expect(summary).toContain('…')
    // Tope de 160 caracteres para la cita; con la cabecera en español
    // la nota entera se queda holgadamente por debajo de 300.
    expect(summary.length).toBeLessThan(300)
  })

  it('degrades gracefully when there is no customer message', () => {
    const summary = buildHandoffSummary({
      messages: [{ role: 'assistant', content: 'greeting' }],
      replyCount: 0,
    })
    expect(summary).toBe('🤖 El bot traspasó la conversación sin alcanzar a responder.')
  })
})

describe('buildHandoffSummary — datos recolectados', () => {
  const messages = [{ role: 'user' as const, content: 'me interesa la sportage' }]

  it('lista los cuatro datos y el motivo', () => {
    const summary = buildHandoffSummary({
      messages,
      replyCount: 3,
      request: {
        nombre: 'Carlos',
        presupuesto: '30000000',
        interes: 'Kia Sportage 2019',
        credito: true,
        motivo: 'credito',
      },
    })
    expect(summary).toContain('Motivo: crédito')
    expect(summary).toContain('Nombre: Carlos')
    expect(summary).toContain('Presupuesto: 30000000')
    expect(summary).toContain('Interés: Kia Sportage 2019')
    expect(summary).toContain('Crédito: sí')
  })

  // Un campo ausente tiene que verse. Si se omitiera, el asesor no
  // podría distinguir "no lo preguntamos" de "la nota salió corta".
  it('marca los faltantes de una transferencia urgente', () => {
    const summary = buildHandoffSummary({
      messages,
      replyCount: 1,
      urgent: true,
      request: {
        nombre: 'Ana',
        presupuesto: null,
        interes: null,
        credito: null,
        motivo: 'reclamo',
      },
    })
    expect(summary).toContain('(urgente)')
    expect(summary).toContain('Presupuesto: (falta)')
    expect(summary).toContain('Interés: (falta)')
    expect(summary).toContain('Crédito: (falta)')
  })

  it('distingue crédito no de crédito desconocido', () => {
    const summary = buildHandoffSummary({
      messages,
      replyCount: 1,
      request: {
        nombre: 'Luis',
        presupuesto: '50000000',
        interes: 'sedán',
        credito: false,
        motivo: 'visita',
      },
    })
    expect(summary).toContain('Crédito: no')
  })

  it('con crédito, agrega ocupación e ingresos', () => {
    const summary = buildHandoffSummary({
      messages,
      replyCount: 4,
      request: {
        nombre: 'Laura',
        presupuesto: '30 millones inicial',
        interes: 'camioneta 4x4',
        credito: true,
        ocupacion: 'comerciante independiente',
        ingresos: null,
        motivo: 'credito',
      },
    })
    expect(summary).toContain('Ocupación: comerciante independiente · Ingresos: (falta)')
  })

  it('de contado no muestra la línea del perfil de crédito', () => {
    const summary = buildHandoffSummary({
      messages,
      replyCount: 1,
      request: {
        nombre: 'Luis',
        presupuesto: '50000000',
        interes: 'sedán',
        credito: false,
        motivo: 'visita',
      },
    })
    expect(summary).not.toContain('Ocupación')
  })

  it('dice de qué anuncio vino el cliente', () => {
    const summary = buildHandoffSummary({
      messages,
      replyCount: 2,
      ad: { headline: 'Carros usados en Barranquilla' },
    })
    expect(summary).toContain('Origen: anuncio · Carros usados en Barranquilla')
  })

  it('marca el origen aunque el anuncio no traiga titular', () => {
    const summary = buildHandoffSummary({ messages, replyCount: 2, ad: {} })
    expect(summary).toContain('Origen: anuncio')
  })

  // El asesor lee la nota: un código interno como `pide_humano` no le
  // dice nada.
  it('escribe el motivo como texto legible', () => {
    const base = { nombre: 'Ana', presupuesto: null, interes: null, credito: null }
    const nota = (motivo: 'pide_humano' | 'negociacion') =>
      buildHandoffSummary({ messages, replyCount: 1, request: { ...base, motivo } })
    expect(nota('pide_humano')).toContain('Motivo: pidió hablar con una persona')
    expect(nota('negociacion')).toContain('Motivo: negociación')
  })

  it('para quien vende su carro, dice qué carro ofrece y no pide presupuesto ni crédito', () => {
    const summary = buildHandoffSummary({
      messages,
      replyCount: 4,
      request: {
        nombre: 'Luis Miguel',
        presupuesto: null,
        interes: 'Citroën C3 2024, 50 mil km, placa de Sincelejo, pide $62.000.000',
        credito: null,
        motivo: 'vende_su_carro',
      },
    })
    expect(summary).toContain('Motivo: quiere vender su carro')
    expect(summary).toContain('Su carro: Citroën C3 2024, 50 mil km, placa de Sincelejo, pide $62.000.000')
    expect(summary).not.toContain('Presupuesto')
    expect(summary).not.toContain('Crédito')
  })

  it('para quien no encontró lo que busca, lo dice así', () => {
    const summary = buildHandoffSummary({
      messages,
      replyCount: 4,
      request: { nombre: 'Miguel', presupuesto: '20 millones de contado', interes: 'carro 1.2 económico', credito: false, motivo: 'sin_stock' },
    })
    expect(summary).toContain('Motivo: no hay lo que busca')
    expect(summary).toContain('Interés: carro 1.2 económico')
  })

  it('mantiene la nota corta cuando no hubo petición (camino de fallo)', () => {
    const summary = buildHandoffSummary({ messages, replyCount: 0 })
    expect(summary).not.toContain('Motivo:')
  })
})
