/**
 * Plazos de un traspaso sin atender (cambio bot-fase-2-traspaso-sin-perdidas).
 *
 * En septiembre de 2026 la mediana de respuesta del asesor tras un
 * traspaso fue de 2,3 h en horario, y 14 traspasos nunca se atendieron:
 * el asesor ya recibía el push y nadie más se enteraba. Decisión del
 * Director (2026-09-29): recordatorio al asesor a los 15 minutos y aviso
 * a owner/admin a los 45, contados en horario de atención; no se reasigna.
 *
 * Pura: el horario, los plazos y el reloj entran como argumentos. Calcula
 * con la hora local del proceso, como `business-hours.ts` (el despliegue
 * fija `TZ=America/Bogota`).
 */
import {
  dentroDeHorario,
  proximaApertura,
  type ConfiguracionHorario,
} from '@/lib/outbound/business-hours'

/**
 * Desde cuándo corre el plazo: el traspaso o, si cayó fuera de horario, la
 * siguiente apertura. Sin horario (o sin ninguna apertura), el traspaso.
 */
export function slaStart(since: Date, config: ConfiguracionHorario | null): Date {
  if (!config?.enabled) return since
  return proximaApertura(config.hours, since, config.holidayCalendar) ?? since
}

export interface DueActionsArgs {
  /** `conversations.ai_waiting_agent_since`. */
  since: Date
  now: Date
  /** Horario de la cuenta; null = sin horario, se cuenta de corrido. */
  config: ConfiguracionHorario | null
  /** Plazos en minutos; null apaga la regla. */
  remindMinutes: number | null
  escalateMinutes: number | null
  remindedAt: Date | null
  escalatedAt: Date | null
  /** Sin asesor asignado no hay a quién recordarle. */
  hasAgent: boolean
}

export interface DueActions {
  remind: boolean
  escalate: boolean
  /** Minutos de espera contados desde `slaStart`, para el texto del aviso. */
  waitedMinutes: number
}

export function dueActions(args: DueActionsArgs): DueActions {
  const { since, now, config } = args
  const waitedMinutes = Math.floor((now.getTime() - slaStart(since, config).getTime()) / 60_000)

  // Fuera de horario no sale nada: lo vencido sale en la primera pasada
  // dentro del horario. Un aviso a medianoche no lo atiende nadie.
  const open = !config?.enabled || dentroDeHorario(config.hours, now, config.holidayCalendar)
  if (!open || waitedMinutes < 0) return { remind: false, escalate: false, waitedMinutes }

  const remind =
    args.hasAgent &&
    args.remindMinutes != null &&
    args.remindedAt == null &&
    waitedMinutes >= args.remindMinutes
  const escalate =
    args.escalateMinutes != null &&
    args.escalatedAt == null &&
    waitedMinutes >= args.escalateMinutes

  return { remind, escalate, waitedMinutes }
}
