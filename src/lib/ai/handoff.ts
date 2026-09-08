import type { ChatMessage, HandoffRequest } from './types'

/** Longest the quoted customer message runs before we ellipsize it —
 *  keeps the internal note to a glanceable one-liner. */
const MAX_QUOTE_LEN = 160

/**
 * Build the short internal note the auto-reply bot leaves on a
 * conversation when it hands off to a human. Deterministic — composed
 * from context we already have (no extra LLM call / token spend), so it
 * can't fail or add latency to the handoff.
 *
 * Reads as, e.g.:
 *   "🤖 AI agent handed off after 2 replies. Last customer message:
 *    “can I speak to a manager about my refund?”"
 *
 * `replyCount` is the bot's auto-reply tally for the thread (0 when it
 * bailed on the very first inbound without answering).
 */
export function buildHandoffSummary(args: {
  messages: ChatMessage[]
  replyCount: number
  /** Lo que el bot declaro haber recolectado. Ausente en el camino de
   *  fallo (generacion vacia), donde no hay peticion que leer. */
  request?: HandoffRequest
  /** True cuando paso por la excepcion de urgencia, o sea que entra sin
   *  los datos completos y el asesor debe saberlo. */
  urgent?: boolean
}): string {
  const { messages, replyCount, request, urgent } = args

  const lastCustomer = [...messages]
    .reverse()
    .find((m) => m.role === 'user' && m.content.trim())

  const replies =
    replyCount === 0
      ? 'without replying'
      : `after ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`

  const urgency = urgent ? ' (urgente)' : ''
  const lines = [`🤖 AI agent handed off ${replies}${urgency}.`]

  if (request) {
    lines.push(
      `Motivo: ${request.motivo} · Nombre: ${orMissing(request.nombre)} · ` +
        `Presupuesto: ${orMissing(request.presupuesto)} · ` +
        `Interés: ${orMissing(request.interes)} · Crédito: ${credito(request.credito)}`,
    )
  }

  if (lastCustomer) {
    const quote = truncate(lastCustomer.content.trim(), MAX_QUOTE_LEN)
    lines.push(`Last customer message: “${quote}”`)
  }

  return lines.join('\n')
}

/**
 * Un dato que no se obtuvo se dice, no se omite: el asesor tiene que
 * poder distinguir "no lo preguntamos" de "no aparece en la nota".
 */
function orMissing(value: string | null): string {
  return value?.trim() ? value.trim() : '(falta)'
}

function credito(value: boolean | null): string {
  if (value === null) return '(falta)'
  return value ? 'sí' : 'no'
}

function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ')
  if (collapsed.length <= max) return collapsed
  return `${collapsed.slice(0, max - 1).trimEnd()}…`
}
