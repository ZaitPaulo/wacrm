import { describe, expect, it } from 'vitest'
import { formatOpeningTime, handoffWhen } from './when'
import type { ConfiguracionHorario, HorarioSemanal } from '@/lib/outbound/business-hours'

// El horario real de LoraMotors: L-V 8:00-18:00, sáb 8:00-14:00, domingo cerrado.
const LORAMOTORS: HorarioSemanal = {
  sun: null,
  mon: ['08:00', '18:00'],
  tue: ['08:00', '18:00'],
  wed: ['08:00', '18:00'],
  thu: ['08:00', '18:00'],
  fri: ['08:00', '18:00'],
  sat: ['08:00', '14:00'],
}

const CONFIG: ConfiguracionHorario = {
  enabled: true,
  hours: LORAMOTORS,
  holidayCalendar: 'CO',
}

/** Un momento en el reloj local del proceso, como en business-hours.test. */
const cuando = (iso: string) => new Date(iso)

describe('handoffWhen', () => {
  // 2026-09-08 es martes.
  it('en horario: en los próximos minutos', () => {
    expect(handoffWhen(CONFIG, cuando('2026-09-08T10:00:00'))).toEqual({ kind: 'soon' })
  })

  it('martes de noche: mañana a las 8', () => {
    const when = handoffWhen(CONFIG, cuando('2026-09-08T23:00:00'))
    expect(when).toMatchObject({ kind: 'tomorrow' })
    expect(when && 'opensAt' in when && when.opensAt.getHours()).toBe(8)
  })

  it('madrugada antes de abrir: hoy a las 8', () => {
    expect(handoffWhen(CONFIG, cuando('2026-09-08T05:30:00'))).toMatchObject({ kind: 'today' })
  })

  it('sábado por la tarde: el lunes', () => {
    // 2026-09-12 es sábado; el lunes 14 no es festivo.
    const when = handoffWhen(CONFIG, cuando('2026-09-12T15:00:00'))
    expect(when).toMatchObject({ kind: 'weekday', weekday: 1 })
  })

  it('víspera de festivo: salta el festivo', () => {
    // Sábado 2026-10-10; el lunes 12 es festivo en Colombia (Día de la
    // Diversidad Étnica y Cultural), así que abre el martes 13.
    const when = handoffWhen(CONFIG, cuando('2026-10-10T15:00:00'))
    expect(when).toMatchObject({ kind: 'weekday', weekday: 2 })
  })

  it('sin horario configurado: no dice cuándo', () => {
    expect(handoffWhen({ ...CONFIG, enabled: false }, cuando('2026-09-08T23:00:00'))).toBeNull()
  })

  it('con todo cerrado: no dice cuándo', () => {
    const cerrado = Object.fromEntries(Object.keys(LORAMOTORS).map((d) => [d, null])) as HorarioSemanal
    expect(handoffWhen({ ...CONFIG, hours: cerrado }, cuando('2026-09-08T23:00:00'))).toBeNull()
  })
})

describe('formatOpeningTime', () => {
  it('formatea a la manera de cada idioma, con espacios normales', () => {
    const ocho = cuando('2026-09-09T08:00:00')
    expect(formatOpeningTime(ocho, 'es')).toBe('8:00 a. m.')
    expect(formatOpeningTime(ocho, 'en')).toBe('8:00 AM')
  })
})
