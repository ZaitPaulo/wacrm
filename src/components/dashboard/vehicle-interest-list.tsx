"use client"

import { MessageCircleQuestion, CheckCircle2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { VehicleInterest } from '@/lib/dashboard/types'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'

interface VehicleInterestListProps {
  data: VehicleInterest | null
  loading: boolean
}

/**
 * Vehículos más consultados desde la vitrina.
 *
 * Las filas salen de `vehicle_inquiries`, que se llena cuando un mensaje
 * de WhatsApp conserva el código del CTA. Como el cliente puede borrarlo,
 * esto es un piso y no un censo: mide interés atribuible, no interés total.
 */
export function VehicleInterestList({ data, loading }: VehicleInterestListProps) {
  const t = useTranslations('Dashboard.vehicleInterest')

  const max = data ? Math.max(...data.rows.map((r) => r.inquiries), 1) : 1

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('description')}</p>
        </div>
        {data && data.conversionPct != null && (
          <div className="text-right">
            <p className="text-lg font-bold tabular-nums text-foreground">
              {data.conversionPct.toFixed(0)}%
            </p>
            <p className="text-xs text-muted-foreground">{t('conversion')}</p>
          </div>
        )}
      </header>

      <div className="flex flex-1 flex-col p-5">
        {loading || !data ? (
          <Skeleton className="h-48 w-full" />
        ) : data.rows.length === 0 ? (
          <EmptyState
            icon={MessageCircleQuestion}
            title={t('empty')}
            hint={t('emptyHint')}
          />
        ) : (
          <ul className="space-y-3">
            {data.rows.map((r) => (
              <li key={r.vehicleId}>
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-medium text-foreground">
                      {r.label}
                    </span>
                    {r.sold && (
                      <CheckCircle2
                        className="h-3.5 w-3.5 flex-shrink-0 text-emerald-500"
                        aria-label={t('sold')}
                      />
                    )}
                  </span>
                  <span className="flex-shrink-0 text-muted-foreground tabular-nums">
                    {t('inquiries', { count: r.inquiries })}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-violet-500"
                    style={{ width: `${(r.inquiries / max) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
