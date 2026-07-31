import { es, ko, enUS, type Locale } from 'date-fns/locale'

// ============================================================
// Locale de date-fns para los tiempos relativos ("hace 2 horas").
//
// date-fns no lee la configuración de next-intl: sin pasarle un locale
// formatea siempre en inglés, así que la interfaz quedaba en español con
// los tiempos en inglés. Este módulo hace de puente entre
// NEXT_PUBLIC_APP_LOCALE y el objeto de locale que date-fns espera.
// ============================================================

const LOCALES: Record<string, Locale> = { es, ko, en: enUS }

/**
 * Locale de date-fns correspondiente al idioma de la instalación.
 *
 * Cae a inglés ante un idioma sin soporte, igual que hace
 * `src/i18n/request.ts` con los catálogos: es preferible una fecha en
 * inglés a una excepción en tiempo de render.
 */
export function dateLocale(): Locale {
  const configured = process.env.NEXT_PUBLIC_APP_LOCALE?.trim()
  return (configured && LOCALES[configured]) || enUS
}
