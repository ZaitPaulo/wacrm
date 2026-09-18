import { isUrgentHandoff, type HandoffRequest } from './types'

/**
 * The data gate for AI handoffs.
 *
 * The model used to decide on its own whether a thread went to a human,
 * and it decided badly: on 2026-09-07 two customers were transferred on
 * their second turn, right after saying their budget, without having
 * been shown a single vehicle. Two rounds of prompt tuning didn't fix
 * it, because "don't hand off yet" is a suggestion and a gate is not.
 *
 * So the model now *requests* a handoff and this decides. Pure and
 * synchronous: no DB, no clock, no I/O — everything it needs is the
 * request plus the thread's rejected-attempt count.
 */

/** What an agent needs to walk into the conversation and sell. */
export const REQUIRED_HANDOFF_FIELDS = [
  'nombre',
  'presupuesto',
  'interes',
  'credito',
] as const

export type RequiredHandoffField = (typeof REQUIRED_HANDOFF_FIELDS)[number]

/**
 * Lo que el asesor pregunta primero cuando el cliente necesita crédito
 * (revisión del 2026-09-18: 6 de 7 traspasos fueron por crédito). Solo
 * se exige con `credito === true`, y nunca deja al cliente atascado:
 * ver `evaluateHandoffGate`.
 */
export const CREDIT_PROFILE_FIELDS = ['ocupacion', 'ingresos'] as const

export type CreditProfileField = (typeof CREDIT_PROFILE_FIELDS)[number]

export interface HandoffGateResult {
  /** Whether the transfer goes through. */
  transfer: boolean
  /** Fields still needed. Empty when `transfer` is true. */
  missing: (RequiredHandoffField | CreditProfileField)[]
  /** Whether the request was urgent (complaint / asked for a person). */
  urgent: boolean
}

/**
 * A field counts as present when the model declared *something*.
 *
 * `credito` is the one that bites: it's a boolean, so `false` is a real
 * answer — the customer said they don't need financing. Testing it for
 * truthiness would trap every cash buyer behind a question they already
 * answered.
 */
function isPresent(
  request: HandoffRequest,
  field: RequiredHandoffField | CreditProfileField,
): boolean {
  const value = request[field]
  if (field === 'credito') return value !== null
  return typeof value === 'string' && value.trim() !== ''
}

export function evaluateHandoffGate(args: {
  request: HandoffRequest
  /** `conversations.ai_handoff_attempts` — how many times this thread's
   *  handoff has already been refused. */
  attempts: number
}): HandoffGateResult {
  const { request, attempts } = args
  const urgent = isUrgentHandoff(request.motivo)

  if (urgent) {
    // An upset customer, or one who asked for a person, gets a human as
    // soon as we can name them — and even that gives way on the second
    // try, because someone who refuses to give their name would
    // otherwise be stuck with the bot asking for it forever, which is
    // the exact experience they were complaining about.
    const hasName = isPresent(request, 'nombre')
    if (hasName || attempts >= 1) {
      return { transfer: true, missing: [], urgent }
    }
    return { transfer: false, missing: ['nombre'], urgent }
  }

  const missing = REQUIRED_HANDOFF_FIELDS.filter((f) => !isPresent(request, f))
  const missingProfile =
    request.credito === true
      ? CREDIT_PROFILE_FIELDS.filter((f) => !isPresent(request, f))
      : []

  // No attempt-based escape for the four required fields: a sale can
  // wait. If it couldn't, the gate would evaporate a few turns into
  // every thread.
  if (missing.length > 0) {
    return { transfer: false, missing: [...missing, ...missingProfile], urgent }
  }

  // El perfil de crédito ahorra tiempo al asesor, pero no es condición
  // para vender: se pide una vez, y si el cliente no lo quiere dar, el
  // siguiente intento pasa. `attempts` no distingue qué faltó antes; al
  // llegar aquí los cuatro datos ya están, así que da igual.
  if (missingProfile.length > 0 && attempts < 1) {
    return { transfer: false, missing: missingProfile, urgent }
  }
  return { transfer: true, missing: [], urgent }
}
