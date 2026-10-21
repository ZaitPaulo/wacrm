import { describe, it, expect } from 'vitest'
import { mergeConsecutive, providerHttpError } from './shared'
import type { ChatMessage } from '../types'

const A = { mimeType: 'image/jpeg', base64: 'AAAA' }
const B = { mimeType: 'image/jpeg', base64: 'BBBB' }

describe('mergeConsecutive', () => {
  it('joins consecutive same-role turns with a blank line', () => {
    expect(
      mergeConsecutive([
        { role: 'user', content: 'a' },
        { role: 'user', content: 'b' },
        { role: 'assistant', content: 'c' },
      ]),
    ).toEqual([
      { role: 'user', content: 'a\n\nb' },
      { role: 'assistant', content: 'c' },
    ])
  })

  it('carries the photos of every merged turn, in order', () => {
    expect(
      mergeConsecutive([
        { role: 'user', content: '[Foto]', images: [A] },
        { role: 'user', content: '¿este cuánto?' },
        { role: 'user', content: '[Foto] y este', images: [B] },
      ]),
    ).toEqual([{ role: 'user', content: '[Foto]\n\n¿este cuánto?\n\n[Foto] y este', images: [A, B] }])
  })

  // toEqual treats an `images: undefined` as absent, so it can't tell.
  // The key must really be missing: the OpenAI-shaped adapter decides the
  // wire format on it, and a text-only turn must go out as it did before.
  it('leaves turns without photos without the images key', () => {
    const out = mergeConsecutive([
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
    ])
    expect(out[0]).not.toHaveProperty('images')
  })

  it('does not touch the caller’s turns', () => {
    const input: ChatMessage[] = [
      { role: 'user', content: 'a', images: [A] },
      { role: 'user', content: 'b', images: [B] },
    ]
    mergeConsecutive(input)
    expect(input).toEqual([
      { role: 'user', content: 'a', images: [A] },
      { role: 'user', content: 'b', images: [B] },
    ])
  })
})

describe('providerHttpError — saldo agotado', () => {
  function res(status: number, message: string): Response {
    return { status, json: async () => ({ error: { message } }) } as unknown as Response
  }

  it('un 402 es billing_exhausted', async () => {
    const err = await providerHttpError('Gemini', res(402, 'Your prepayment credits are depleted'))
    expect(err.code).toBe('billing_exhausted')
  })

  it('el mensaje de créditos agotados lo es aunque el status sea otro', async () => {
    const err = await providerHttpError('Gemini', res(429, 'Your prepayment credits are depleted.'))
    expect(err.code).toBe('billing_exhausted')
  })

  it('un 500 sigue siendo provider_error', async () => {
    const err = await providerHttpError('Gemini', res(500, 'Internal error'))
    expect(err.code).toBe('provider_error')
  })

  it('un 429 normal sigue siendo rate_limited', async () => {
    const err = await providerHttpError('Gemini', res(429, 'Resource exhausted'))
    expect(err.code).toBe('rate_limited')
  })
})
