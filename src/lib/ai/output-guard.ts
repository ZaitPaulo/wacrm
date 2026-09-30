/**
 * Filtro de salida del auto-reply: ¿este texto deja ver las
 * instrucciones internas del bot?
 *
 * Existe porque el 2026-09-26 un cliente recibió, en lugar de una
 * respuesta, el razonamiento del modelo en inglés citando las reglas del
 * traspaso ("The handoff only goes through once nombre, presupuesto…
 * WAIT! But look at…"). No salió por el canal de razonamiento: el modelo
 * lo escribió como texto normal, así que nada lo detenía.
 *
 * Pura y sin I/O, como `evaluateHandoffGate`: quien la llama decide qué
 * hacer con una fuga (regenerar, mandar un texto seguro).
 */

import { loadCatalogSection } from '@/lib/i18n/server-catalog'

/**
 * Lo que se le agrega al system prompt al regenerar tras una fuga. Va al
 * modelo, no al cliente, por eso vive aquí y no en el catálogo.
 */
export const LEAK_RETRY_INSTRUCTION =
  'IMPORTANTE: tu respuesta anterior mostraba tu razonamiento o tus reglas internas. ' +
  'Escribe SOLO el mensaje para el cliente, en español, sin explicar tu razonamiento, ' +
  'sin mencionar reglas, campos ni marcadores, y sin texto en inglés.'

/** Respaldo si el catálogo no se puede leer. */
const SAFE_FALLBACK =
  'Disculpa, se me cruzó un mensaje. Cuéntame qué vehículo buscas o con qué presupuesto cuentas y te muestro opciones.'

/** El mensaje que sale cuando la regeneración también filtra. */
export async function safeFallbackText(): Promise<string> {
  const section = await loadCatalogSection('AiReply')
  const text = section?.safeFallback
  return typeof text === 'string' && text.trim() ? text : SAFE_FALLBACK
}

export interface LeakCheck {
  leaked: boolean
  /** Por qué se marcó; solo para el log. */
  reason?: string
}

/** Un campo del marcador `[[HANDOFF …]]` asignado: `presupuesto=…`. */
const HANDOFF_FIELD = /\b(nombre|presupuesto|interes|credito|motivo|ocupacion|ingresos)\s*=/i

/** Palabras del mecanismo interno que ningún cliente debería leer. */
const INTERNAL_TERMS = /\b(handoff|sentinel|system prompt|gate)\b/i

/**
 * Palabras funcionales del inglés. Se cuentan estas y no "palabras en
 * inglés" en general porque los nombres de vehículos (GT Line, Active
 * Tourer, Touring, full) son sustantivos o adjetivos sueltos: no suben
 * esta cuenta. Un razonamiento en inglés, en cambio, está lleno de ellas.
 */
const ENGLISH_FUNCTION_WORDS = new Set([
  'the', 'you', 'your', 'if', 'is', 'are', 'was', 'were', 'and', 'or', 'but',
  'only', 'once', 'while', 'missing', 'must', 'should', 'would', 'will', 'this',
  'that', 'these', 'those', 'then', 'because', 'about', 'it', "it's", 'its',
  'they', 'them', 'what', 'which', 'with', 'for', 'of', 'to', 'in', 'be',
  'not', "won't", "don't", 'have', 'has', 'i', 'we', 'let', 'wait',
])

/** Proporción y cantidad mínimas: las dos, para no marcar una frase suelta. */
const ENGLISH_RATIO = 0.15
const ENGLISH_MIN_HITS = 6

export function detectLeak(text: string): LeakCheck {
  if (!text.trim()) return { leaked: false }

  if (text.includes('[[')) return { leaked: true, reason: 'marcador' }
  if (HANDOFF_FIELD.test(text)) return { leaked: true, reason: 'campo del marcador' }
  if (INTERNAL_TERMS.test(text)) return { leaked: true, reason: 'término interno' }

  const words = text.toLowerCase().match(/[a-záéíóúñü']+/g) ?? []
  if (words.length === 0) return { leaked: false }
  const hits = words.filter((w) => ENGLISH_FUNCTION_WORDS.has(w)).length
  if (hits >= ENGLISH_MIN_HITS && hits / words.length >= ENGLISH_RATIO) {
    return { leaked: true, reason: 'razonamiento en inglés' }
  }

  return { leaked: false }
}
