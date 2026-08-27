import { AiError } from './types'
import { aiRequestTimeoutMs } from './defaults'
import { providerHttpError, toNetworkError } from './providers/shared'

// ============================================================
// Embeddings para la busqueda semantica del knowledge base: se embebe
// cada trozo al indexar y la pregunta al recuperar.
//
// DOS PROVEEDORES, MISMAS 1536 DIMENSIONES, que es lo que exige la
// columna `vector(1536)` de la migracion 030:
//
//   - OpenAI (text-embedding-3-small). Era el unico, y sigue siendo el
//     camino para cuentas que responden con OpenAI, OpenRouter o
//     Anthropic — este ultimo no tiene endpoint de embeddings propio.
//   - Gemini (gemini-embedding-001), que acepta `outputDimensionality`
//     y devuelve exactamente 1536. Importa porque le ahorra a una cuenta
//     que ya responde con Gemini tener que abrir y pagar una segunda
//     cuenta solo para esto: sirve la misma clave.
//
// Gemini va por su API nativa y no por su capa compatible con OpenAI,
// aunque esa existiria. La razon es `taskType`: al embeber hay que decir
// si el texto es un DOCUMENTO o una PREGUNTA, y la capa compatible no lo
// expone. Medido sobre el inventario real, sin `taskType` la separacion
// entre un vehiculo y un documento de politica irrelevante caia a 0.014
// —todo se parecia a todo—; con el sube a 0.07.
// ============================================================

const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings'
const GEMINI_EMBEDDINGS_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents'

export const EMBEDDING_MODEL = 'text-embedding-3-small'
export const GEMINI_EMBEDDING_MODEL = 'models/gemini-embedding-001'
export const EMBEDDING_DIMENSIONS = 1536

/** Quien embebe. Se deriva del proveedor de la cuenta, no se configura
 *  aparte: pedirle al usuario que elija dos proveedores es una via mas
 *  para dejarlos descuadrados. */
export type EmbeddingsProvider = 'openai' | 'gemini'

/** Un texto del knowledge base o una pregunta de cliente. Gemini embebe
 *  distinto segun cual sea; OpenAI lo ignora. */
export type EmbeddingKind = 'document' | 'query'

// OpenAI accepts an array input; keep batches modest so a big re-index
// stays under request-size limits and partial failures are cheap.
const BATCH_SIZE = 96

interface EmbeddingResponse {
  data?: { embedding?: number[]; index?: number }[]
}

/** Format a vector for a pgvector column / RPC param: `[0.1,0.2,...]`.
 *  PostgREST casts this text literal to `vector`; a raw JS array does
 *  not cast reliably. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}

/**
 * Embed a list of strings, preserving input order. Batched; throws
 * `AiError` on provider/network failure so callers can decide whether
 * to degrade (retrieval) or surface (ingest).
 */
export async function embedTexts(
  apiKey: string,
  inputs: string[],
  opts: { provider?: EmbeddingsProvider; kind?: EmbeddingKind } = {},
): Promise<number[][]> {
  if (inputs.length === 0) return []
  if ((opts.provider ?? 'openai') === 'gemini') {
    return embedWithGemini(apiKey, inputs, opts.kind ?? 'document')
  }
  const timeoutMs = aiRequestTimeoutMs()
  const out: number[][] = []

  for (let start = 0; start < inputs.length; start += BATCH_SIZE) {
    const batch = inputs.slice(start, start + BATCH_SIZE)

    let res: Response
    try {
      res = await fetch(OPENAI_EMBEDDINGS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      throw toNetworkError(err)
    }

    if (!res.ok) {
      throw await providerHttpError('OpenAI embeddings', res)
    }

    const data = (await res.json().catch(() => null)) as EmbeddingResponse | null
    const rows = data?.data
    if (!rows || rows.length !== batch.length) {
      throw new AiError('Embeddings response was malformed.', {
        code: 'embeddings_malformed',
      })
    }

    // Sort by index so order matches the input batch regardless of how
    // the provider returns them. Require a real numeric index — defaulting
    // a missing one to 0 would silently misalign chunks with their
    // vectors (chunk N gets chunk M's embedding), so fail loud instead.
    if (rows.some((r) => typeof r.index !== 'number')) {
      throw new AiError('Embeddings response was missing result indices.', {
        code: 'embeddings_malformed',
      })
    }
    const ordered = [...rows].sort((a, b) => a.index! - b.index!)
    for (const r of ordered) {
      if (!Array.isArray(r.embedding)) {
        throw new AiError('Embeddings response missing a vector.', {
          code: 'embeddings_malformed',
        })
      }
      out.push(r.embedding)
    }
  }

  return out
}

/**
 * Embeddings por la API nativa de Gemini.
 *
 * `outputDimensionality: 1536` recorta el vector para que entre en la
 * columna que ya existe, sin migrar nada. El precio de recortarlo es que
 * DEJA DE VENIR NORMALIZADO —Google normaliza solo en su tamaño nativo—,
 * asi que se normaliza aqui. Con la distancia coseno de pgvector daria
 * igual, pero un vector de norma 0,7 guardado junto a otros de norma 1
 * es una trampa esperando a quien luego compare con producto interno.
 */
async function embedWithGemini(
  apiKey: string,
  inputs: string[],
  kind: EmbeddingKind,
): Promise<number[][]> {
  const timeoutMs = aiRequestTimeoutMs()
  const taskType = kind === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT'
  const out: number[][] = []

  for (let start = 0; start < inputs.length; start += BATCH_SIZE) {
    const batch = inputs.slice(start, start + BATCH_SIZE)

    let res: Response
    try {
      res = await fetch(GEMINI_EMBEDDINGS_URL, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: batch.map((text) => ({
            model: GEMINI_EMBEDDING_MODEL,
            content: { parts: [{ text }] },
            taskType,
            outputDimensionality: EMBEDDING_DIMENSIONS,
          })),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      throw toNetworkError(err)
    }

    if (!res.ok) throw await providerHttpError('Gemini embeddings', res)

    const data = (await res.json().catch(() => null)) as
      | { embeddings?: { values?: number[] }[] }
      | null
    const rows = data?.embeddings
    // Gemini devuelve los vectores en el orden pedido y sin `index`, al
    // contrario que OpenAI. Por eso lo unico que se puede comprobar es
    // que vengan todos: si faltara uno, el desfase asignaria a cada
    // trozo el vector del siguiente y la busqueda apuntaria a otro carro.
    if (!rows || rows.length !== batch.length) {
      throw new AiError('Embeddings response was malformed.', {
        code: 'embeddings_malformed',
      })
    }

    for (const row of rows) {
      const v = row?.values
      if (!Array.isArray(v) || v.length !== EMBEDDING_DIMENSIONS) {
        throw new AiError('Embeddings response was malformed.', {
          code: 'embeddings_malformed',
        })
      }
      out.push(normalize(v))
    }
  }

  return out
}

/** Vector unitario. Un vector de norma cero se devuelve tal cual: no hay
 *  direccion que conservar y dividir por cero llenaria la fila de NaN. */
function normalize(v: number[]): number[] {
  let sum = 0
  for (const x of v) sum += x * x
  const norm = Math.sqrt(sum)
  if (!Number.isFinite(norm) || norm === 0) return v
  return v.map((x) => x / norm)
}
