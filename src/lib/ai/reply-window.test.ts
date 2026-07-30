import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  delay,
  hasNewerCustomerMessage,
  hasOutboundSince,
  type InboundRef,
} from './reply-window'

const inbound: InboundRef = { id: 'msg-2', createdAt: '2026-07-30T20:12:33.000Z' }

/** Records the PostgREST filters each query builds, and replays `rows`. */
function dbReturning(rows: unknown[], error: unknown = null) {
  const calls: Record<string, unknown[][]> = { eq: [], neq: [], or: [], in: [] }
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (...a: unknown[]) => {
      calls.eq.push(a)
      return chain
    },
    neq: (...a: unknown[]) => {
      calls.neq.push(a)
      return chain
    },
    in: (...a: unknown[]) => {
      calls.in.push(a)
      return chain
    },
    or: (...a: unknown[]) => {
      calls.or.push(a)
      return chain
    },
    limit: () => Promise.resolve({ data: rows, error }),
  }
  return { db: { from: () => chain } as unknown as SupabaseClient, calls }
}

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}))
afterEach(() => vi.restoreAllMocks())

describe('delay', () => {
  it('resolves immediately for 0', async () => {
    await expect(delay(0)).resolves.toBeUndefined()
  })
})

describe('hasNewerCustomerMessage', () => {
  it('is true when a later customer message exists', async () => {
    const { db } = dbReturning([{ id: 'msg-3' }])
    await expect(hasNewerCustomerMessage(db, 'conv-1', inbound)).resolves.toBe(true)
  })

  it('is false when nothing newer arrived', async () => {
    const { db } = dbReturning([])
    await expect(hasNewerCustomerMessage(db, 'conv-1', inbound)).resolves.toBe(false)
  })

  it('scopes to the conversation and to customer messages', async () => {
    const { db, calls } = dbReturning([])
    await hasNewerCustomerMessage(db, 'conv-1', inbound)
    expect(calls.eq).toContainEqual(['conversation_id', 'conv-1'])
    expect(calls.eq).toContainEqual(['sender_type', 'customer'])
  })

  it('breaks ties by id when timestamps collide', async () => {
    const { db, calls } = dbReturning([])
    await hasNewerCustomerMessage(db, 'conv-1', inbound)
    // WhatsApp timestamps carry second precision, so two messages from one
    // burst routinely share created_at. Without the id tiebreak both
    // dispatches would consider themselves the newest, or neither would.
    const orClause = String(calls.or[0]?.[0] ?? '')
    expect(orClause).toContain('created_at.gt.2026-07-30T20:12:33.000Z')
    expect(orClause).toContain('id.gt.msg-2')
  })

  it('is false when the query errors', async () => {
    const { db } = dbReturning([], { message: 'boom' })
    await expect(hasNewerCustomerMessage(db, 'conv-1', inbound)).resolves.toBe(false)
  })
})

describe('hasOutboundSince', () => {
  it('is true when an agent or bot message went out after the inbound', async () => {
    const { db } = dbReturning([{ id: 'msg-9' }])
    await expect(hasOutboundSince(db, 'conv-1', inbound)).resolves.toBe(true)
  })

  it('is false when nothing went out', async () => {
    const { db } = dbReturning([])
    await expect(hasOutboundSince(db, 'conv-1', inbound)).resolves.toBe(false)
  })

  it('covers both agent and bot senders with one query', async () => {
    const { db, calls } = dbReturning([])
    await hasOutboundSince(db, 'conv-1', inbound)
    expect(calls.in).toContainEqual(['sender_type', ['agent', 'bot']])
  })

  it('ignores failed sends so the customer is never left in silence', async () => {
    const { db, calls } = dbReturning([])
    await hasOutboundSince(db, 'conv-1', inbound)
    expect(calls.neq).toContainEqual(['status', 'failed'])
  })

  it('is false when the query errors', async () => {
    const { db } = dbReturning([], { message: 'boom' })
    await expect(hasOutboundSince(db, 'conv-1', inbound)).resolves.toBe(false)
  })
})
