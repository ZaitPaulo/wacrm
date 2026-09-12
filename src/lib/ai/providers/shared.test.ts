import { describe, it, expect } from 'vitest'
import { mergeConsecutive } from './shared'
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
