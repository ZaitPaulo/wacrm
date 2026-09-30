/**
 * ¿Cuándo lo va a contactar el asesor? La frase de tiempo del aviso de
 * traspaso.
 *
 * Existe porque el aviso decía solo "Uno de nuestros asesores se pondrá
 * en contacto contigo", y en 75 de los traspasos de septiembre de 2026
 * el cliente siguió escribiendo sin que nadie le contestara, muchos a
 * medianoche, sin saber que el asesor llegaba a las 8.
 *
 * Pura: el horario y el momento entran como argumentos. Calcula con la
 * hora local del proceso, igual que `business-hours.ts`; el despliegue
 * fija `TZ=America/Bogota`.
 */
import {
  dentroDeHorario,
  proximaApertura,
  type ConfiguracionHorario,
} from '@/lib/outbound/business-hours'

export type HandoffWhen =
  | { kind: 'soon' }
  | { kind: 'today' | 'tomorrow'; opensAt: Date }
  | { kind: 'weekday'; opensAt: Date; /** 0 = domingo, como `Date#getDay`. */ weekday: number }

/** Días de calendario entre dos fechas locales, sin mirar la hora. */
function calendarDaysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

/**
 * `null` cuando no hay nada honesto que decir: horario apagado o sin
 * ninguna apertura. Entonces el aviso sale como antes, sin tiempo.
 */
export function handoffWhen(
  config: ConfiguracionHorario,
  now: Date = new Date(),
): HandoffWhen | null {
  if (!config.enabled) return null
  if (dentroDeHorario(config.hours, now, config.holidayCalendar)) return { kind: 'soon' }

  const opensAt = proximaApertura(config.hours, now, config.holidayCalendar)
  if (!opensAt) return null

  const days = calendarDaysBetween(now, opensAt)
  if (days === 0) return { kind: 'today', opensAt }
  if (days === 1) return { kind: 'tomorrow', opensAt }
  return { kind: 'weekday', opensAt, weekday: opensAt.getDay() }
}

/**
 * "8:00 a. m." / "8:00 AM" / "오전 8:00". Intl mete espacios duros
 * (U+00A0, U+202F) que en WhatsApp se ven igual pero complican comparar;
 * se cambian por espacios normales.
 */
export function formatOpeningTime(date: Date, locale: string): string {
  const intlLocale = locale === 'es' ? 'es-CO' : locale === 'ko' ? 'ko-KR' : 'en-US'
  return new Intl.DateTimeFormat(intlLocale, { hour: 'numeric', minute: '2-digit' })
    .format(date)
    .replace(/[  ]/g, ' ')
}
