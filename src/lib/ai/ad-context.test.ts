import { describe, it, expect } from 'vitest'
import { loadAdContext } from './ad-context'

/** Cliente mínimo: registra los filtros y resuelve lo que se le diga. */
function db(result: { data: unknown; error: unknown } | Error) {
  const filters: unknown[][] = []
  const chain: Record<string, unknown> = {
    select: (...a: unknown[]) => (filters.push(['select', ...a]), chain),
    eq: (...a: unknown[]) => (filters.push(['eq', ...a]), chain),
    not: (...a: unknown[]) => (filters.push(['not', ...a]), chain),
    order: (...a: unknown[]) => (filters.push(['order', ...a]), chain),
    limit: (...a: unknown[]) => (filters.push(['limit', ...a]), chain),
    maybeSingle: () =>
      result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: { from: () => chain } as any, filters }
}

describe('loadAdContext', () => {
  it('devuelve el titular y el texto del anuncio más reciente de la conversación', async () => {
    const { client, filters } = db({
      data: { referral: { source_type: 'ad', headline: 'Carros usados', body: 'Financiación' } },
      error: null,
    })
    expect(await loadAdContext(client, 'conv-1')).toEqual({
      headline: 'Carros usados',
      body: 'Financiación',
    })
    expect(filters).toContainEqual(['eq', 'conversation_id', 'conv-1'])
    expect(filters).toContainEqual(['not', 'referral', 'is', null])
  })

  it('devuelve un contexto vacío si el anuncio no trae texto', async () => {
    const { client } = db({ data: { referral: { source_type: 'ad' } }, error: null })
    expect(await loadAdContext(client, 'conv-1')).toEqual({})
  })

  it('devuelve null si la conversación no vino de un anuncio', async () => {
    const { client } = db({ data: null, error: null })
    expect(await loadAdContext(client, 'conv-1')).toBeNull()
  })

  // Antes de aplicar la 526 la columna no existe: responder sin anuncio,
  // nunca dejar al cliente sin respuesta.
  it('devuelve null si la consulta falla', async () => {
    expect(await loadAdContext(db({ data: null, error: { message: 'column does not exist' } }).client, 'c')).toBeNull()
    expect(await loadAdContext(db(new Error('fetch failed')).client, 'c')).toBeNull()
  })
})
