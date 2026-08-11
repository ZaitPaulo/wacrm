"use client"

import { TrendingUp, Info } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { MarginSummary } from '@/lib/dashboard/types'
import { formatCurrency, formatCurrencyShort } from '@/lib/currency'
import { BarChart } from '@/components/tremor/bar-chart'
import { cn } from '@/lib/utils'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'

interface MarginPanelProps {
  data: MarginSummary | null
  loading: boolean
  currency: string
}

/**
 * Utilidad bruta del período y su desglose por marca.
 *
 * Este panel sólo se monta para roles admin+ (ver `canViewMargins`), pero
 * ese gate es cosmético: si un agente lo forzara, la RLS de
 * `vehicle_acquisitions` ya le habría devuelto cero costos y vería un
 * panel vacío. La seguridad la pone la base, no este componente.
 */
export function MarginPanel({ data, loading, currency }: MarginPanelProps) {
  const t = useTranslations('Dashboard.margins')

  const rows =
    data?.byBrand.map((b) => ({
      name: b.brand,
      [t('profit')]: Math.round(b.profit),
    })) ?? []

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('description')}</p>
        </div>
        {data && data.unitsWithCost > 0 && (
          <div className="text-right">
            <p
              className={cn(
                'text-lg font-bold tabular-nums',
                data.profit >= 0 ? 'text-emerald-500' : 'text-rose-400',
              )}
            >
              {formatCurrency(data.profit, currency)}
            </p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {t('marginPct', { pct: data.marginPct.toFixed(1) })}
            </p>
          </div>
        )}
      </header>

      <div className="flex flex-1 flex-col p-5">
        {loading || !data ? (
          <Skeleton className="h-[220px] w-full" />
        ) : data.unitsWithCost === 0 ? (
          <EmptyState
            icon={TrendingUp}
            title={t('empty')}
            // Distingue "no vendiste nada" de "vendiste sin registrar el
            // costo", que se arregla de formas muy distintas.
            hint={data.unitsWithoutCost > 0 ? t('emptyNoCost') : t('emptyHint')}
          />
        ) : (
          <>
            <BarChart
              data={rows}
              index="name"
              categories={[t('profit')]}
              colors={['emerald']}
              valueFormatter={(v) => formatCurrencyShort(v, currency)}
              showLegend={false}
              layout="vertical"
              yAxisWidth={96}
              className="h-[220px]"
            />
            {/* Nunca se muestra la utilidad sin decir sobre cuántas
                unidades se calculó: un margen sobre 2 de 9 ventas no
                significa lo mismo que sobre 9 de 9. */}
            <p className="mt-4 flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
              <span>
                {t('sample', { withCost: data.unitsWithCost })}
                {data.unitsWithoutCost > 0 &&
                  ` ${t('excluded', { count: data.unitsWithoutCost })}`}
              </span>
            </p>
          </>
        )}
      </div>
    </section>
  )
}
