"use client"

import { Timer } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { InventoryAging } from '@/lib/dashboard/types'
import { formatCurrencyShort } from '@/lib/currency'
import { cn } from '@/lib/utils'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'

interface InventoryAgingChartProps {
  data: InventoryAging | null
  loading: boolean
  currency: string
}

// Barras horizontales a mano en vez del BarChart de Tremor: aquí el
// color tiene que variar POR BARRA (el tramo de 90+ es una alerta), y
// Tremor asigna color por categoría, no por dato. Con cuatro tramos
// fijos, un par de divs es más honesto que forzar la abstracción.
// `labelKey` evita usar la clave del tramo ('0-30', '90+') como ruta de
// traducción: los guiones y el '+' conviven mal con el acceso por puntos
// de next-intl.
const TONE: Record<string, { bar: string; text: string; labelKey: string }> = {
  '0-30': { bar: 'bg-emerald-500', text: 'text-emerald-500', labelKey: 'fresh' },
  '31-60': { bar: 'bg-blue-500', text: 'text-blue-500', labelKey: 'recent' },
  '61-90': { bar: 'bg-amber-500', text: 'text-amber-500', labelKey: 'aging' },
  '90+': { bar: 'bg-rose-500', text: 'text-rose-400', labelKey: 'stale' },
}

export function InventoryAgingChart({
  data,
  loading,
  currency,
}: InventoryAgingChartProps) {
  const t = useTranslations('Dashboard.inventoryAging')

  const max = data ? Math.max(...data.buckets.map((b) => b.count), 1) : 1
  const stale = data?.buckets.find((b) => b.key === '90+')

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('description')}</p>
        </div>
        {/* El capital parado hace más de 90 días se sube a la cabecera:
            es el número por el que se mira este panel. */}
        {stale && stale.count > 0 && (
          <span className="rounded-full border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-300 tabular-nums">
            {t('staleAlert', { count: stale.count })}
          </span>
        )}
      </header>

      <div className="flex flex-1 flex-col p-5">
        {loading || !data ? (
          <Skeleton className="h-56 w-full" />
        ) : data.total === 0 ? (
          <EmptyState icon={Timer} title={t('empty')} hint={t('emptyHint')} />
        ) : (
          <ul className="space-y-4">
            {data.buckets.map((b) => {
              const tone = TONE[b.key]
              return (
                <li key={b.key}>
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="font-medium text-muted-foreground">
                      {t(`bucket.${tone.labelKey}`)}
                    </span>
                    <span className="flex items-baseline gap-2">
                      <span className={cn('font-semibold tabular-nums', tone.text)}>
                        {b.count}
                      </span>
                      <span className="text-muted-foreground tabular-nums">
                        {formatCurrencyShort(b.value, currency)}
                      </span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn('h-full rounded-full transition-all', tone.bar)}
                      style={{ width: `${(b.count / max) * 100}%` }}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
