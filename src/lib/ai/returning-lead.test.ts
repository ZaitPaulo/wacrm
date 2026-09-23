import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { reactivateBotForReturningLead } from './returning-lead'

function db(respuesta: { data?: unknown; error?: unknown } | Error) {
  const rpc = vi.fn(async () => {
    if (respuesta instanceof Error) throw respuesta
    return { data: respuesta.data ?? null, error: respuesta.error ?? null }
  })
  return { client: { rpc } as unknown as SupabaseClient, rpc }
}

describe('reactivateBotForReturningLead', () => {
  it('le pide a la base la decisión, con la conversación y el entrante', async () => {
    const { client, rpc } = db({ data: true })
    await expect(reactivateBotForReturningLead(client, 'conv-1', 'msg-1')).resolves.toBe(true)
    expect(rpc).toHaveBeenCalledWith('reactivate_ai_for_returning_lead', {
      p_conversation_id: 'conv-1',
      p_inbound_message_id: 'msg-1',
    })
  })

  it('devuelve false cuando la base decide no reactivar', async () => {
    const { client } = db({ data: false })
    await expect(reactivateBotForReturningLead(client, 'conv-1', 'msg-1')).resolves.toBe(false)
  })

  // Corre en la difusión del webhook: un fallo acá no puede costar el
  // resto (flujos, automatizaciones, IA).
  it('no lanza ante un error de la base', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = db({ error: { message: 'function does not exist' } })
    await expect(reactivateBotForReturningLead(client, 'conv-1', 'msg-1')).resolves.toBe(false)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('no lanza ante un cliente que revienta', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = db(new Error('red caída'))
    await expect(reactivateBotForReturningLead(client, 'conv-1', 'msg-1')).resolves.toBe(false)
    spy.mockRestore()
  })
})
