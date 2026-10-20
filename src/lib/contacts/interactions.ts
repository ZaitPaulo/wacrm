// ============================================================
// Interacciones registradas a mano (tabla `contact_interactions`, 554).
//
// Validación del cuerpo de `POST/PATCH /api/contacts/[id]/interactions`.
// La base repite las reglas que importan (CHECK y trigger); esto existe
// para devolver un 400 claro antes de llegar a ella.
// ============================================================

export const INTERACTION_KINDS = ['call_outbound', 'call_inbound', 'walk_in', 'other'] as const
export type InteractionKind = (typeof INTERACTION_KINDS)[number]

export const INTERACTION_OUTCOMES = ['answered', 'no_answer', 'voicemail', 'wrong_number'] as const
export type InteractionOutcome = (typeof INTERACTION_OUTCOMES)[number]

export function isCallKind(kind: InteractionKind): boolean {
  return kind === 'call_outbound' || kind === 'call_inbound'
}

export interface InteractionInput {
  kind: InteractionKind
  outcome: InteractionOutcome | null
  duration_seconds: number | null
  occurred_at: string
  note: string | null
}

export type InteractionError =
  | 'invalid_kind'
  | 'invalid_outcome'
  | 'outcome_not_call'
  | 'invalid_duration'
  | 'invalid_date'
  | 'future_date'
  | 'note_too_long'

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: InteractionError }

const MAX_NOTE = 2000
/** Holgura por relojes desfasados, igual que el trigger de la 554. */
const FUTURE_SLACK_MS = 60_000

function parseOccurredAt(raw: unknown, now: Date): ParseResult<string> {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, value: now.toISOString() }
  }
  if (typeof raw !== 'string') return { ok: false, error: 'invalid_date' }
  const t = Date.parse(raw)
  if (Number.isNaN(t)) return { ok: false, error: 'invalid_date' }
  if (t > now.getTime() + FUTURE_SLACK_MS) return { ok: false, error: 'future_date' }
  return { ok: true, value: new Date(t).toISOString() }
}

function parseDuration(raw: unknown): ParseResult<number | null> {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null }
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isInteger(n) || n < 0) return { ok: false, error: 'invalid_duration' }
  return { ok: true, value: n }
}

function parseNote(raw: unknown): ParseResult<string | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null }
  if (typeof raw !== 'string') return { ok: false, error: 'note_too_long' }
  const note = raw.trim()
  if (note.length > MAX_NOTE) return { ok: false, error: 'note_too_long' }
  return { ok: true, value: note || null }
}

/** Valida el alta. El resultado solo aplica a llamadas. */
export function parseInteractionInput(body: unknown, now = new Date()): ParseResult<InteractionInput> {
  const b = (body ?? {}) as Record<string, unknown>

  if (!(INTERACTION_KINDS as readonly unknown[]).includes(b.kind)) {
    return { ok: false, error: 'invalid_kind' }
  }
  const kind = b.kind as InteractionKind

  let outcome: InteractionOutcome | null = null
  if (b.outcome !== undefined && b.outcome !== null && b.outcome !== '') {
    if (!(INTERACTION_OUTCOMES as readonly unknown[]).includes(b.outcome)) {
      return { ok: false, error: 'invalid_outcome' }
    }
    if (!isCallKind(kind)) return { ok: false, error: 'outcome_not_call' }
    outcome = b.outcome as InteractionOutcome
  }

  const occurred = parseOccurredAt(b.occurred_at, now)
  if (!occurred.ok) return occurred
  const duration = parseDuration(b.duration_seconds)
  if (!duration.ok) return duration
  const note = parseNote(b.note)
  if (!note.ok) return note

  return {
    ok: true,
    value: {
      kind,
      outcome,
      duration_seconds: duration.value,
      occurred_at: occurred.value,
      note: note.value,
    },
  }
}

/**
 * Valida una corrección: solo los campos presentes. El tipo no se cambia
 * (una llamada no pasa a ser visita); si hace falta, se borra y se
 * registra de nuevo.
 */
export function parseInteractionPatch(
  body: unknown,
  currentKind: InteractionKind,
  now = new Date(),
): ParseResult<Partial<Omit<InteractionInput, 'kind'>>> {
  const b = (body ?? {}) as Record<string, unknown>
  const out: Partial<Omit<InteractionInput, 'kind'>> = {}

  if ('outcome' in b) {
    if (b.outcome === null || b.outcome === '') {
      out.outcome = null
    } else if (!(INTERACTION_OUTCOMES as readonly unknown[]).includes(b.outcome)) {
      return { ok: false, error: 'invalid_outcome' }
    } else if (!isCallKind(currentKind)) {
      return { ok: false, error: 'outcome_not_call' }
    } else {
      out.outcome = b.outcome as InteractionOutcome
    }
  }
  if ('occurred_at' in b) {
    const occurred = parseOccurredAt(b.occurred_at, now)
    if (!occurred.ok) return occurred
    out.occurred_at = occurred.value
  }
  if ('duration_seconds' in b) {
    const duration = parseDuration(b.duration_seconds)
    if (!duration.ok) return duration
    out.duration_seconds = duration.value
  }
  if ('note' in b) {
    const note = parseNote(b.note)
    if (!note.ok) return note
    out.note = note.value
  }
  return { ok: true, value: out }
}
