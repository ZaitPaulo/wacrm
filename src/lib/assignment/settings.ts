/**
 * La configuración del reparto automático: validación del cuerpo de
 * `PUT /api/assignment/settings` y traducción de sus errores.
 *
 * Puro a propósito, para probar la tabla de casos sin HTTP ni base. La
 * base valida lo mismo (constraint trigger de suma 100, CHECK de rangos,
 * `set_assignment_weights` comprueba que cada uno sea `agent`); esto está
 * para devolver un error legible y traducible ANTES de llegar ahí.
 *
 * Contrato completo en
 * `openspec/changes/sticky-weighted-assignment/design.md` → "API para el
 * frontend".
 */

/** Códigos que la ruta pone en `code`; cada uno es una clave de
 *  `Settings.assignment.errors`. */
export const ASSIGNMENT_SETTINGS_ERROR_CODES = {
  invalidBody: 'invalid_body',
  weightsInvalid: 'weights_invalid',
  weightsEmpty: 'weights_empty',
  weightsPercentRange: 'weights_percent_range',
  weightsDuplicate: 'weights_duplicate',
  weightsSum: 'weights_sum',
  weightsNotAgent: 'weights_not_agent',
  staleHoursInvalid: 'stale_hours_invalid',
  reactivateDaysInvalid: 'reactivate_days_invalid',
  tradeInAgentInvalid: 'trade_in_agent_invalid',
  saveFailed: 'save_failed',
} as const

export type AssignmentSettingsErrorCode =
  (typeof ASSIGNMENT_SETTINGS_ERROR_CODES)[keyof typeof ASSIGNMENT_SETTINGS_ERROR_CODES]

export interface AssignmentWeightInput {
  user_id: string
  percent: number
}

/** Lo que se va a escribir. Parcial: lo ausente no se toca. */
export interface AssignmentSettingsInput {
  weights?: AssignmentWeightInput[]
  /** P4 en HORAS (1 a 720), decisión del Director del 2026-09-23. */
  stale_assign_after_hours?: number | null
  bot_reactivate_after_days?: number | null
  /** El asesor que recibe siempre los traspasos por venta o permuta
   *  (migración 543). `null` = desactivado. */
  trade_in_agent_id?: string | null
}

export type ParseResult =
  | { ok: true; value: AssignmentSettingsInput }
  | { ok: false; code: AssignmentSettingsErrorCode }

/** Plazo de P4: de 1 hora a 30 días (720 h). Mismo rango que el CHECK
 *  de la migración 534. */
const MAX_HORAS = 720
/** Reactivación del bot: de 1 a 365 días. */
const MAX_DIAS = 365

function enteroEnRango(v: unknown, max: number): v is number | null {
  return v === null || (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= max)
}

/**
 * Valida el cuerpo de `PUT /api/assignment/settings`.
 *
 * @param agentIds Los `user_id` de los miembros de la cuenta con rol
 *   `agent`: solo ellos pueden recibir asignaciones automáticas.
 * @param memberIds Los `user_id` de los miembros vigentes (owner, admin
 *   y agent): los que pueden ser asesor de ventas y permutas. Angélica,
 *   que lo es en producción, es `admin`.
 */
export function parseAssignmentSettingsInput(
  body: unknown,
  opts: { agentIds: readonly string[]; memberIds: readonly string[] },
): ParseResult {
  const C = ASSIGNMENT_SETTINGS_ERROR_CODES
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, code: C.invalidBody }
  }
  const b = body as Record<string, unknown>
  const value: AssignmentSettingsInput = {}

  if ('weights' in b) {
    if (!Array.isArray(b.weights)) return { ok: false, code: C.weightsInvalid }
    if (b.weights.length === 0) return { ok: false, code: C.weightsEmpty }

    const weights: AssignmentWeightInput[] = []
    for (const item of b.weights as unknown[]) {
      if (!item || typeof item !== 'object' || typeof (item as { user_id?: unknown }).user_id !== 'string') {
        return { ok: false, code: C.weightsInvalid }
      }
      const { user_id, percent } = item as { user_id: string; percent: unknown }
      if (!Number.isInteger(percent) || (percent as number) < 1 || (percent as number) > 100) {
        return { ok: false, code: C.weightsPercentRange }
      }
      weights.push({ user_id, percent: percent as number })
    }

    if (new Set(weights.map((w) => w.user_id)).size !== weights.length) {
      return { ok: false, code: C.weightsDuplicate }
    }
    if (weights.some((w) => !opts.agentIds.includes(w.user_id))) {
      return { ok: false, code: C.weightsNotAgent }
    }
    if (weights.reduce((s, w) => s + w.percent, 0) !== 100) {
      return { ok: false, code: C.weightsSum }
    }
    value.weights = weights
  }

  if ('stale_assign_after_hours' in b) {
    if (!enteroEnRango(b.stale_assign_after_hours, MAX_HORAS)) {
      return { ok: false, code: C.staleHoursInvalid }
    }
    value.stale_assign_after_hours = b.stale_assign_after_hours
  }

  if ('bot_reactivate_after_days' in b) {
    if (!enteroEnRango(b.bot_reactivate_after_days, MAX_DIAS)) {
      return { ok: false, code: C.reactivateDaysInvalid }
    }
    value.bot_reactivate_after_days = b.bot_reactivate_after_days
  }

  if ('trade_in_agent_id' in b) {
    const v = b.trade_in_agent_id
    if (v !== null && (typeof v !== 'string' || !opts.memberIds.includes(v))) {
      return { ok: false, code: C.tradeInAgentInvalid }
    }
    value.trade_in_agent_id = v
  }

  // `stale_assign_enabled_at` no se acepta: lo fija la base al activar.
  if (Object.keys(value).length === 0) return { ok: false, code: C.invalidBody }
  return { ok: true, value }
}

/**
 * La clave de `Settings.assignment.errors` para un `code` de la ruta.
 * Un código desconocido cae al genérico: inventarle un motivo a un fallo
 * desconocido es peor que decir que falló.
 */
export function assignmentSettingsErrorKey(code: unknown): AssignmentSettingsErrorCode {
  const conocidos = Object.values(ASSIGNMENT_SETTINGS_ERROR_CODES) as string[]
  return typeof code === 'string' && conocidos.includes(code)
    ? (code as AssignmentSettingsErrorCode)
    : ASSIGNMENT_SETTINGS_ERROR_CODES.saveFailed
}
