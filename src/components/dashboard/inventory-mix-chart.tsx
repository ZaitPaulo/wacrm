"use client"

import { useState } from 'react'
import { Car } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { InventorySnapshot } from '@/lib/dashboard/types'
import { BarChart } from '@/components/tremor/bar-chart'
import { labelOf, BODY_TYPES } from '@/lib/inventory/specs'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'
import { cn } from '@/lib/utils'

interface InventoryMixChartProps {
  data: InventorySnapshot | null
  loading: boolean
}

type Dimension = 'brand' | 'bodyType'

export function InventoryMixChart({ data, loading }: InventoryMixChartProps) {
  const t = useTranslations('Dashboard.inventoryMix')
  // Las carrocerías vienen como valores crudos ('suv', 'pickup'); se
  // traducen con el mismo catálogo que usan el formulario y la vitrina,
  // que además devuelve el valor tal cual si no lo conoce.
  const tInventory = useTranslations('Inventory')
  // Dos cortes del mismo stock en un solo panel: ocupan el mismo espacio
  // y casi nunca se miran a la vez.
  const [dimension, setDimension] = useState<Dimension>('brand')

  const unitsLabel = t('units')
  const rows = data
    ? (dimension === 'brand' ? data.byBrand : data.byBodyType).map((r) => ({
        name:
          dimension === 'bodyType' ? labelOf(tInventory, BODY_TYPES, r.name) : r.name,
        [unitsLabel]: r.count,
      }))
    : []

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('description')}</p>
        </div>
        <div className="flex gap-1 rounded-lg bg-muted p-0.5">
          {(['brand', 'bodyType'] as Dimension[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDimension(d)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                dimension === d
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`dimension.${d}`)}
            </button>
          ))}
        </div>
      </header>

      <div className="p-5">
        {loading || !data ? (
          <Skeleton className="h-[260px] w-full" />
        ) : rows.length === 0 ? (
          <EmptyState icon={Car} title={t('empty')} hint={t('emptyHint')} />
        ) : (
          <BarChart
            data={rows}
            index="name"
            categories={[t('units')]}
            colors={['blue']}
            valueFormatter={(v) => String(v)}
            showLegend={false}
            layout="vertical"
            yAxisWidth={96}
            className="h-[260px]"
          />
        )}
      </div>
    </section>
  )
}
