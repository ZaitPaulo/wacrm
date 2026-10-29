import { describe, it, expect } from 'vitest'
import type { ContentType, Message, SenderType } from '@/types'
import { isOptimisticId, mergeIncomingMessage, newOptimisticId } from './optimistic-messages'

function msg(id: string, content_type: ContentType, overrides: Partial<Message> = {}): Message {
  return {
    id,
    conversation_id: 'conv-1',
    sender_type: (overrides.sender_type ?? 'agent') as SenderType,
    content_type,
    status: 'sending',
    created_at: '2026-10-28T10:00:00.000Z',
    ...overrides,
  }
}

const URL_1 = 'https://cdn.example/chat-media/a/1.jpg'
const URL_2 = 'https://cdn.example/chat-media/a/2.jpg'

describe('newOptimisticId', () => {
  it('genera ids distintos aunque se creen seguidos', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newOptimisticId()))
    expect(ids.size).toBe(50)
    for (const id of ids) expect(isOptimisticId(id)).toBe(true)
  })
})

describe('mergeIncomingMessage', () => {
  it('reemplaza solo la burbuja de la misma imagen y deja la que sigue en vuelo', () => {
    const prev = [
      msg('temp-a', 'image', { media_url: URL_1 }),
      msg('temp-b', 'image', { media_url: URL_2 }),
    ]
    const real = msg('real-1', 'image', { media_url: URL_1, status: 'sent' })

    const next = mergeIncomingMessage(prev, real)

    expect(next.map((m) => m.id)).toEqual(['temp-b', 'real-1'])
  })

  it('nunca reemplaza una burbuja fallida', () => {
    const prev = [msg('temp-a', 'image', { media_url: URL_1, status: 'failed' })]
    const real = msg('real-2', 'image', { media_url: URL_2, status: 'sent' })

    const next = mergeIncomingMessage(prev, real)

    expect(next.map((m) => m.id)).toEqual(['temp-a', 'real-2'])
  })

  it('un mensaje del cliente no toca las burbujas optimistas', () => {
    const prev = [msg('temp-a', 'text')]
    const incoming = msg('real-c', 'text', { sender_type: 'customer' })

    const next = mergeIncomingMessage(prev, incoming)

    expect(next.map((m) => m.id)).toEqual(['temp-a', 'real-c'])
  })

  it('sin media_url empareja por tipo con la más antigua', () => {
    const prev = [msg('temp-img', 'image', { media_url: URL_1 }), msg('temp-t1', 'text'), msg('temp-t2', 'text')]
    const real = msg('real-t', 'text', { status: 'sent' })

    const next = mergeIncomingMessage(prev, real)

    expect(next.map((m) => m.id)).toEqual(['temp-img', 'temp-t2', 'real-t'])
  })

  it('si el tipo no coincide, reemplaza la más antigua para no duplicar', () => {
    const prev = [msg('temp-a', 'text')]
    const real = msg('real-x', 'template', { status: 'sent' })

    expect(mergeIncomingMessage(prev, real).map((m) => m.id)).toEqual(['real-x'])
  })

  it('ignora una fila que ya está en el hilo', () => {
    const prev = [msg('real-1', 'text', { status: 'sent' })]

    expect(mergeIncomingMessage(prev, prev[0])).toBe(prev)
  })
})
