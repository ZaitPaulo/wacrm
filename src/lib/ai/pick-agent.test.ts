import { describe, it, expect } from 'vitest'
import { pickHandoffAgent } from './pick-agent'

interface ProfileRow {
  user_id: string
  full_name: string
  account_role: string
}

/**
 * Cliente mínimo que responde a las dos consultas que hace la función:
 * los miembros de la cuenta y las conversaciones abiertas asignadas.
 */
function db(args: { profiles: ProfileRow[]; open: (string | null)[] }) {
  return {
    from(table: string) {
      if (table === 'profiles') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: (_col: string, roles: string[]) => {
            chain.roles = roles
            return chain
          },
          order: () =>
            Promise.resolve({
              data: args.profiles.filter((p) => chain.roles.includes(p.account_role)),
              error: null,
            }),
          roles: [] as string[],
        }
        return chain
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () =>
              Promise.resolve({
                data: args.open.map((assigned_agent_id) => ({ assigned_agent_id })),
                error: null,
              }),
          }),
        }),
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const JUAN = { user_id: 'u-juan', full_name: 'Juan Marino Arias', account_role: 'agent' }
const BRAYAN = { user_id: 'u-brayan', full_name: 'Brayan Hernández', account_role: 'agent' }
const ANGELICA = { user_id: 'u-ange', full_name: 'Angelica Molero', account_role: 'admin' }
const ZAIT = { user_id: 'u-zait', full_name: 'Zait Paulo', account_role: 'owner' }

describe('pickHandoffAgent', () => {
  it('elige al asesor con menos conversaciones abiertas', async () => {
    const agent = await pickHandoffAgent(
      db({
        profiles: [JUAN, BRAYAN],
        open: ['u-juan', 'u-juan', 'u-juan', 'u-brayan'],
      }),
      'acct-1',
    )
    expect(agent).toEqual({ userId: 'u-brayan', fullName: 'Brayan Hernández' })
  })

  // Con todos en cero hace falta un criterio, y tiene que ser explicable
  // cuando un asesor pregunte por qué le llegó a él. El orden de la
  // consulta es por antigüedad, así que gana el primero de la lista.
  it('desempata por antigüedad en la cuenta', async () => {
    const agent = await pickHandoffAgent(
      db({ profiles: [JUAN, BRAYAN], open: [] }),
      'acct-1',
    )
    expect(agent?.userId).toBe('u-juan')
  })

  // Un admin puede entrar a la bandeja, pero no es un asesor: el reparto
  // le mando un cliente a un administrador y eso no es su trabajo.
  it('no elige a un admin, aunque este desocupado', async () => {
    const agent = await pickHandoffAgent(
      db({ profiles: [JUAN, ANGELICA], open: ['u-juan', 'u-juan'] }),
      'acct-1',
    )
    expect(agent?.userId).toBe('u-juan')
  })

  it('devuelve null cuando la cuenta solo tiene admins', async () => {
    const agent = await pickHandoffAgent(db({ profiles: [ANGELICA], open: [] }), 'acct-1')
    expect(agent).toBeNull()
  })

  // El owner administra el CRM; mandarle clientes por estar desocupado
  // sería repartir hacia quien no atiende.
  it('nunca elige al owner ni al admin, aunque estén en cero', async () => {
    const agent = await pickHandoffAgent(
      db({ profiles: [JUAN, ZAIT, ANGELICA], open: ['u-juan', 'u-juan'] }),
      'acct-1',
    )
    expect(agent?.userId).toBe('u-juan')
  })

  it('ignora las conversaciones sin asignar al contar carga', async () => {
    const agent = await pickHandoffAgent(
      db({ profiles: [JUAN, BRAYAN], open: [null, null, null, 'u-brayan'] }),
      'acct-1',
    )
    expect(agent?.userId).toBe('u-juan')
  })

  it('devuelve null cuando la cuenta no tiene asesores', async () => {
    const agent = await pickHandoffAgent(db({ profiles: [ZAIT], open: [] }), 'acct-1')
    expect(agent).toBeNull()
  })
})
