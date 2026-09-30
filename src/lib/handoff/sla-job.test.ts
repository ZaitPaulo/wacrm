import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { runHandoffSlaJob } from './sla-job'

/**
 * Base falsa: devuelve filas por tabla y registra lo que se escribe. El
 * UPDATE condicional "gana" mientras `claimWins` sea true.
 */
function fakeDb(opts: {
  waiting: Record<string, unknown>[]
  settings?: Record<string, unknown> | null
  account?: Record<string, unknown> | null
  admins?: { user_id: string }[]
  agentName?: string
  claimWins?: boolean
}) {
  const inserts: { table: string; rows: unknown }[] = []
  const updates: Record<string, unknown>[] = []

  function chain(table: string) {
    let payload: Record<string, unknown> | null = null
    const c: Record<string, unknown> = {}
    const self = () => c
    Object.assign(c, {
      select: () => {
        if (payload) {
          updates.push(payload)
          return Promise.resolve({ data: opts.claimWins === false ? [] : [{ id: 'x' }], error: null })
        }
        return c
      },
      eq: self,
      not: self,
      is: self,
      in: () =>
        Promise.resolve({ data: table === 'profiles' ? (opts.admins ?? []) : [], error: null }),
      limit: () => Promise.resolve({ data: table === 'conversations' ? opts.waiting : [], error: null }),
      maybeSingle: () => {
        if (table === 'assignment_settings') return Promise.resolve({ data: opts.settings ?? null, error: null })
        if (table === 'accounts') return Promise.resolve({ data: opts.account ?? null, error: null })
        if (table === 'profiles') return Promise.resolve({ data: { full_name: opts.agentName ?? 'Juan Arias' }, error: null })
        return Promise.resolve({ data: null, error: null })
      },
      update: (p: Record<string, unknown>) => {
        payload = p
        return c
      },
      insert: (rows: unknown) => {
        inserts.push({ table, rows })
        return Promise.resolve({ error: null })
      },
    })
    return c
  }

  const db = { from: (table: string) => chain(table) } as unknown as SupabaseClient
  return { db, inserts, updates }
}

const HORARIO = {
  quiet_hours_enabled: true,
  business_hours: {
    sun: null,
    mon: ['08:00', '18:00'],
    tue: ['08:00', '18:00'],
    wed: ['08:00', '18:00'],
    thu: ['08:00', '18:00'],
    fri: ['08:00', '18:00'],
    sat: ['08:00', '14:00'],
  },
  holiday_calendar: 'CO',
}

function waitingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conv-1',
    account_id: 'acct-1',
    contact_id: 'contact-1',
    assigned_agent_id: 'u-juan',
    // Martes 2026-09-08 a las 10:00, hora local.
    ai_waiting_agent_since: new Date('2026-09-08T10:00:00').toISOString(),
    handoff_reminded_at: null,
    handoff_escalated_at: null,
    contact: { name: 'Sebastián' },
    ...overrides,
  }
}

beforeEach(() => vi.stubEnv('NEXT_PUBLIC_APP_LOCALE', 'es'))
afterEach(() => vi.unstubAllEnvs())

describe('runHandoffSlaJob', () => {
  it('a los 20 minutos le recuerda al asesor', async () => {
    const f = fakeDb({ waiting: [waitingRow()], account: HORARIO })

    const r = await runHandoffSlaJob(f.db, new Date('2026-09-08T10:20:00'))

    expect(r).toEqual({ checked: 1, reminded: 1, escalated: 0 })
    expect(f.inserts).toHaveLength(1)
    expect(f.inserts[0].rows).toMatchObject({
      user_id: 'u-juan',
      type: 'handoff_reminder',
      conversation_id: 'conv-1',
      title: 'Cliente esperando: Sebastián',
      body: 'Lleva 20 min esperando tu primer mensaje desde el traspaso del bot.',
    })
    expect(f.updates[0]).toHaveProperty('handoff_reminded_at')
  })

  it('a los 50 minutos avisa a owner y admin, sin el asesor, y no reasigna', async () => {
    const f = fakeDb({
      waiting: [waitingRow({ handoff_reminded_at: new Date('2026-09-08T10:15:00').toISOString() })],
      account: HORARIO,
      admins: [{ user_id: 'u-owner' }, { user_id: 'u-admin' }, { user_id: 'u-juan' }],
    })

    const r = await runHandoffSlaJob(f.db, new Date('2026-09-08T10:50:00'))

    expect(r.escalated).toBe(1)
    const rows = f.inserts[0].rows as Record<string, unknown>[]
    expect(rows.map((x) => x.user_id)).toEqual(['u-owner', 'u-admin'])
    expect(rows[0]).toMatchObject({
      type: 'handoff_unattended',
      title: 'Juan no ha atendido a Sebastián',
      body: 'Lleva 50 min esperando desde el traspaso del bot.',
    })
    expect(f.updates.some((u) => 'assigned_agent_id' in u)).toBe(false)
  })

  it('si otra pasada ya reclamó el aviso, no lo duplica', async () => {
    const f = fakeDb({ waiting: [waitingRow()], account: HORARIO, claimWins: false })

    const r = await runHandoffSlaJob(f.db, new Date('2026-09-08T10:20:00'))

    expect(r.reminded).toBe(0)
    expect(f.inserts).toHaveLength(0)
  })

  it('fuera de horario no avisa', async () => {
    const f = fakeDb({
      waiting: [waitingRow({ ai_waiting_agent_since: new Date('2026-09-08T17:50:00').toISOString() })],
      account: HORARIO,
    })

    const r = await runHandoffSlaJob(f.db, new Date('2026-09-08T19:00:00'))

    expect(r).toMatchObject({ reminded: 0, escalated: 0 })
  })

  it('respeta los plazos de la cuenta (recordatorio apagado)', async () => {
    const f = fakeDb({
      waiting: [waitingRow()],
      account: HORARIO,
      settings: { handoff_remind_after_minutes: null, handoff_escalate_after_minutes: 30 },
      admins: [{ user_id: 'u-owner' }],
    })

    const r = await runHandoffSlaJob(f.db, new Date('2026-09-08T10:20:00'))

    expect(r).toMatchObject({ reminded: 0, escalated: 0 })
  })

  it('sin conversaciones en espera no lee nada más', async () => {
    const f = fakeDb({ waiting: [] })
    expect(await runHandoffSlaJob(f.db)).toEqual({ checked: 0, reminded: 0, escalated: 0 })
  })
})
