"use client"

import Link from 'next/link'
import { useState } from 'react'
import {
  MessageSquare,
  UserPlus,
  Briefcase,
  Radio,
  Zap,
  Inbox,
} from 'lucide-react'
import type { ComponentType } from 'react'
import type { ActivityItem, ActivityKind } from '@/lib/dashboard/types'
import { useLocale } from '@/hooks/use-locale'
import type { Dictionary } from '@/lib/dictionaries/es'
import { interpolate } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'

interface ActivityFeedProps {
  items: ActivityItem[] | null
  loading: boolean
}

const PAGE_SIZES = [5, 10, 20, 50] as const
type PageSize = (typeof PAGE_SIZES)[number]

interface KindTheme {
  icon: ComponentType<{ className?: string }>
  /** Tailwind classes for the round icon badge + label color. */
  badge: string
}

const KIND_THEME: Record<ActivityKind, KindTheme> = {
  message: { icon: MessageSquare, badge: 'bg-blue-500/10 text-blue-400' },
  contact: { icon: UserPlus, badge: 'bg-primary/10 text-primary' },
  deal: { icon: Briefcase, badge: 'bg-primary/10 text-primary' },
  broadcast: { icon: Radio, badge: 'bg-amber-500/10 text-amber-400' },
  automation: { icon: Zap, badge: 'bg-rose-500/10 text-rose-400' },
}

/**
 * Turns an activity row's facts into a sentence in the active language.
 *
 * The switch is exhaustive over `ActivityItem['kind']`, so adding a
 * kind to the union without handling it here fails the build rather
 * than silently rendering an empty row.
 */
function activityText(item: ActivityItem, t: Dictionary): string {
  const a = t.dashboard.activity
  switch (item.kind) {
    case 'message':
      return interpolate(a.message, { who: item.who ?? a.unknownContact })
    case 'contact':
      return interpolate(a.contact, { who: item.who ?? a.unknownContact })
    case 'deal':
      return item.stageName
        ? interpolate(a.dealInStage, {
            title: item.dealTitle,
            stage: item.stageName,
          })
        : interpolate(a.dealUpdated, { title: item.dealTitle })
    case 'broadcast':
      return item.status === 'sent'
        ? interpolate(a.broadcastSent, {
            name: item.broadcastName,
            count: item.recipients,
          })
        : interpolate(a.broadcastOther, {
            name: item.broadcastName,
            status: item.status,
            count: item.recipients,
          })
    case 'automation':
      return interpolate(item.failed ? a.automationFailed : a.automationTriggered, {
        name: item.automationName ?? a.unnamedAutomation,
        who: item.who ?? a.someContact,
      })
  }
}

export function ActivityFeed({ items, loading }: ActivityFeedProps) {
  const { t, formatRelativeTime } = useLocale()
  // Start at 5 — a quick scan of the most recent events without
  // dominating vertical real estate. User expands explicitly via the
  // footer control when they want deeper history.
  const [pageSize, setPageSize] = useState<PageSize>(5)

  const totalLoaded = items?.length ?? 0
  const visible = items?.slice(0, pageSize) ?? []
  // A size option is "useful" if picking it would reveal rows the
  // smaller option doesn't already show. With PAGE_SIZES=[5,10,20,50]:
  // "10" is useful only once we've loaded ≥6 items, "20" once ≥11, etc.
  // The smallest option is always enabled.
  const isSizeUseful = (size: PageSize, i: number) =>
    i === 0 || totalLoaded > PAGE_SIZES[i - 1]

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">
          {t.dashboard.activity.title}
        </h2>
        <Link
          href="/inbox"
          className="text-xs font-medium text-primary hover:text-primary/80"
        >
          {t.dashboard.activity.viewAll}
        </Link>
      </header>

      {loading || !items ? (
        <div className="space-y-2 p-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="p-5">
          <EmptyState
            icon={Inbox}
            title={t.dashboard.activity.emptyTitle}
            hint={t.dashboard.activity.emptyHint}
          />
        </div>
      ) : (
        <>
          <ul className="divide-y divide-border">
            {visible.map((it, i) => {
              const theme = KIND_THEME[it.kind]
              const Icon = theme.icon
              // Alternating row background for scanability. bg-muted/40
              // keeps the stripe visible in both light and dark modes
              // (bg-card/40 vanishes against a white card surface in light).
              const stripe = i % 2 === 0 ? 'bg-transparent' : 'bg-muted/40'
              const row = (
                <div className="flex items-center gap-3 px-5 py-2.5">
                  <span
                    className={cn(
                      'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full',
                      theme.badge,
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {activityText(it, t)}
                  </span>
                  <span className="flex-shrink-0 text-xs text-muted-foreground tabular-nums">
                    {relativeTime(it.at, formatRelativeTime)}
                  </span>
                </div>
              )
              return (
                <li key={it.id} className={cn(stripe, 'transition-colors hover:bg-muted/40')}>
                  {it.href ? (
                    <Link href={it.href} className="block">
                      {row}
                    </Link>
                  ) : (
                    row
                  )}
                </li>
              )
            })}
          </ul>
          <footer className="flex items-center justify-between border-t border-border px-5 py-3 text-xs">
            <span className="text-muted-foreground tabular-nums">
              {interpolate(t.dashboard.activity.showing, {
                visible: visible.length,
                total: `${totalLoaded}${totalLoaded === 50 ? '+' : ''}`,
              })}
            </span>
            <div className="flex items-center gap-1">
              <span className="mr-1 text-muted-foreground">
                {t.dashboard.activity.show}
              </span>
              {PAGE_SIZES.map((size, i) => {
                const disabled = !isSizeUseful(size, i)
                return (
                  <button
                    key={size}
                    type="button"
                    onClick={() => setPageSize(size)}
                    disabled={disabled}
                    className={cn(
                      'rounded-md px-2 py-1 font-medium tabular-nums transition-colors',
                      pageSize === size
                        ? 'bg-secondary text-secondary-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground',
                    )}
                  >
                    {size}
                  </button>
                )
              })}
            </div>
          </footer>
        </>
      )}
    </section>
  )
}

/**
 * The previous implementation hand-built "5m ago" / "2d ago", which was
 * English by construction and had no way to become anything else. The
 * locale-bound formatter covers the same ladder — seconds through years
 * — and phrases it in the active language.
 *
 * The NaN guard stays: an unparseable timestamp should render an empty
 * cell, not "Invalid Date".
 */
function relativeTime(
  iso: string,
  format: (value: Date | string | number) => string,
): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  return format(then)
}
