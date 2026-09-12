import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildConversationContext } from './context'

interface Row {
  sender_type: string
  content_type?: string
  content_text: string | null
}

/** Fake of the query chain in buildConversationContext:
 *  from().select().eq()….order().limit() → { data, error }.
 *
 *  It APPLIES the column filters instead of ignoring them. The old fake
 *  returned every row whatever the query asked for, which is how a
 *  `content_type = 'text'` filter shipped that silently dropped photo
 *  captions — the test could not see the query at all. Rows come in
 *  newest-first, as `created_at DESC` would return them; a row without
 *  `content_type` is a plain text message. */
function fakeDb(rows: Row[]): SupabaseClient {
  let current: Record<string, unknown>[] = rows.map((r) => ({
    content_type: 'text',
    ...r,
  }))
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: (col: string, val: unknown) => {
      // The rows are already one conversation's.
      if (col !== 'conversation_id') current = current.filter((r) => r[col] === val)
      return chain
    },
    in: (col: string, vals: unknown[]) => {
      current = current.filter((r) => vals.includes(r[col]))
      return chain
    },
    not: (col: string, op: string, val: unknown) => {
      if (op === 'is' && val === null) current = current.filter((r) => r[col] != null)
      return chain
    },
    order: () => chain,
    limit: (n: number) => Promise.resolve({ data: current.slice(0, n), error: null }),
  }
  return chain as unknown as SupabaseClient
}

describe('buildConversationContext', () => {
  it('maps sender_type to role and returns chronological order', async () => {
    // DB returns newest-first (created_at DESC); the fn reverses it.
    const rows = [
      { sender_type: 'customer', content_text: 'third' },
      { sender_type: 'agent', content_text: 'second' },
      { sender_type: 'customer', content_text: 'first' },
    ]
    const out = await buildConversationContext(fakeDb(rows), 'conv-1')
    expect(out).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'user', content: 'third' },
    ])
  })

  it('treats bot messages as assistant', async () => {
    const out = await buildConversationContext(
      fakeDb([{ sender_type: 'bot', content_text: 'auto reply' }]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'assistant', content: 'auto reply' }])
  })

  it('drops empty / whitespace-only messages', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'customer', content_text: '   ' },
        { sender_type: 'customer', content_text: null },
        { sender_type: 'customer', content_text: 'real' },
      ]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: 'real' }])
  })

  // Produccion, 2026-09-12: el cliente mando la captura de un carro con
  // su pregunta en el pie de foto. El despacho a la IA si la vio (trae
  // texto), pero el contexto la descarto por no ser `text`: el modelo
  // recibio una conversacion que terminaba en nuestro "¿en qué te puedo
  // ayudar?", Gemini respondio 400 y el hilo se traspaso por "fallo del
  // proveedor" sin que nadie leyera la pregunta.
  it('keeps the caption of a photo the customer sent, as the last user turn', async () => {
    const out = await buildConversationContext(
      fakeDb([
        {
          sender_type: 'customer',
          content_type: 'image',
          content_text: 'Estoy interesado en el crédito para el ónix activ, cuento con inicial',
        },
        { sender_type: 'bot', content_text: 'Cuéntame, ¿en qué te puedo ayudar?' },
      ]),
      'conv-1',
    )
    expect(out).toEqual([
      { role: 'assistant', content: 'Cuéntame, ¿en qué te puedo ayudar?' },
      {
        role: 'user',
        content: '[Foto] Estoy interesado en el crédito para el ónix activ, cuento con inicial',
      },
    ])
  })

  it('labels every kind of media that carries text, whoever sent it', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'customer', content_type: 'location', content_text: 'Barrio Boston' },
        { sender_type: 'customer', content_type: 'document', content_text: 'extracto.pdf' },
        { sender_type: 'customer', content_type: 'video', content_text: 'así suena el motor' },
        { sender_type: 'agent', content_type: 'image', content_text: 'Onix 2019, 45.000 km' },
      ]),
      'conv-1',
    )
    expect(out).toEqual([
      { role: 'assistant', content: '[Foto] Onix 2019, 45.000 km' },
      { role: 'user', content: '[Video] así suena el motor' },
      { role: 'user', content: '[Documento] extracto.pdf' },
      { role: 'user', content: '[Ubicación] Barrio Boston' },
    ])
  })

  it('leaves out media with no text: there is nothing in it to model', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'customer', content_type: 'audio', content_text: null },
        { sender_type: 'customer', content_type: 'image', content_text: null },
        { sender_type: 'customer', content_text: 'hola' },
      ]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: 'hola' }])
  })

  it('does not let captionless photos eat the context window', async () => {
    // The textless rows must be filtered in the query, before the limit;
    // filtering after it would hand the model fewer turns than asked.
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'customer', content_type: 'image', content_text: null },
        { sender_type: 'customer', content_type: 'image', content_text: null },
        { sender_type: 'customer', content_text: 'second' },
        { sender_type: 'bot', content_text: 'first' },
      ]),
      'conv-1',
      2,
    )
    expect(out).toEqual([
      { role: 'assistant', content: 'first' },
      { role: 'user', content: 'second' },
    ])
  })
})
