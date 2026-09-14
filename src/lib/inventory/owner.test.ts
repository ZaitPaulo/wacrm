import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ownerContactError } from './owner'

/** Supabase falso: `contacts` devuelve la fila solo si cuenta e id coinciden. */
function fakeDb(existing: { id: string; account_id: string }[], fail = false) {
  return {
    from() {
      const filtros: Record<string, string> = {}
      const chain = {
        select: () => chain,
        eq: (col: string, val: string) => {
          filtros[col] = val
          return chain
        },
        maybeSingle: () =>
          Promise.resolve(
            fail
              ? { data: null, error: new Error('boom') }
              : {
                  data:
                    existing.find(
                      (c) => c.id === filtros.id && c.account_id === filtros.account_id,
                    ) ?? null,
                  error: null,
                },
          ),
      }
      return chain
    },
  } as unknown as SupabaseClient
}

const CONTACTOS = [{ id: 'c-1', account_id: 'acc-1' }]

describe('ownerContactError', () => {
  it('sin propietario no hay nada que validar', async () => {
    expect(await ownerContactError(fakeDb(CONTACTOS), 'acc-1', null)).toBeNull()
    expect(await ownerContactError(fakeDb(CONTACTOS), 'acc-1', undefined)).toBeNull()
  })

  it('acepta un contacto de la cuenta', async () => {
    expect(await ownerContactError(fakeDb(CONTACTOS), 'acc-1', 'c-1')).toBeNull()
  })

  it('rechaza un contacto de otra cuenta', async () => {
    expect(await ownerContactError(fakeDb(CONTACTOS), 'acc-2', 'c-1')).toMatch(/no es un contacto/)
  })

  it('lanza si la consulta falla', async () => {
    await expect(ownerContactError(fakeDb(CONTACTOS, true), 'acc-1', 'c-1')).rejects.toThrow('boom')
  })
})
