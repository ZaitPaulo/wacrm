import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { embedTexts, toVectorLiteral } from './embeddings'
import { AiError } from './types'

function okEmbeddings(count: number, shuffle = false): Response {
  const rows = Array.from({ length: count }, (_, i) => ({
    embedding: [i, i + 0.5],
    index: i,
  }))
  if (shuffle) rows.reverse()
  return { ok: true, status: 200, json: async () => ({ data: rows }) } as unknown as Response
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
afterEach(() => vi.unstubAllGlobals())

describe('toVectorLiteral', () => {
  it('formats a pgvector literal', () => {
    expect(toVectorLiteral([0.1, 0.2, 0.3])).toBe('[0.1,0.2,0.3]')
  })
})

describe('embedTexts', () => {
  it('returns [] and makes no request for empty input', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await embedTexts('sk-x', [])).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('embeds a single batch and sends the key', async () => {
    const fetchMock = vi.fn(async (_url: string, opts: { body: string }) => {
      const n = JSON.parse(opts.body).input.length
      return okEmbeddings(n)
    })
    vi.stubGlobal('fetch', fetchMock)

    const out = await embedTexts('sk-x', ['a', 'b', 'c'])
    expect(out).toHaveLength(3)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('api.openai.com')
    expect(
      (opts as unknown as { headers: Record<string, string> }).headers.Authorization,
    ).toBe('Bearer sk-x')
  })

  it('splits large inputs into multiple batches', async () => {
    const fetchMock = vi.fn(async (_url: string, opts: { body: string }) => {
      const n = JSON.parse(opts.body).input.length
      return okEmbeddings(n)
    })
    vi.stubGlobal('fetch', fetchMock)

    const inputs = Array.from({ length: 100 }, (_, i) => `t${i}`)
    const out = await embedTexts('sk-x', inputs)
    expect(out).toHaveLength(100)
    expect(fetchMock).toHaveBeenCalledTimes(2) // 96 + 4
  })

  it('reorders by index when the provider returns them shuffled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, opts: { body: string }) => {
        const n = JSON.parse(opts.body).input.length
        return okEmbeddings(n, true)
      }),
    )
    const out = await embedTexts('sk-x', ['a', 'b', 'c'])
    expect(out[0]).toEqual([0, 0.5]) // index 0 first despite shuffle
    expect(out[2]).toEqual([2, 2.5])
  })

  it('maps a 401 to an invalid_key AiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'bad key' } }),
      } as unknown as Response),
    )
    await expect(embedTexts('sk-x', ['a'])).rejects.toMatchObject({
      code: 'invalid_key',
    })
  })

  it('throws when the provider omits result indices', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ embedding: [0.1] }, { embedding: [0.2] }] }),
      } as unknown as Response),
    )
    await expect(embedTexts('sk-x', ['a', 'b'])).rejects.toBeInstanceOf(AiError)
  })

  it('throws on a malformed response (count mismatch)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      } as unknown as Response),
    )
    await expect(embedTexts('sk-x', ['a', 'b'])).rejects.toBeInstanceOf(AiError)
  })
})

// ============================================================
// Camino de Gemini. Existe para que una cuenta que ya responde con
// Gemini no tenga que abrir y pagar una cuenta de OpenAI solo para
// embeber, y para poder pedir `taskType`, que es la mitad de la calidad
// de la busqueda.
// ============================================================

const DIMS = 1536

/** Respuesta de Gemini: `embeddings[].values`, sin `index`, y con la
 *  norma lejos de 1 porque el vector viene recortado a 1536. */
function okGemini(count: number, valor = 3): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      embeddings: Array.from({ length: count }, () => ({
        values: Array.from({ length: DIMS }, () => valor),
      })),
    }),
  } as unknown as Response
}

describe('embedTexts — Gemini', () => {
  it('pega a la API nativa de Gemini y no a OpenAI', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okGemini(1))
    vi.stubGlobal('fetch', fetchMock)

    await embedTexts('AQ.x', ['un carro'], { provider: 'gemini' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('generativelanguage.googleapis.com')
    expect(url).toContain('batchEmbedContents')
    // La clave va en su cabecera propia, no como Bearer.
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('AQ.x')
    expect(init.headers).not.toHaveProperty('Authorization')
  })

  it('distingue un documento de una pregunta', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okGemini(1))
    vi.stubGlobal('fetch', fetchMock)

    await embedTexts('AQ.x', ['q'], { provider: 'gemini', kind: 'query' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).requests[0].taskType).toBe(
      'RETRIEVAL_QUERY',
    )

    fetchMock.mockClear()
    await embedTexts('AQ.x', ['d'], { provider: 'gemini', kind: 'document' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).requests[0].taskType).toBe(
      'RETRIEVAL_DOCUMENT',
    )
  })

  it('pide 1536 dimensiones, que es lo que cabe en la columna', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okGemini(1))
    vi.stubGlobal('fetch', fetchMock)
    await embedTexts('AQ.x', ['x'], { provider: 'gemini' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).requests[0].outputDimensionality).toBe(1536)
  })

  // Recortado a 1536 el vector deja de venir normalizado. Con distancia
  // coseno daria igual, pero guardar vectores de norma 0,7 junto a otros
  // de norma 1 es una trampa para quien luego compare de otra forma.
  it('normaliza el vector que devuelve Gemini', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okGemini(1, 3)))
    const [v] = await embedTexts('AQ.x', ['x'], { provider: 'gemini' })
    const norma = Math.sqrt(v.reduce((a, x) => a + x * x, 0))
    expect(norma).toBeCloseTo(1, 6)
  })

  // Gemini no devuelve `index`: el orden del array es lo unico que ata
  // cada vector a su texto. Si faltara uno, el desfase le pondria a cada
  // trozo el vector del siguiente y la busqueda apuntaria a otro carro.
  it('falla si vuelven menos vectores de los pedidos', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okGemini(1)))
    await expect(
      embedTexts('AQ.x', ['uno', 'dos'], { provider: 'gemini' }),
    ).rejects.toBeInstanceOf(AiError)
  })

  it('falla si un vector no tiene el tamaño esperado', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ embeddings: [{ values: [1, 2, 3] }] }),
    } as unknown as Response))
    await expect(embedTexts('AQ.x', ['x'], { provider: 'gemini' })).rejects.toBeInstanceOf(AiError)
  })

  it('sin proveedor sigue yendo a OpenAI', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okEmbeddings(1))
    vi.stubGlobal('fetch', fetchMock)
    await embedTexts('sk-x', ['x'])
    expect(fetchMock.mock.calls[0][0]).toContain('api.openai.com')
  })
})
