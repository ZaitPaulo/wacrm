import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import sharp from 'sharp'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from './types'

const m = vi.hoisted(() => ({
  getMediaUrl: vi.fn(),
  downloadMedia: vi.fn(),
  decrypt: vi.fn(),
}))

vi.mock('@/lib/whatsapp/meta-api', () => ({
  getMediaUrl: m.getMediaUrl,
  downloadMedia: m.downloadMedia,
}))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: m.decrypt }))

import {
  attachPhotos,
  downloadPhotos,
  loadNewCustomerPhotos,
  pickNewCustomerPhotos,
  type PhotoScanRow,
} from './photos'

// ------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------

let seq = 0
function row(
  sender_type: PhotoScanRow['sender_type'],
  content_type = 'text',
  opts: { status?: string; media_url?: string | null } = {},
): PhotoScanRow {
  seq += 1
  return {
    id: `m${seq}`,
    sender_type,
    content_type,
    status: opts.status ?? 'sent',
    media_url: opts.media_url ?? (content_type === 'image' ? `/api/whatsapp/media/wa-${seq}` : null),
  }
}
const photo = (media_url?: string) => row('customer', 'image', { media_url })

/** A real JPEG, so the reduction is checked on actual pixels. */
async function jpeg(width: number, height: number, orientation?: number): Promise<Buffer> {
  let img = sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 0, b: 0 } },
  }).jpeg()
  if (orientation) img = img.withMetadata({ orientation })
  return img.toBuffer()
}

async function sizeOf(base64: string) {
  const meta = await sharp(Buffer.from(base64, 'base64')).metadata()
  return { width: meta.width, height: meta.height, format: meta.format }
}

/** Fake of the two queries photos.ts makes: the WhatsApp token and the
 *  recent messages. It records the message query's ordering so the tie
 *  break can be asserted. */
function fakeDb(opts: {
  token?: string | null
  messages?: PhotoScanRow[]
} = {}) {
  const calls = { tables: [] as string[], orders: [] as [string, unknown][] }
  const db = {
    from: (table: string) => {
      calls.tables.push(table)
      if (table === 'whatsapp_config') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () =>
            Promise.resolve({
              data: opts.token === null ? null : { access_token: opts.token ?? 'enc-token' },
              error: null,
            }),
        }
        return chain
      }
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: (col: string, o: unknown) => {
          calls.orders.push([col, o])
          return chain
        },
        limit: () => Promise.resolve({ data: opts.messages ?? [], error: null }),
      }
      return chain
    },
  }
  return { db: db as unknown as SupabaseClient, calls }
}

beforeEach(() => {
  seq = 0
  m.getMediaUrl.mockReset()
  m.downloadMedia.mockReset()
  m.decrypt.mockReset()
  m.decrypt.mockReturnValue('tok')
  m.getMediaUrl.mockImplementation(async ({ mediaId }: { mediaId: string }) => ({
    url: `https://lookaside.example/${mediaId}`,
    mimeType: 'image/jpeg',
  }))
})
afterEach(() => vi.unstubAllEnvs())

// ------------------------------------------------------------
// 4.1 — which photos are new
// ------------------------------------------------------------

describe('pickNewCustomerPhotos', () => {
  // Rows arrive newest-first, as the query orders them.
  it('keeps only the customer photos sent after our last message', () => {
    const p1 = photo()
    const p3 = photo()
    const out = pickNewCustomerPhotos(
      [p3, row('customer'), row('bot'), p1],
      3,
    )
    expect(out).toEqual([p3])
  })

  it('does not count a failed send as our last message', () => {
    const p1 = photo()
    const p2 = photo()
    const out = pickNewCustomerPhotos(
      [p2, row('bot', 'text', { status: 'failed' }), p1, row('agent')],
      3,
    )
    // Oldest first, the way the conversation reads.
    expect(out).toEqual([p1, p2])
  })

  it('never returns a photo the business sent', () => {
    expect(pickNewCustomerPhotos([row('agent', 'image')], 3)).toEqual([])
  })

  it('keeps the most recent ones when there are more than the cap', () => {
    const ps = [photo(), photo(), photo(), photo(), photo()] // oldest → newest
    const out = pickNewCustomerPhotos([...ps].reverse(), 3)
    expect(out).toEqual(ps.slice(2))
  })

  it('counts every customer photo when the business never wrote', () => {
    const p1 = photo()
    const p2 = photo()
    expect(pickNewCustomerPhotos([p2, row('customer'), p1], 3)).toEqual([p1, p2])
  })

  it('returns nothing with a cap of 0', () => {
    expect(pickNewCustomerPhotos([photo()], 0)).toEqual([])
  })
})

// ------------------------------------------------------------
// 4.2 — download and reduction
// ------------------------------------------------------------

describe('downloadPhotos', () => {
  function serve(buffer: Buffer, contentType = 'image/jpeg') {
    m.downloadMedia.mockResolvedValue({ buffer, contentType })
  }

  it('reduces a large photo to 1536 px on its long side, as JPEG', async () => {
    serve(await jpeg(3000, 4000))
    const { db } = fakeDb()
    const [img] = await downloadPhotos({
      db,
      accountId: 'acct-1',
      photos: [photo()],
      timeoutMs: 1000,
    })
    expect(img.mimeType).toBe('image/jpeg')
    expect(await sizeOf(img.base64)).toEqual({ width: 1152, height: 1536, format: 'jpeg' })
  })

  it('leaves a small photo at its own size', async () => {
    serve(await jpeg(800, 600))
    const { db } = fakeDb()
    const [img] = await downloadPhotos({
      db,
      accountId: 'acct-1',
      photos: [photo()],
      timeoutMs: 1000,
    })
    expect(await sizeOf(img.base64)).toMatchObject({ width: 800, height: 600 })
  })

  // A phone photo held upright is stored sideways plus an EXIF tag. The
  // model gets no metadata, so without applying it the car lies on its side.
  it('applies the EXIF orientation', async () => {
    serve(await jpeg(400, 200, 6))
    const { db } = fakeDb()
    const [img] = await downloadPhotos({
      db,
      accountId: 'acct-1',
      photos: [photo()],
      timeoutMs: 1000,
    })
    expect(await sizeOf(img.base64)).toMatchObject({ width: 200, height: 400 })
  })

  it('asks Meta for the id in the proxy URL, with the decrypted token', async () => {
    serve(await jpeg(10, 10))
    const { db } = fakeDb({ token: 'enc-xyz' })
    await downloadPhotos({
      db,
      accountId: 'acct-1',
      photos: [photo('/api/whatsapp/media/wamid-123')],
      timeoutMs: 1000,
    })
    expect(m.decrypt).toHaveBeenCalledWith('enc-xyz')
    expect(m.getMediaUrl).toHaveBeenCalledWith({ mediaId: 'wamid-123', accessToken: 'tok' })
  })

  it('skips a URL that is not the WhatsApp media proxy', async () => {
    const { db } = fakeDb()
    const out = await downloadPhotos({
      db,
      accountId: 'acct-1',
      photos: [photo('https://storage.example/foto.jpg')],
      timeoutMs: 1000,
    })
    expect(out).toEqual([])
    expect(m.getMediaUrl).not.toHaveBeenCalled()
  })

  it('drops a photo that fails and keeps the others, in order', async () => {
    const buffer = await jpeg(10, 10)
    m.getMediaUrl
      .mockRejectedValueOnce(new Error('Media fetch failed: 404'))
      .mockResolvedValueOnce({ url: 'https://lookaside.example/b', mimeType: 'image/jpeg' })
    serve(buffer)
    const { db } = fakeDb()
    const out = await downloadPhotos({
      db,
      accountId: 'acct-1',
      photos: [photo(), photo()],
      timeoutMs: 1000,
    })
    expect(out).toHaveLength(1)
  })

  it('drops a photo that takes longer than the time limit', async () => {
    m.getMediaUrl.mockReturnValue(new Promise(() => {}))
    const { db } = fakeDb()
    const out = await downloadPhotos({
      db,
      accountId: 'acct-1',
      photos: [photo()],
      timeoutMs: 20,
    })
    expect(out).toEqual([])
  })

  // WhatsApp manda los stickers en webp; la base los guarda como `image`.
  it('drops a webp as a sticker', async () => {
    serve(await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).webp().toBuffer(), 'image/webp')
    const { db } = fakeDb()
    const out = await downloadPhotos({
      db,
      accountId: 'acct-1',
      photos: [photo()],
      timeoutMs: 1000,
    })
    expect(out).toEqual([])
  })

  it('returns nothing, without throwing, when the WhatsApp token is missing', async () => {
    const { db } = fakeDb({ token: null })
    await expect(
      downloadPhotos({ db, accountId: 'acct-1', photos: [photo()], timeoutMs: 1000 }),
    ).resolves.toEqual([])
  })

  it('returns nothing, without throwing, when the token cannot be decrypted', async () => {
    m.decrypt.mockImplementation(() => {
      throw new Error('bad key')
    })
    const { db } = fakeDb()
    await expect(
      downloadPhotos({ db, accountId: 'acct-1', photos: [photo()], timeoutMs: 1000 }),
    ).resolves.toEqual([])
  })
})

describe('loadNewCustomerPhotos', () => {
  // WhatsApp da segundos: dos mensajes de la misma rafaga comparten
  // `created_at`. El id desempata, igual que en `hasOutboundSince`.
  it('orders the scan by time and then by id, newest first', async () => {
    const { db, calls } = fakeDb({ messages: [] })
    await loadNewCustomerPhotos(db, { accountId: 'acct-1', conversationId: 'conv-1' })
    expect(calls.orders).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ])
  })

  it('reports how many new photos there were even when none could be downloaded', async () => {
    m.getMediaUrl.mockRejectedValue(new Error('down'))
    const { db } = fakeDb({ messages: [photo(), row('bot')] })
    await expect(
      loadNewCustomerPhotos(db, { accountId: 'acct-1', conversationId: 'conv-1' }),
    ).resolves.toEqual({ count: 1, images: [] })
  })

  it('does not even query with vision turned off', async () => {
    vi.stubEnv('AI_VISION_MAX_IMAGES', '0')
    const { db, calls } = fakeDb({ messages: [photo()] })
    await expect(
      loadNewCustomerPhotos(db, { accountId: 'acct-1', conversationId: 'conv-1' }),
    ).resolves.toEqual({ count: 0, images: [] })
    expect(calls.tables).toEqual([])
  })
})

// ------------------------------------------------------------
// 5.1 — gluing the photos onto the conversation
// ------------------------------------------------------------

describe('attachPhotos', () => {
  const A = { mimeType: 'image/jpeg', base64: 'AAAA' }

  it('leaves the conversation alone when there were no new photos', () => {
    const messages: ChatMessage[] = [{ role: 'user', content: 'Hola' }]
    expect(attachPhotos(messages, { count: 0, images: [] })).toEqual(messages)
  })

  it('puts the photos on the last customer turn when the customer also wrote', () => {
    const out = attachPhotos(
      [
        { role: 'assistant', content: 'Cuéntame, ¿en qué te puedo ayudar?' },
        { role: 'user', content: '[Foto] Estoy interesado en el crédito para el ónix activ' },
      ],
      { count: 1, images: [A] },
    )
    expect(out).toEqual([
      { role: 'assistant', content: 'Cuéntame, ¿en qué te puedo ayudar?' },
      {
        role: 'user',
        content: '[Foto] Estoy interesado en el crédito para el ónix activ',
        images: [A],
      },
    ])
  })

  // Una foto sin texto no aparece en el contexto de texto: la conversacion
  // termina en un turno nuestro y hay que agregar el del cliente.
  it('adds a customer turn for a photo sent on its own', () => {
    const out = attachPhotos(
      [
        { role: 'user', content: 'Hola' },
        { role: 'assistant', content: 'Cuéntame, ¿en qué te puedo ayudar?' },
      ],
      { count: 1, images: [A] },
    )
    expect(out.at(-1)).toEqual({ role: 'user', content: '[Foto]', images: [A] })
  })

  it('still adds the [Foto] turn, without images, when the photo could not be used', () => {
    const out = attachPhotos(
      [{ role: 'assistant', content: 'Cuéntame, ¿en qué te puedo ayudar?' }],
      { count: 1, images: [] },
    )
    expect(out.at(-1)).toEqual({ role: 'user', content: '[Foto]' })
    expect(out.at(-1)).not.toHaveProperty('images')
  })

  it('works on a conversation with no text at all', () => {
    expect(attachPhotos([], { count: 2, images: [A, A] })).toEqual([
      { role: 'user', content: '[Foto]', images: [A, A] },
    ])
  })

  it('does not touch the caller’s turns', () => {
    const messages: ChatMessage[] = [{ role: 'user', content: '[Foto] ¿y este?' }]
    attachPhotos(messages, { count: 1, images: [A] })
    expect(messages).toEqual([{ role: 'user', content: '[Foto] ¿y este?' }])
  })
})
