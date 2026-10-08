import { describe, expect, it } from 'vitest'
import { formatRate } from './appointment-metrics-card'
import { mapAppointmentMetricsRow } from '@/lib/dashboard/queries'

describe('formatRate', () => {
  it('redondea a porcentaje entero', () => {
    expect(formatRate(0.75)).toBe('75 %')
    expect(formatRate(1)).toBe('100 %')
    expect(formatRate(0)).toBe('0 %')
  })

  it('sin citas marcadas no es 0 %', () => {
    expect(formatRate(null)).toBeNull()
  })
})

describe('mapAppointmentMetricsRow', () => {
  it('convierte los bigint de Postgres y conserva el null', () => {
    expect(
      mapAppointmentMetricsRow({
        agent_user_id: 'u-a',
        full_name: 'Carlos',
        appointments: '10',
        attended: '6',
        no_show: '2',
        unmarked: '1',
        cancelled: '1',
        attendance_rate: '0.7500',
        sales_from_visit: '0',
      })
    ).toEqual({
      agentUserId: 'u-a',
      fullName: 'Carlos',
      appointments: 10,
      attended: 6,
      noShow: 2,
      unmarked: 1,
      cancelled: 1,
      attendanceRate: 0.75,
      salesFromVisit: 0,
    })
    expect(
      mapAppointmentMetricsRow({
        agent_user_id: 'u-b',
        full_name: 'Ana',
        appointments: 3,
        attended: 0,
        no_show: 0,
        unmarked: 3,
        cancelled: 0,
        attendance_rate: null,
        sales_from_visit: 0,
      }).attendanceRate
    ).toBeNull()
  })
})
