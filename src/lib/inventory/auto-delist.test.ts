import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const sync = vi.hoisted(() => ({
  syncVehicleKnowledge: vi.fn<(accountId: string, vehicleId: string) => Promise<void>>(
    async () => {}
  ),
  syncVehiclePost: vi.fn<(accountId: string, vehicleId: string) => Promise<void>>(
    async () => {}
  ),
}))

vi.mock('@/lib/inventory/knowledge-sync', () => ({
  syncVehicleKnowledge: sync.syncVehicleKnowledge,
}))
vi.mock('@/lib/social/queue', () => ({ syncVehiclePost: sync.syncVehiclePost }))

import { hideVehicles } from './auto-delist'

function fakeDb(result: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn<(name: string, args: unknown) => Promise<typeof result>>(
    async () => result
  )
  return { db: { rpc } as unknown as SupabaseClient, rpc }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('hideVehicles', () => {
  it('oculta con el motivo y sincroniza solo lo que de verdad cambió', async () => {
    // Pidió dos; la base solo ocultó uno (el otro ya no estaba disponible).
    const { db, rpc } = fakeDb({ data: [{ vehicle_id: 'v1' }], error: null })

    const hidden = await hideVehicles(db, 'acc-1', ['v1', 'v2'], 'el propietario respondió que ya no está disponible')

    expect(rpc).toHaveBeenCalledWith('hide_owner_vehicles', {
      p_account_id: 'acc-1',
      p_vehicle_ids: ['v1', 'v2'],
      p_reason: 'el propietario respondió que ya no está disponible',
    })
    expect(hidden).toEqual(['v1'])
    expect(sync.syncVehicleKnowledge).toHaveBeenCalledTimes(1)
    expect(sync.syncVehicleKnowledge).toHaveBeenCalledWith('acc-1', 'v1')
    expect(sync.syncVehiclePost).toHaveBeenCalledWith('acc-1', 'v1')
  })

  it('sin vehículos no toca la base', async () => {
    const { db, rpc } = fakeDb({ data: [], error: null })

    expect(await hideVehicles(db, 'acc-1', [], 'x')).toEqual([])
    expect(rpc).not.toHaveBeenCalled()
  })

  it('un fallo del KB se registra y no deshace ni corta la baja', async () => {
    sync.syncVehicleKnowledge.mockRejectedValueOnce(new Error('kb caído'))
    const { db } = fakeDb({
      data: [{ vehicle_id: 'v1' }, { vehicle_id: 'v2' }],
      error: null,
    })

    const hidden = await hideVehicles(db, 'acc-1', ['v1', 'v2'], 'x')

    expect(hidden).toEqual(['v1', 'v2'])
    expect(sync.syncVehicleKnowledge).toHaveBeenCalledTimes(2)
    expect(console.error).toHaveBeenCalled()
  })

  it('lanza si la base rechaza la operación', async () => {
    const { db } = fakeDb({ data: null, error: { message: 'permission denied' } })

    await expect(hideVehicles(db, 'acc-1', ['v1'], 'x')).rejects.toThrow('permission denied')
    expect(sync.syncVehicleKnowledge).not.toHaveBeenCalled()
  })
})
