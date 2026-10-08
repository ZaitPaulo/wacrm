"use client"

import { AlertCircle, CalendarDays, RotateCw } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { AppointmentMetricsRow } from '@/lib/dashboard/types'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'

interface AppointmentMetricsCardProps {
  rows: AppointmentMetricsRow[] | null
  loading: boolean
  error?: boolean
  onRetry?: () => void
  /** Días del selector de período del panel. */
  days: number
}

/** "75 %", o null sin citas marcadas: eso se dibuja como guion, no como 0 %. */
export function formatRate(rate: number | null): string | null {
  if (rate === null || !Number.isFinite(rate)) return null
  return `${Math.round(rate * 100)} %`
}

/**
 * Citas y asistencia por asesor (agenda-citas-avisos), con el período
 * del panel.
 *
 * El porcentaje es asistió entre asistió más no asistió: las citas sin
 * marcar van en su propia columna y no cuentan, porque mezclarlas
 * castigaría al asesor por un dato que falta y no por un cliente que
 * faltó. Las ventas de visita solo cuentan carros marcados como vendidos
 * con el comprador vinculado; la nota al pie lo dice, porque hoy en
 * producción ninguna venta se registra así y la columna nace en cero.
 *
 * Mismo patrón que `AgentPerformanceTable`: tabla semántica que en
 * teléfono se reparte en tarjetas.
 */
export function AppointmentMetricsCard({ rows, loading, error = false, onRetry, days }: AppointmentMetricsCardProps) {
  const t = useTranslations('Dashboard.appointmentMetrics')
  const list = rows ?? []

  const columns: { key: keyof AppointmentMetricsRow; label: string }[] = [
    { key: 'appointments', label: t('colAppointments') },
    { key: 'attended', label: t('colAttended') },
    { key: 'noShow', label: t('colNoShow') },
    { key: 'unmarked', label: t('colUnmarked') },
    { key: 'cancelled', label: t('colCancelled') },
  ]

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('description', { days })}</p>
      </header>

      <div className="p-5">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3">
            <EmptyState icon={AlertCircle} title={t('error')} hint={t('errorHint')} />
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-foreground hover:bg-muted sm:min-h-9"
              >
                <RotateCw className="h-3.5 w-3.5" aria-hidden />
                {t('retry')}
              </button>
            )}
          </div>
        ) : list.length === 0 ? (
          <EmptyState icon={CalendarDays} title={t('empty')} hint={t('emptyHint')} />
        ) : (
          <>
            <table className="block w-full border-collapse text-sm sm:table">
              <thead className="hidden sm:table-header-group">
                <tr className="border-b border-border">
                  <th scope="col" className="w-full pb-2 pr-3 text-left text-xs font-medium text-muted-foreground">
                    {t('colAgent')}
                  </th>
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      className="whitespace-nowrap pb-2 pr-4 text-right text-xs font-medium text-muted-foreground"
                    >
                      {c.label}
                    </th>
                  ))}
                  <th scope="col" className="whitespace-nowrap pb-2 pr-4 text-right text-xs font-medium text-muted-foreground">
                    {t('colRate')}
                  </th>
                  <th scope="col" className="whitespace-nowrap pb-2 text-right text-xs font-medium text-muted-foreground">
                    {t('colSales')}
                  </th>
                </tr>
              </thead>
              <tbody className="block sm:table-row-group">
                {list.map((row) => {
                  const rate = formatRate(row.attendanceRate)
                  return (
                    <tr
                      key={row.agentUserId}
                      className="mt-2 block rounded-lg border border-border p-3 first:mt-0 sm:mt-0 sm:table-row sm:rounded-none sm:border-0 sm:border-b sm:p-0"
                    >
                      <td className="block font-medium text-foreground sm:table-cell sm:py-2.5 sm:pr-6">
                        {row.fullName}
                      </td>
                      {columns.map((c) => (
                        <td
                          key={c.key}
                          className="mt-1 flex items-baseline gap-2 sm:mt-0 sm:table-cell sm:whitespace-nowrap sm:py-2.5 sm:pr-4 sm:text-right"
                        >
                          <span className="text-xs text-muted-foreground sm:hidden">{c.label}</span>
                          <span
                            className={
                              c.key === 'unmarked' && row.unmarked > 0
                                ? 'font-semibold tabular-nums text-amber-600 dark:text-amber-400'
                                : 'tabular-nums text-foreground'
                            }
                          >
                            {(row[c.key] as number).toLocaleString()}
                          </span>
                        </td>
                      ))}
                      <td className="mt-1 flex items-baseline gap-2 sm:mt-0 sm:table-cell sm:whitespace-nowrap sm:py-2.5 sm:pr-4 sm:text-right">
                        <span className="text-xs text-muted-foreground sm:hidden">{t('colRate')}</span>
                        {rate ? (
                          <span className="font-semibold tabular-nums text-foreground">{rate}</span>
                        ) : (
                          <span className="text-muted-foreground" title={t('noRate')}>
                            —
                          </span>
                        )}
                      </td>
                      <td className="mt-1 flex items-baseline gap-2 sm:mt-0 sm:table-cell sm:whitespace-nowrap sm:py-2.5 sm:text-right">
                        <span className="text-xs text-muted-foreground sm:hidden">{t('colSales')}</span>
                        <span className="tabular-nums text-foreground">{row.salesFromVisit.toLocaleString()}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-muted-foreground">{t('rateNote')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('salesNote')}</p>
          </>
        )}
      </div>
    </section>
  )
}
