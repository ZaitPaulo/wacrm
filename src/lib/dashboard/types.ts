// Shared result shapes the dashboard components consume. Centralised
// here so each component stays thin and the page-level loader wires
// them up without type gymnastics.

export interface MetricDelta {
  current: number
  previous: number
}

export interface MetricsBundle {
  activeConversations: MetricDelta
  newContactsToday: MetricDelta
  openDealsValue: number
  openDealsCount: number
  messagesSentToday: MetricDelta
}

export interface ConversationsSeriesPoint {
  day: string // YYYY-MM-DD local
  incoming: number
  outgoing: number
}

export interface PipelineStageSlice {
  id: string
  name: string
  color: string
  dealCount: number
  totalValue: number
}

export interface PipelineDonutData {
  stages: PipelineStageSlice[]
  totalValue: number
}

export interface ResponseTimeBucket {
  /** 0 = Mon … 6 = Sun (Monday-first). */
  dow: number
  /** Average first-response time in minutes. Null means no samples. */
  avgMinutes: number | null
  samples: number
}

export interface ResponseTimeSummary {
  buckets: ResponseTimeBucket[]
  thisWeekAvg: number | null
  lastWeekAvg: number | null
}

export type ActivityKind =
  | 'message'
  | 'deal'
  | 'broadcast'
  | 'automation'
  | 'contact'

interface ActivityItemBase {
  id: string
  /** ISO timestamp the item happened at, drives relative-time + sort. */
  at: string
  /** Optional deep-link for the whole row (not all items have a target). */
  href?: string
}

/**
 * Activity rows carry the *facts* about what happened, not a finished
 * sentence. `loadActivity` used to build English prose here ("New
 * message from Ana"), which left the feed untranslatable — by the time
 * the component saw it, there was no key left to look up.
 *
 * The phrasing now belongs to `activity-feed.tsx`, which composes it
 * from the dictionary. Adding a kind means adding a variant here and a
 * matching branch there; the compiler's exhaustiveness check on the
 * discriminated union enforces that pairing.
 */
export type ActivityItem =
  | (ActivityItemBase & { kind: 'message'; who: string | null })
  | (ActivityItemBase & { kind: 'contact'; who: string | null })
  | (ActivityItemBase & {
      kind: 'deal'
      dealTitle: string
      /** Null when the deal has no stage — the copy differs. */
      stageName: string | null
    })
  | (ActivityItemBase & {
      kind: 'broadcast'
      broadcastName: string
      /** Raw DB status; only 'sent' gets its own phrasing. */
      status: string
      recipients: number
    })
  | (ActivityItemBase & {
      kind: 'automation'
      automationName: string | null
      who: string | null
      failed: boolean
    })
