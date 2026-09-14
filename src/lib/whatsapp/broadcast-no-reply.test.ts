import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const delist = vi.hoisted(() => ({
  syncHiddenVehicles: vi.fn<(accountId: string, ids: string[]) => Promise<void>>(
    async () => {}
  ),
}))
vi.mock('@/lib/inventory/auto-delist', () => delist)

import { runNoReplyDelisting } from './broadcast-no-reply'

function fakeDb(result: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn<(name: string, args: unknown) => Promise<typeof result>>(
    async () => result
  )
  return { db: { rpc } as unknown as SupabaseClient, rpc }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runNoReplyDelisting', () => {
  it('pide la pasada y sincroniza lo ocultado, agrupado por cuenta', async () => {
    const { db, rpc } = fakeDb({
      data: [
        { account_id: 'acc-1', vehicle_id: 'v1' },
        { account_id: 'acc-2', vehicle_id: 'v9' },
        { account_id: 'acc-1', vehicle_id: 'v2' },
      ],
      error: null,
    })

    const res = await runNoReplyDelisting(db)

    expect(rpc).toHaveBeenCalledWith('apply_due_no_reply_hides', { p_limit: 200 })
    expect(delist.syncHiddenVehicles).toHaveBeenCalledWith('acc-1', ['v1', 'v2'])
    expect(delist.syncHiddenVehicles).toHaveBeenCalledWith('acc-2', ['v9'])
    expect(res).toEqual({ hidden: 3 })
  })

  it('sin nada vencido no sincroniza nada', async () => {
    const { db } = fakeDb({ data: [], error: null })

    expect(await runNoReplyDelisting(db)).toEqual({ hidden: 0 })
    expect(delist.syncHiddenVehicles).not.toHaveBeenCalled()
  })

  it('lanza si la base rechaza la pasada', async () => {
    const { db } = fakeDb({ data: null, error: { message: 'boom' } })

    await expect(runNoReplyDelisting(db)).rejects.toThrow('boom')
  })
})
