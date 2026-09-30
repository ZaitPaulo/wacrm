import { describe, expect, it } from 'vitest'
import { dueActions, slaStart } from './sla'
import type { ConfiguracionHorario } from '@/lib/outbound/business-hours'

const CONFIG: ConfiguracionHorario = {
  enabled: true,
  hours: {
    sun: null,
    mon: ['08:00', '18:00'],
    tue: ['08:00', '18:00'],
    wed: ['08:00', '18:00'],
    thu: ['08:00', '18:00'],
    fri: ['08:00', '18:00'],
    sat: ['08:00', '14:00'],
  },
  holidayCalendar: 'CO',
}

const t = (iso: string) => new Date(iso)

const base = {
  config: CONFIG,
  remindMinutes: 15,
  escalateMinutes: 45,
  remindedAt: null,
  escalatedAt: null,
  hasAgent: true,
}

describe('slaStart', () => {
  // 2026-09-08 es martes.
  it('en horario, empieza en el traspaso', () => {
    expect(slaStart(t('2026-09-08T10:00:00'), CONFIG)).toEqual(t('2026-09-08T10:00:00'))
  })

  it('de noche, empieza en la siguiente apertura', () => {
    expect(slaStart(t('2026-09-08T23:00:00'), CONFIG)).toEqual(t('2026-09-09T08:00:00'))
  })

  it('sin horario, empieza en el traspaso', () => {
    expect(slaStart(t('2026-09-08T23:00:00'), null)).toEqual(t('2026-09-08T23:00:00'))
  })
})

describe('dueActions', () => {
  it('a los 10 minutos no hay nada', () => {
    expect(
      dueActions({ ...base, since: t('2026-09-08T10:00:00'), now: t('2026-09-08T10:10:00') }),
    ).toMatchObject({ remind: false, escalate: false })
  })

  it('a los 15 minutos, recordatorio', () => {
    expect(
      dueActions({ ...base, since: t('2026-09-08T10:00:00'), now: t('2026-09-08T10:15:00') }),
    ).toEqual({ remind: true, escalate: false, waitedMinutes: 15 })
  })

  it('a los 45 minutos, las dos cosas si no se había recordado', () => {
    expect(
      dueActions({ ...base, since: t('2026-09-08T10:00:00'), now: t('2026-09-08T10:46:00') }),
    ).toEqual({ remind: true, escalate: true, waitedMinutes: 46 })
  })

  it('ya recordado, a los 45 solo escala', () => {
    expect(
      dueActions({
        ...base,
        remindedAt: t('2026-09-08T10:15:00'),
        since: t('2026-09-08T10:00:00'),
        now: t('2026-09-08T10:45:00'),
      }),
    ).toMatchObject({ remind: false, escalate: true })
  })

  it('traspaso de noche: a las 8:10 todavía no, a las 8:15 recordatorio', () => {
    const since = t('2026-09-08T23:00:00')
    expect(dueActions({ ...base, since, now: t('2026-09-09T08:10:00') }).remind).toBe(false)
    expect(dueActions({ ...base, since, now: t('2026-09-09T08:15:00') }).remind).toBe(true)
  })

  it('fuera de horario no hay acciones, aunque esté vencido', () => {
    // Traspaso del sábado a las 13:00; a las 15:00 ya cerró.
    expect(
      dueActions({ ...base, since: t('2026-09-12T13:00:00'), now: t('2026-09-12T15:00:00') }),
    ).toMatchObject({ remind: false, escalate: false })
  })

  it('sin horario, cuenta de corrido', () => {
    expect(
      dueActions({
        ...base,
        config: null,
        since: t('2026-09-08T23:00:00'),
        now: t('2026-09-08T23:20:00'),
      }).remind,
    ).toBe(true)
  })

  it('sin asesor no hay recordatorio, pero sí escalamiento', () => {
    expect(
      dueActions({
        ...base,
        hasAgent: false,
        since: t('2026-09-08T10:00:00'),
        now: t('2026-09-08T10:50:00'),
      }),
    ).toMatchObject({ remind: false, escalate: true })
  })

  it('plazos apagados', () => {
    expect(
      dueActions({
        ...base,
        remindMinutes: null,
        escalateMinutes: null,
        since: t('2026-09-08T10:00:00'),
        now: t('2026-09-08T12:00:00'),
      }),
    ).toMatchObject({ remind: false, escalate: false })
  })

  it('ya escalado, nada', () => {
    expect(
      dueActions({
        ...base,
        remindedAt: t('2026-09-08T10:15:00'),
        escalatedAt: t('2026-09-08T10:45:00'),
        since: t('2026-09-08T10:00:00'),
        now: t('2026-09-08T12:00:00'),
      }),
    ).toMatchObject({ remind: false, escalate: false })
  })
})
