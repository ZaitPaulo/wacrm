import { describe, it, expect } from 'vitest'
import { pickHandoffAgent } from './pick-agent'

interface ProfileRow {
  id: string
  user_id: string
  full_name: string
  account_role: string
}

/**
 * Cliente mínimo que responde a las tres consultas que hace la función:
 * el historial de asignaciones de la conversación, los miembros de la
 * cuenta y las conversaciones abiertas asignadas.
 *
 * `historial` va del cambio más antiguo al más reciente, como se leería
 * en la tabla; el fake devuelve el último que nombra a un asesor, que es
 * lo que hace la consulta real con `order(changed_at desc).limit(1)`.
 */
function db(args: {
  profiles: ProfileRow[]
  open: (string | null)[]
  historial?: (string | null)[]
  historialFalla?: boolean
}) {
  return {
    from(table: string) {
      if (table === 'conversation_assignments') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          not: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: () => {
            if (args.historialFalla) {
              return Promise.resolve({ data: null, error: { message: 'boom' } })
            }
            const conAsesor = (args.historial ?? []).filter((a) => a !== null)
            const ultimo = conAsesor[conAsesor.length - 1] ?? null
            return Promise.resolve({
              data: ultimo ? { to_agent_id: ultimo } : null,
              error: null,
            })
          },
        }
        return chain
      }
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

const CONV = 'conv-1'

const JUAN = {
  id: 'p-juan',
  user_id: 'u-juan',
  full_name: 'Juan Marino Arias',
  account_role: 'agent',
}
const BRAYAN = {
  id: 'p-brayan',
  user_id: 'u-brayan',
  full_name: 'Brayan Hernández',
  account_role: 'agent',
}
const ANGELICA = {
  id: 'p-ange',
  user_id: 'u-ange',
  full_name: 'Angelica Molero',
  account_role: 'admin',
}
const ZAIT = {
  id: 'p-zait',
  user_id: 'u-zait',
  full_name: 'Zait Paulo',
  account_role: 'owner',
}

describe('pickHandoffAgent — reparto por carga (sin historial)', () => {
  it('elige al asesor con menos conversaciones abiertas', async () => {
    const agent = await pickHandoffAgent(
      db({
        profiles: [JUAN, BRAYAN],
        open: ['u-juan', 'u-juan', 'u-juan', 'u-brayan'],
      }),
      'acct-1',
      CONV,
    )
    expect(agent).toEqual({
      userId: 'u-brayan',
      fullName: 'Brayan Hernández',
      profileId: 'p-brayan',
    })
  })

  // Con todos en cero hace falta un criterio, y tiene que ser explicable
  // cuando un asesor pregunte por qué le llegó a él. El orden de la
  // consulta es por antigüedad, así que gana el primero de la lista.
  it('desempata por antigüedad en la cuenta', async () => {
    const agent = await pickHandoffAgent(
      db({ profiles: [JUAN, BRAYAN], open: [] }),
      'acct-1',
      CONV,
    )
    expect(agent?.userId).toBe('u-juan')
  })

  // Un admin puede entrar a la bandeja, pero no es un asesor: el reparto
  // le mando un cliente a un administrador y eso no es su trabajo.
  it('no elige a un admin, aunque este desocupado', async () => {
    const agent = await pickHandoffAgent(
      db({ profiles: [JUAN, ANGELICA], open: ['u-juan', 'u-juan'] }),
      'acct-1',
      CONV,
    )
    expect(agent?.userId).toBe('u-juan')
  })

  it('devuelve null cuando la cuenta solo tiene admins', async () => {
    const agent = await pickHandoffAgent(
      db({ profiles: [ANGELICA], open: [] }),
      'acct-1',
      CONV,
    )
    expect(agent).toBeNull()
  })

  // El owner administra el CRM; mandarle clientes por estar desocupado
  // sería repartir hacia quien no atiende.
  it('nunca elige al owner ni al admin, aunque estén en cero', async () => {
    const agent = await pickHandoffAgent(
      db({ profiles: [JUAN, ZAIT, ANGELICA], open: ['u-juan', 'u-juan'] }),
      'acct-1',
      CONV,
    )
    expect(agent?.userId).toBe('u-juan')
  })

  it('ignora las conversaciones sin asignar al contar carga', async () => {
    const agent = await pickHandoffAgent(
      db({ profiles: [JUAN, BRAYAN], open: [null, null, null, 'u-brayan'] }),
      'acct-1',
      CONV,
    )
    expect(agent?.userId).toBe('u-juan')
  })

  it('devuelve null cuando la cuenta no tiene asesores', async () => {
    const agent = await pickHandoffAgent(db({ profiles: [ZAIT], open: [] }), 'acct-1', CONV)
    expect(agent).toBeNull()
  })
})

describe('pickHandoffAgent — continuidad por historial', () => {
  // El caso que motivó el cambio: Juan reactiva la IA en un hilo suyo,
  // el hilo deja de contar como su carga, y el siguiente traspaso se lo
  // llevaba otro asesor por una diferencia de una conversación.
  it('devuelve la conversación al asesor que ya la atendió, aunque tenga más carga', async () => {
    const agent = await pickHandoffAgent(
      db({
        profiles: [JUAN, BRAYAN],
        open: ['u-juan', 'u-juan', 'u-juan'],
        historial: ['u-juan', null],
      }),
      'acct-1',
      CONV,
    )
    expect(agent).toEqual({
      userId: 'u-juan',
      fullName: 'Juan Marino Arias',
      profileId: 'p-juan',
    })
  })

  // El historial guarda también las devoluciones al bot, que no nombran
  // a nadie. Lo que manda es el último que SÍ nombra a alguien.
  it('ignora las devoluciones al bot y toma al último asesor real', async () => {
    const agent = await pickHandoffAgent(
      db({
        profiles: [JUAN, BRAYAN],
        open: ['u-brayan'],
        historial: ['u-juan', null, 'u-brayan', null],
      }),
      'acct-1',
      CONV,
    )
    expect(agent?.userId).toBe('u-brayan')
  })

  it('cae al reparto por carga cuando la conversación no tiene historial', async () => {
    const agent = await pickHandoffAgent(
      db({ profiles: [JUAN, BRAYAN], open: ['u-juan'], historial: [] }),
      'acct-1',
      CONV,
    )
    expect(agent?.userId).toBe('u-brayan')
  })

  // Se fue de la cuenta: ya no está entre los candidatos y no hay a
  // quién devolverle nada.
  it('cae al reparto por carga si el asesor anterior ya no es miembro', async () => {
    const agent = await pickHandoffAgent(
      db({
        profiles: [JUAN, BRAYAN],
        open: ['u-juan'],
        historial: ['u-robinson'],
      }),
      'acct-1',
      CONV,
    )
    expect(agent?.userId).toBe('u-brayan')
  })

  // Sigue en la cuenta pero lo ascendieron: administrar el CRM no es
  // atender clientes, así que tampoco hereda la continuidad.
  it('cae al reparto por carga si el asesor anterior ya no tiene rol agent', async () => {
    const agent = await pickHandoffAgent(
      db({
        profiles: [JUAN, BRAYAN, ANGELICA],
        open: ['u-juan'],
        historial: ['u-ange'],
      }),
      'acct-1',
      CONV,
    )
    expect(agent?.userId).toBe('u-brayan')
  })

  // El historial es una mejora de la estadística, no un requisito de la
  // transferencia: si la consulta falla —o la tabla todavía no está
  // desplegada— se reparte por carga y el cliente igual recibe asesor.
  it('reparte por carga si la consulta del historial falla', async () => {
    const agent = await pickHandoffAgent(
      db({ profiles: [JUAN, BRAYAN], open: ['u-juan'], historialFalla: true }),
      'acct-1',
      CONV,
    )
    expect(agent?.userId).toBe('u-brayan')
  })
})
