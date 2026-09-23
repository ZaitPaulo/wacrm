import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  aiHandoffAssign,
  autoAssignContact,
  autoAssignConversation,
  parseAutoAssignResult,
} from './auto-assign'

const AGENTE = {
  user_id: 'u-juan',
  profile_id: 'p-juan',
  full_name: 'Juan Marino Arias',
}

/** Cliente que solo sabe responder a `rpc`, y recuerda con qué se lo llamó. */
function db(respuesta: { data?: unknown; error?: unknown } | Error) {
  const rpc = vi.fn(async () => {
    if (respuesta instanceof Error) throw respuesta
    return { data: respuesta.data ?? null, error: respuesta.error ?? null }
  })
  return { client: { rpc } as unknown as SupabaseClient, rpc }
}

describe('parseAutoAssignResult', () => {
  it('traduce una asignación con su asesor en las dos identidades', () => {
    expect(
      parseAutoAssignResult({ outcome: 'assigned', source: 'weighted', agent: AGENTE }),
    ).toEqual({
      outcome: 'assigned',
      source: 'weighted',
      agent: { userId: 'u-juan', profileId: 'p-juan', fullName: 'Juan Marino Arias' },
      deal: null,
    })
  })

  it('conserva el resultado del negocio del traspaso', () => {
    expect(
      parseAutoAssignResult({ outcome: 'kept', source: 'kept', agent: AGENTE, deal: 'created' })
        .deal,
    ).toBe('created')
  })

  it('sin asesor devuelve agent nulo', () => {
    expect(parseAutoAssignResult({ outcome: 'no_agent', source: 'none', agent: null })).toEqual({
      outcome: 'no_agent',
      source: 'none',
      agent: null,
      deal: null,
    })
  })

  // Un perfil borrado entre medio deja el profile_id en null: el negocio
  // nace sin asignar, pero la conversación sigue siendo de ese usuario.
  it('tolera un asesor sin perfil', () => {
    const r = parseAutoAssignResult({
      outcome: 'assigned',
      source: 'continuity',
      agent: { user_id: 'u-x', profile_id: null, full_name: '' },
    })
    expect(r.agent).toEqual({ userId: 'u-x', profileId: null, fullName: '' })
  })

  it('una respuesta que no se entiende es un fallo, no una asignación', () => {
    expect(parseAutoAssignResult(null).outcome).toBe('failed')
    expect(parseAutoAssignResult({ outcome: 'vaya' }).outcome).toBe('failed')
    expect(parseAutoAssignResult({ outcome: 'assigned', agent: { user_id: 3 } }).outcome).toBe(
      'failed',
    )
  })
})

describe('autoAssignConversation', () => {
  it('llama a la RPC con el origen, el preferido y si se reparte', async () => {
    const { client, rpc } = db({ data: { outcome: 'assigned', source: 'preferred', agent: AGENTE } })
    const r = await autoAssignConversation(client, {
      conversationId: 'c-1',
      origin: 'flow',
      preferredAgentId: 'u-juan',
      allowWeighted: false,
    })
    expect(rpc).toHaveBeenCalledWith('auto_assign_conversation', {
      p_conversation_id: 'c-1',
      p_origin: 'flow',
      p_preferred_agent: 'u-juan',
      p_allow_weighted: false,
    })
    expect(r.outcome).toBe('assigned')
  })

  it('por defecto reparte y no tiene preferido', async () => {
    const { client, rpc } = db({ data: { outcome: 'kept', source: 'kept', agent: AGENTE } })
    await autoAssignConversation(client, { conversationId: 'c-1', origin: 'automation' })
    expect(rpc).toHaveBeenCalledWith('auto_assign_conversation', {
      p_conversation_id: 'c-1',
      p_origin: 'automation',
      p_preferred_agent: null,
      p_allow_weighted: true,
    })
  })

  it('un error de la base se devuelve como fallo, sin lanzar', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = db({ error: { message: 'boom' } })
    const r = await autoAssignConversation(client, { conversationId: 'c-1', origin: 'automation' })
    expect(r.outcome).toBe('failed')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('un cliente que revienta tampoco lanza', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = db(new Error('red caída'))
    const r = await autoAssignConversation(client, { conversationId: 'c-1', origin: 'stale_job' })
    expect(r.outcome).toBe('failed')
    spy.mockRestore()
  })
})

describe('aiHandoffAssign', () => {
  it('le pasa a la RPC la nota y el título del negocio', async () => {
    const { client, rpc } = db({
      data: { outcome: 'assigned', source: 'weighted', agent: AGENTE, deal: 'created' },
    })
    const r = await aiHandoffAssign(client, {
      conversationId: 'c-1',
      summary: 'nota',
      dealTitle: 'Carlos — Mazda 3',
    })
    expect(rpc).toHaveBeenCalledWith('ai_handoff_assign', {
      p_conversation_id: 'c-1',
      p_summary: 'nota',
      p_deal_title: 'Carlos — Mazda 3',
    })
    expect(r.deal).toBe('created')
  })

  it('un fallo de la RPC no lanza', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = db({ error: { message: 'function does not exist' } })
    const r = await aiHandoffAssign(client, { conversationId: 'c-1', summary: 'n', dealTitle: 't' })
    expect(r.outcome).toBe('failed')
    spy.mockRestore()
  })
})

describe('autoAssignContact', () => {
  /** Cliente con las conversaciones del contacto y una RPC que asigna. */
  function dbContacto(args: { conversaciones: string[]; error?: unknown }) {
    const filtros: [string, unknown][] = []
    const rpc = vi.fn(async (_fn: string, params: Record<string, unknown>) => ({
      data: {
        outcome: params.p_conversation_id === 'c-kept' ? 'kept' : 'assigned',
        source: 'weighted',
        agent: AGENTE,
      },
      error: null,
    }))
    const chain = {
      select: () => chain,
      eq: (col: string, v: unknown) => {
        filtros.push([col, v])
        return chain
      },
      then: (resolve: (v: unknown) => unknown) =>
        resolve({
          data: args.error ? null : args.conversaciones.map((id) => ({ id })),
          error: args.error ?? null,
        }),
    }
    return {
      client: { from: () => chain, rpc } as unknown as SupabaseClient,
      rpc,
      filtros,
    }
  }

  it('asigna cada conversación del contacto, acotada a la cuenta', async () => {
    const { client, rpc, filtros } = dbContacto({ conversaciones: ['c-1', 'c-kept'] })
    const r = await autoAssignContact(client, {
      accountId: 'acct-1',
      contactId: 'contact-1',
      origin: 'automation',
      preferredAgentId: null,
    })
    expect(filtros).toContainEqual(['account_id', 'acct-1'])
    expect(filtros).toContainEqual(['contact_id', 'contact-1'])
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(r.map((x) => x.outcome)).toEqual(['assigned', 'kept'])
  })

  it('sin conversaciones no llama a la RPC', async () => {
    const { client, rpc } = dbContacto({ conversaciones: [] })
    const r = await autoAssignContact(client, {
      accountId: 'acct-1',
      contactId: 'contact-1',
      origin: 'automation',
    })
    expect(rpc).not.toHaveBeenCalled()
    expect(r).toEqual([])
  })

  it('si no puede leer las conversaciones lanza, para que el paso quede como fallido', async () => {
    const { client } = dbContacto({ conversaciones: [], error: { message: 'boom' } })
    await expect(
      autoAssignContact(client, { accountId: 'acct-1', contactId: 'contact-1', origin: 'automation' }),
    ).rejects.toThrow()
  })
})
