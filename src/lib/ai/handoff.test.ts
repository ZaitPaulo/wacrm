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
      '🤖 AI agent handed off after 2 replies.\nLast customer message: “I want a refund”',
    )
  })

  it('uses the singular "reply" for a count of one', () => {
    const summary = buildHandoffSummary({
      messages: [{ role: 'user', content: 'help' }],
      replyCount: 1,
    })
    expect(summary).toContain('after 1 reply.')
  })

  it('says "without replying" when the bot bailed on the first inbound', () => {
    const summary = buildHandoffSummary({
      messages: [{ role: 'user', content: 'agent please' }],
      replyCount: 0,
    })
    expect(summary).toContain('handed off without replying.')
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
    // 160-char cap on the quote; the whole note stays well under 250.
    expect(summary.length).toBeLessThan(250)
  })

  it('degrades gracefully when there is no customer message', () => {
    const summary = buildHandoffSummary({
      messages: [{ role: 'assistant', content: 'greeting' }],
      replyCount: 0,
    })
    expect(summary).toBe('🤖 AI agent handed off without replying.')
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
    expect(summary).toContain('Motivo: credito')
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

  it('mantiene la nota corta cuando no hubo petición (camino de fallo)', () => {
    const summary = buildHandoffSummary({ messages, replyCount: 0 })
    expect(summary).not.toContain('Motivo:')
  })
})
