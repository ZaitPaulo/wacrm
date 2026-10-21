import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/i18n/server-catalog', () => ({ loadCatalogSection: async () => null }))

import { BILLING_ALERT_INTERVAL_MS, notifyBillingExhausted } from './billing-alert'

/**
 * Doble de la base que imita el UPDATE condicional: solo "reclama" si el
 * último aviso es NULL o más viejo que el corte que viene en el `.or()`.
 */
function fakeDb(state: { alertedAt: string | null; admins: string[] }) {
  const inserted: Record<string, unknown>[] = []
  const db = {
    from(table: string) {
      if (table === 'ai_configs') {
        let patch: { billing_alerted_at: string } | null = null
        let cutoff = ''
        const chain = {
          update: (p: { billing_alerted_at: string }) => ((patch = p), chain),
          eq: () => chain,
          or: (expr: string) => ((cutoff = expr.split('lt.')[1] ?? ''), chain),
          select: async () => {
            const claim = state.alertedAt === null || state.alertedAt < cutoff
            if (claim && patch) state.alertedAt = patch.billing_alerted_at
            return { data: claim ? [{ account_id: 'acct-1' }] : [], error: null }
          },
        }
        return chain
      }
      if (table === 'profiles') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: async () => ({ data: state.admins.map((user_id) => ({ user_id })), error: null }),
        }
        return chain
      }
      if (table === 'notifications') {
        return {
          insert: async (rows: Record<string, unknown>[]) => {
            inserted.push(...rows)
            return { error: null }
          },
        }
      }
      throw new Error(`tabla inesperada ${table}`)
    },
  }
  return { db: db as unknown as SupabaseClient, inserted }
}

describe('notifyBillingExhausted', () => {
  let state: { alertedAt: string | null; admins: string[] }
  beforeEach(() => {
    state = { alertedAt: null, admins: ['owner-1', 'admin-1'] }
  })

  it('avisa a cada owner y admin por el CRM, con enlace a los ajustes del bot', async () => {
    const { db, inserted } = fakeDb(state)
    expect(await notifyBillingExhausted(db, 'acct-1')).toBe(2)
    expect(inserted.map((r) => r.user_id)).toEqual(['owner-1', 'admin-1'])
    expect(inserted[0]).toMatchObject({
      type: 'ai_billing_exhausted',
      account_id: 'acct-1',
      link_path: '/agents',
    })
    expect(String(inserted[0].body)).toContain('Google AI Studio')
  })

  it('dos fallos dentro de 6 h dan un solo aviso', async () => {
    const { db, inserted } = fakeDb(state)
    const t0 = new Date('2026-10-16T19:31:00Z')
    await notifyBillingExhausted(db, 'acct-1', t0)
    await notifyBillingExhausted(db, 'acct-1', new Date(t0.getTime() + 60_000))
    expect(inserted).toHaveLength(2) // una fila por destinatario, un solo aviso
  })

  it('pasadas 7 h sale un aviso nuevo', async () => {
    const { db, inserted } = fakeDb(state)
    const t0 = new Date('2026-10-16T19:31:00Z')
    await notifyBillingExhausted(db, 'acct-1', t0)
    await notifyBillingExhausted(db, 'acct-1', new Date(t0.getTime() + BILLING_ALERT_INTERVAL_MS + 3_600_000))
    expect(inserted).toHaveLength(4)
  })

  it('sin owner ni admin no inserta nada', async () => {
    state.admins = []
    const { db, inserted } = fakeDb(state)
    expect(await notifyBillingExhausted(db, 'acct-1')).toBe(0)
    expect(inserted).toHaveLength(0)
  })
})
