"use client"

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { useCan } from '@/hooks/use-can'
import { formatCurrency, formatCurrencyShort } from '@/lib/currency'
import {
  MessageSquare,
  UserPlus,
  DollarSign,
  Send,
  Car,
  Warehouse,
  Receipt,
  Timer,
  Handshake,
} from 'lucide-react'

import {
  loadActivity,
  loadConversationsSeries,
  loadMetrics,
  loadPipelineDonut,
  loadResponseTime,
} from '@/lib/dashboard/queries'
import {
  loadInventoryAging,
  loadInventorySnapshot,
  loadMargins,
  loadSalesPerformance,
  loadVehicleInterest,
} from '@/lib/dashboard/vehicle-queries'
import type {
  ActivityItem,
  ConversationsSeriesPoint,
  InventoryAging,
  InventorySnapshot,
  MarginSummary,
  MetricsBundle,
  PipelineDonutData,
  ResponseTimeSummary,
  SalesPerformance,
  VehicleInterest,
} from '@/lib/dashboard/types'

import { MetricCard } from '@/components/dashboard/metric-card'
import { SkeletonCard } from '@/components/dashboard/skeleton'
import { QuickActions } from '@/components/dashboard/quick-actions'
import { ConversationsChart } from '@/components/dashboard/conversations-chart'
import { PipelineDonut } from '@/components/dashboard/pipeline-donut'
import { ResponseTimeChart } from '@/components/dashboard/response-time-chart'
import { ActivityFeed } from '@/components/dashboard/activity-feed'
import { InventoryAgingChart } from '@/components/dashboard/inventory-aging-chart'
import { InventoryMixChart } from '@/components/dashboard/inventory-mix-chart'
import { MarginPanel } from '@/components/dashboard/margin-panel'
import { VehicleInterestList } from '@/components/dashboard/vehicle-interest-list'

import { useTranslations } from 'next-intl'

type RangeDays = 7 | 30 | 90

/** Inicio del rango comercial: N días atrás desde ahora. */
function rangeStart(days: RangeDays): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

export default function DashboardPage() {
  const t = useTranslations('Dashboard.page')
  const { defaultCurrency } = useAuth()

  // El costo de compra sólo lo ve admin+. Este gate evita renderizar un
  // panel que llegaría vacío; la restricción real la impone la RLS de
  // vehicle_acquisitions, que a un 'agent' le devuelve cero filas.
  const showMargins = useCan('view-margins')

  const [metrics, setMetrics] = useState<MetricsBundle | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(true)

  const [range, setRange] = useState<RangeDays>(30)
  // Keep a cache per range so switching tabs doesn't re-fetch what we
  // already have. Ranges the user hasn't opened yet stay null and
  // trigger a fetch on first view.
  const [series, setSeries] = useState<Record<RangeDays, ConversationsSeriesPoint[] | null>>({
    7: null,
    30: null,
    90: null,
  })
  const [seriesLoading, setSeriesLoading] = useState(true)

  const [pipeline, setPipeline] = useState<PipelineDonutData | null>(null)
  const [pipelineLoading, setPipelineLoading] = useState(true)

  const [responseTime, setResponseTime] = useState<ResponseTimeSummary | null>(null)
  const [responseTimeLoading, setResponseTimeLoading] = useState(true)

  const [activity, setActivity] = useState<ActivityItem[] | null>(null)
  const [activityLoading, setActivityLoading] = useState(true)

  // --- Compraventa -------------------------------------------------
  const [snapshot, setSnapshot] = useState<InventorySnapshot | null>(null)
  const [snapshotLoading, setSnapshotLoading] = useState(true)

  const [aging, setAging] = useState<InventoryAging | null>(null)
  const [agingLoading, setAgingLoading] = useState(true)

  const [sales, setSales] = useState<SalesPerformance | null>(null)
  const [salesLoading, setSalesLoading] = useState(true)

  const [margins, setMargins] = useState<MarginSummary | null>(null)
  const [marginsLoading, setMarginsLoading] = useState(true)

  const [interest, setInterest] = useState<VehicleInterest | null>(null)
  const [interestLoading, setInterestLoading] = useState(true)

  /**
   * Recarga las métricas que dependen del período. El bloque comercial
   * reutiliza el mismo selector de rango que la serie de conversaciones
   * en vez de traer el suyo: son el mismo "¿de qué ventana hablamos?".
   *
   * No activa los skeletons: sólo dispara los fetch y deja que los
   * `.finally` los apaguen. Reactivarlos es responsabilidad del handler
   * de cambio de rango, porque hacerlo aquí metería un setState síncrono
   * en el camino del effect inicial (cascading render). En el arranque no
   * hace falta: los flags ya nacen en `true`. Mismo criterio que ya
   * seguía la serie de conversaciones.
   */
  const loadRanged = useCallback((days: RangeDays, withMargins: boolean) => {
    const db = createClient()
    const from = rangeStart(days)
    const to = new Date()

    void loadSalesPerformance(db, from, to)
      .then(setSales)
      .catch((err) => console.error('[dashboard] sales failed:', err))
      .finally(() => setSalesLoading(false))

    void loadVehicleInterest(db, from, to)
      .then(setInterest)
      .catch((err) => console.error('[dashboard] interest failed:', err))
      .finally(() => setInterestLoading(false))

    if (withMargins) {
      void loadMargins(db, from, to)
        .then(setMargins)
        .catch((err) => console.error('[dashboard] margins failed:', err))
        .finally(() => setMarginsLoading(false))
    }
  }, [])

  const loadAll = useCallback(() => {
    const db = createClient()

    // Kick everything off in parallel. Each block has its own
    // setState + finally so a slow query doesn't hold up faster
    // sections — each widget shows its own skeleton independently.
    void loadMetrics(db)
      .then((m) => setMetrics(m))
      .catch((err) => console.error('[dashboard] metrics failed:', err))
      .finally(() => setMetricsLoading(false))

    void loadConversationsSeries(db, 30)
      .then((s) => setSeries((prev) => ({ ...prev, 30: s })))
      .catch((err) => console.error('[dashboard] series failed:', err))
      .finally(() => setSeriesLoading(false))

    void loadPipelineDonut(db)
      .then((p) => setPipeline(p))
      .catch((err) => console.error('[dashboard] pipeline failed:', err))
      .finally(() => setPipelineLoading(false))

    void loadResponseTime(db)
      .then((r) => setResponseTime(r))
      .catch((err) => console.error('[dashboard] response time failed:', err))
      .finally(() => setResponseTimeLoading(false))

    // Fetch up to 50 so the biggest page-size option in the feed
    // (50 rows) is already in memory — switching sizes then becomes
    // a pure client-side slice with no extra round trip.
    void loadActivity(db, 50)
      .then((a) => setActivity(a))
      .catch((err) => console.error('[dashboard] activity failed:', err))
      .finally(() => setActivityLoading(false))

    void loadInventorySnapshot(db)
      .then(setSnapshot)
      .catch((err) => console.error('[dashboard] inventory failed:', err))
      .finally(() => setSnapshotLoading(false))

    void loadInventoryAging(db)
      .then(setAging)
      .catch((err) => console.error('[dashboard] aging failed:', err))
      .finally(() => setAgingLoading(false))

    loadRanged(30, showMargins)
  }, [loadRanged, showMargins])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // Range switch handler — kept in an event callback (not an effect)
  // so the setState calls stay out of the react-hooks/set-state-in-effect
  // rule's way. The cached bucket check means switching back to a
  // previously-viewed range is instant and doesn't re-fetch.
  const handleRangeChange = useCallback(
    (r: RangeDays) => {
      setRange(r)
      // Los skeletons se reactivan acá, en el handler de evento, no
      // dentro de loadRanged: así el camino del effect inicial queda
      // libre de setState síncrono.
      setSalesLoading(true)
      setInterestLoading(true)
      if (showMargins) setMarginsLoading(true)
      loadRanged(r, showMargins)
      if (series[r] !== null) return
      setSeriesLoading(true)
      const db = createClient()
      loadConversationsSeries(db, r)
        .then((s) => setSeries((prev) => ({ ...prev, [r]: s })))
        .catch((err) => console.error('[dashboard] series failed:', err))
        .finally(() => setSeriesLoading(false))
    },
    [series, loadRanged, showMargins],
  )

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
      </div>

      {/* ============================================================
          INVENTARIO — el estado del patio. Va primero porque es la
          pregunta que se hace todos los días: qué tengo y hace cuánto.
          ============================================================ */}
      <section className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('sections.inventory')}
        </h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {snapshotLoading || !snapshot ? (
            Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
          ) : (
            <>
              <MetricCard
                title={t('stockAvailable')}
                value={snapshot.availableCount.toLocaleString()}
                icon={Car}
                subtitle={t('ofTotal', { total: snapshot.total })}
              />
              <MetricCard
                title={t('stockValue')}
                value={formatCurrencyShort(snapshot.availableValue, defaultCurrency)}
                icon={Warehouse}
                subtitle={t('stockValueHint')}
              />
              <MetricCard
                title={t('reserved')}
                value={(snapshot.byStatus.reserved ?? 0).toLocaleString()}
                icon={Handshake}
                subtitle={t('reservedHint')}
              />
              <MetricCard
                title={t('soldTotal')}
                value={(snapshot.byStatus.sold ?? 0).toLocaleString()}
                icon={Receipt}
                subtitle={t('soldTotalHint')}
              />
            </>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <InventoryAgingChart
            data={aging}
            loading={agingLoading}
            currency={defaultCurrency}
          />
          <InventoryMixChart data={snapshot} loading={snapshotLoading} />
        </div>
      </section>

      {/* ============================================================
          COMERCIAL — qué se vendió y cuánto dejó. Comparte el selector
          de rango con la serie de conversaciones de más abajo.
          ============================================================ */}
      <section className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('sections.sales', { days: range })}
        </h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {salesLoading || !sales ? (
            Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
          ) : (
            <>
              <MetricCard
                title={t('unitsSold')}
                value={sales.unitsSold.toLocaleString()}
                icon={Receipt}
                subtitle={t('inRange', { days: range })}
              />
              <MetricCard
                title={t('revenue')}
                value={formatCurrencyShort(sales.revenue, defaultCurrency)}
                icon={DollarSign}
                subtitle={t('inRange', { days: range })}
              />
              <MetricCard
                title={t('avgTicket')}
                // Null y no 0: no hubo ventas sobre las que promediar.
                value={
                  sales.avgTicket == null
                    ? '—'
                    : formatCurrency(sales.avgTicket, defaultCurrency)
                }
                icon={Receipt}
                subtitle={
                  sales.avgTicket == null ? t('noSales') : t('perUnit')
                }
              />
              <MetricCard
                title={t('daysInStock')}
                value={
                  sales.avgDaysInStock == null
                    ? '—'
                    : t('days', { days: Math.round(sales.avgDaysInStock) })
                }
                icon={Timer}
                // Siempre se dice sobre cuántas unidades se calculó: sin
                // fecha de compra una venta no puede aportar al promedio.
                subtitle={
                  sales.avgDaysInStock == null
                    ? t('noPurchaseDates')
                    : t('overUnits', { count: sales.daysSampleSize })
                }
              />
            </>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {showMargins && (
            <MarginPanel
              data={margins}
              loading={marginsLoading}
              currency={defaultCurrency}
            />
          )}
          {/* Sin permiso de margen, el interés ocupa el ancho completo:
              no queda un hueco donde iba el panel oculto. */}
          <div className={showMargins ? '' : 'lg:col-span-2'}>
            <VehicleInterestList data={interest} loading={interestLoading} />
          </div>
        </div>
      </section>

      {/* ============================================================
          CONVERSACIONES — las métricas heredadas del CRM de WhatsApp.
          Siguen siendo útiles, pero ya no abren el tablero.
          ============================================================ */}
      <section className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('sections.conversations')}
        </h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {metricsLoading || !metrics ? (
            Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
          ) : (
            <>
              <MetricCard
                title={t('activeConversations')}
                value={metrics.activeConversations.current.toLocaleString()}
                icon={MessageSquare}
                delta={{
                  sign: metrics.activeConversations.previous,
                  label: deltaLabel(
                    metrics.activeConversations.previous,
                    t('newTodayVsYesterday'),
                    t('noChange', { suffix: t('newTodayVsYesterday') })
                  ),
                }}
              />
              <MetricCard
                title={t('newContactsToday')}
                value={metrics.newContactsToday.current.toLocaleString()}
                icon={UserPlus}
                delta={{
                  sign:
                    metrics.newContactsToday.current - metrics.newContactsToday.previous,
                  label: deltaLabel(
                    metrics.newContactsToday.current - metrics.newContactsToday.previous,
                    t('vsYesterday'),
                    t('noChange', { suffix: t('vsYesterday') })
                  ),
                }}
              />
              <MetricCard
                title={t('openDealsValue')}
                value={formatCurrency(metrics.openDealsValue, defaultCurrency)}
                icon={DollarSign}
                subtitle={t('openDeals', { count: metrics.openDealsCount })}
              />
              <MetricCard
                title={t('messagesSentToday')}
                value={metrics.messagesSentToday.current.toLocaleString()}
                icon={Send}
                delta={{
                  sign:
                    metrics.messagesSentToday.current - metrics.messagesSentToday.previous,
                  label: deltaLabel(
                    metrics.messagesSentToday.current - metrics.messagesSentToday.previous,
                    t('vsYesterday'),
                    t('noChange', { suffix: t('vsYesterday') })
                  ),
                }}
              />
            </>
          )}
        </div>

        <QuickActions />

        <ConversationsChart
          series={series}
          loading={seriesLoading}
          range={range}
          onRangeChange={handleRangeChange}
        />

        <ResponseTimeChart data={responseTime} loading={responseTimeLoading} />

        {/* El pipeline sigue en desarrollo y hoy no se usa: se conserva,
            pero deja de competir por la parte alta del tablero. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="h-full lg:col-span-2">
            <PipelineDonut
              data={pipeline}
              loading={pipelineLoading}
              currency={defaultCurrency}
            />
          </div>
          <div className="h-full lg:col-span-3">
            <ActivityFeed items={activity} loading={activityLoading} />
          </div>
        </div>
      </section>
    </div>
  )
}

// ------------------------------------------------------------

function deltaLabel(delta: number, suffix: string, noChangeLabel: string): string {
  if (delta === 0) return noChangeLabel
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toLocaleString()} ${suffix}`
}
