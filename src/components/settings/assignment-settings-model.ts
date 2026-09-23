/**
 * Modelo puro de la pantalla de Ajustes → Asignación de asesores.
 *
 * Todo lo que decide la pantalla sin tocar React ni la red: cómo se
 * convierte la respuesta de `GET /api/assignment/settings` en un
 * formulario, qué se valida antes de mandar, qué cuerpo PARCIAL se manda
 * y junto a qué campo va cada error del servidor. Separado del componente
 * para probarlo en tablas de casos.
 *
 * Contrato: `openspec/changes/sticky-weighted-assignment/design.md` →
 * "API para el frontend" (con `stale_assign_after_hours`, el nombre en
 * horas que reemplazó a `stale_assign_after_days`).
 */

/** Tope de la regla de conversaciones sin asesor: 720 h (30 días), el
 *  mismo rango que valida el servidor (`src/lib/assignment/settings.ts`).
 *  El servidor tiene la última palabra; esto evita un viaje inútil. */
export const MAX_STALE_HOURS = 720
export const MAX_REACTIVATE_DAYS = 365
/** Valores con que se prende una regla cuyo campo estaba vacío. */
export const DEFAULT_STALE_HOURS = 24
export const DEFAULT_REACTIVATE_DAYS = 7

export interface AssignmentSettingsResponse {
  stale_assign_after_hours: number | null
  stale_assign_enabled_at: string | null
  bot_reactivate_after_days: number | null
  weights_updated_at: string | null
  weights: { user_id: string; full_name: string; percent: number; eligible: boolean }[]
  agents: { user_id: string; full_name: string }[]
}

/** Una fila del reparto. `percent` es el texto crudo del campo: validar
 *  sobre lo que la persona escribió, no sobre un número ya corregido. */
export interface WeightRow {
  user_id: string
  full_name: string
  percent: string
  /** false = ya no es `agent` de la cuenta: se ignora al repartir. */
  eligible: boolean
}

export interface AssignmentForm {
  weights: WeightRow[]
  /** No había porcentajes guardados y se propone el reparto parejo, que
   *  es lo que el servidor hace con la lista vacía. */
  usingDefaultSplit: boolean
  staleEnabled: boolean
  staleHours: string
  reactivateEnabled: boolean
  reactivateDays: string
}

/** Claves de `Settings.assignment.ui.validation`. */
export type WeightsError = 'percentInvalid' | 'weightsSum' | 'weightsEmpty' | 'ineligible'
export interface AssignmentFormErrors {
  weights?: WeightsError
  stale?: 'hoursInvalid'
  reactivate?: 'daysInvalid'
}

export interface AssignmentPayload {
  weights?: { user_id: string; percent: number }[]
  stale_assign_after_hours?: number | null
  bot_reactivate_after_days?: number | null
}

export type ErrorField = 'weights' | 'stale' | 'reactivate' | 'general'

/** Enteros que suman 100; el sobrante va a los primeros (3 → 34/33/33). */
export function evenSplit(n: number): number[] {
  if (n <= 0) return []
  const base = Math.floor(100 / n)
  const resto = 100 - base * n
  return Array.from({ length: n }, (_, i) => base + (i < resto ? 1 : 0))
}

export function formFromResponse(res: AssignmentSettingsResponse): AssignmentForm {
  let weights: WeightRow[]
  const usingDefaultSplit = res.weights.length === 0

  if (usingDefaultSplit) {
    const parejo = evenSplit(res.agents.length)
    weights = res.agents.map((a, i) => ({
      user_id: a.user_id,
      full_name: a.full_name,
      percent: String(parejo[i]),
      eligible: true,
    }))
  } else {
    // Lo guardado primero (el servidor ya lo ordena por porcentaje) y
    // después el resto de los asesores en 0: así todos están a la vista
    // y sumar a alguien es escribirle un número, sin un selector aparte.
    const guardados = new Set(res.weights.map((w) => w.user_id))
    weights = [
      ...res.weights.map((w) => ({
        user_id: w.user_id,
        full_name: w.full_name,
        percent: String(w.percent),
        eligible: w.eligible,
      })),
      ...res.agents
        .filter((a) => !guardados.has(a.user_id))
        .map((a) => ({ user_id: a.user_id, full_name: a.full_name, percent: '0', eligible: true })),
    ]
  }

  return {
    weights,
    usingDefaultSplit,
    staleEnabled: res.stale_assign_after_hours !== null,
    staleHours: String(res.stale_assign_after_hours ?? DEFAULT_STALE_HOURS),
    reactivateEnabled: res.bot_reactivate_after_days !== null,
    reactivateDays: String(res.bot_reactivate_after_days ?? DEFAULT_REACTIVATE_DAYS),
  }
}

/** Entero decimal sin signo ni decimales, o null si no lo es. */
function entero(raw: string): number | null {
  const s = raw.trim()
  return /^\d+$/.test(s) ? Number(s) : null
}

function enRango(raw: string, min: number, max: number): boolean {
  const n = entero(raw)
  return n !== null && n >= min && n <= max
}

export function sumPercents(rows: readonly WeightRow[]): number {
  return rows.reduce((s, w) => s + (entero(w.percent) ?? 0), 0)
}

export function validateAssignmentForm(form: AssignmentForm): AssignmentFormErrors {
  const errors: AssignmentFormErrors = {}

  // Orden de los errores del reparto: del más concreto al más general,
  // para que el mensaje diga qué arreglar primero.
  if (form.weights.some((w) => !w.eligible)) errors.weights = 'ineligible'
  else if (form.weights.some((w) => !enRango(w.percent, 0, 100))) errors.weights = 'percentInvalid'
  else if (!form.weights.some((w) => (entero(w.percent) ?? 0) > 0)) errors.weights = 'weightsEmpty'
  else if (sumPercents(form.weights) !== 100) errors.weights = 'weightsSum'

  if (form.staleEnabled && !enRango(form.staleHours, 1, MAX_STALE_HOURS)) {
    errors.stale = 'hoursInvalid'
  }
  if (form.reactivateEnabled && !enRango(form.reactivateDays, 1, MAX_REACTIVATE_DAYS)) {
    errors.reactivate = 'daysInvalid'
  }
  return errors
}

export function hasErrors(errors: AssignmentFormErrors): boolean {
  return Object.keys(errors).length > 0
}

/** Los porcentajes tal como irían al servidor: sin los 0. */
function weightsPayload(rows: readonly WeightRow[]) {
  return rows
    .filter((w) => (entero(w.percent) ?? 0) > 0)
    .map((w) => ({ user_id: w.user_id, percent: entero(w.percent) as number }))
}

function firmaReparto(rows: readonly WeightRow[]): string {
  return weightsPayload(rows)
    .map((w) => `${w.user_id}:${w.percent}`)
    .sort()
    .join('|')
    // Una fila de alguien que ya no es asesor también es parte del estado:
    // quitarla es un cambio aunque tuviera 0.
    .concat('#', rows.filter((w) => !w.eligible).map((w) => w.user_id).sort().join('|'))
}

/**
 * El cuerpo PARCIAL del PUT: solo lo que cambió respecto de lo cargado.
 * No es cosmético: guardar porcentajes reinicia la cuota del reparto, así
 * que reenviarlos intactos al tocar solo las horas lo reiniciaría sin que
 * el administrador lo pidiera.
 */
export function buildAssignmentPayload(
  form: AssignmentForm,
  initial: AssignmentForm,
): AssignmentPayload {
  const body: AssignmentPayload = {}

  if (firmaReparto(form.weights) !== firmaReparto(initial.weights)) {
    body.weights = weightsPayload(form.weights)
  }

  const horas = form.staleEnabled ? entero(form.staleHours) : null
  const horasAntes = initial.staleEnabled ? entero(initial.staleHours) : null
  if (horas !== horasAntes) body.stale_assign_after_hours = horas

  const dias = form.reactivateEnabled ? entero(form.reactivateDays) : null
  const diasAntes = initial.reactivateEnabled ? entero(initial.reactivateDays) : null
  if (dias !== diasAntes) body.bot_reactivate_after_days = dias

  return body
}

/** Junto a qué campo se muestra un `code` de error del servidor. Por
 *  prefijo, para no romperse si el backend agrega o renombra códigos
 *  (p. ej. `stale_days_invalid` → `stale_hours_invalid`). */
export function serverErrorField(code: unknown): ErrorField {
  if (typeof code !== 'string') return 'general'
  if (code.startsWith('weights_')) return 'weights'
  if (code.startsWith('stale_')) return 'stale'
  if (code.startsWith('reactivate_')) return 'reactivate'
  return 'general'
}
