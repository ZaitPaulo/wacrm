import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadAgentPerformance } from './queries'

/**
 * Cliente mínimo: la RPC es lo único que toca esta consulta.
 *
 * Los conteos llegan como STRING a propósito — PostgREST serializa
 * `bigint` y `numeric` así para no perder precisión en JS, y el mapeo
 * tiene que convertirlos o la interfaz terminaría concatenando textos.
 */
function db(res: { data?: unknown; error?: unknown }) {
  return {
    rpc: (name: string) => {
      if (name !== 'agent_performance_metrics') {
        throw new Error(`RPC inesperada: ${name}`)
      }
      return Promise.resolve({ data: res.data ?? null, error: res.error ?? null })
    },
  } as unknown as SupabaseClient
}

const JUAN = {
  agent_user_id: 'u-juan',
  agent_profile_id: 'p-juan',
  full_name: 'Juan Marino Arias Medina',
  account_role: 'agent' as const,
  is_unassigned: false,
  open_conversations: '15',
  open_conversations_without_deal: '13',
  open_deals: '3',
  deals_by_stage: [
    {
      stage_id: 'st-prospecto',
      stage_name: 'Prospecto',
      color: '#3b82f6',
      pipeline_id: 'p-ventas',
      position: 0,
      deals: 2,
    },
    {
      stage_id: 'st-cotizado',
      stage_name: 'Cotizado',
      color: '#8b5cf6',
      pipeline_id: 'p-ventas',
      position: 2,
      deals: 1,
    },
  ],
  avg_first_response_seconds: '5700.0000000000000000',
  response_samples: '2',
}

const BRAYAN = {
  agent_user_id: 'u-brayan',
  agent_profile_id: 'p-brayan',
  full_name: 'Brayan Hernández Gómez',
  account_role: 'agent' as const,
  is_unassigned: false,
  open_conversations: '0',
  open_conversations_without_deal: '0',
  open_deals: '0',
  deals_by_stage: null,
  avg_first_response_seconds: null,
  response_samples: '0',
}

/**
 * Un `admin` con cartera. Desde el ajuste del 2026-09-21 se lleva fila
 * propia: sus conversaciones son gestión real de clientes —la campaña de
 * propietarios— y antes caían en "Sin asignar", que decía 178 huérfanas
 * donde había 108. La RPC no devuelve el rol: para el mapeo es una fila
 * como cualquier otra.
 */
const ANGELICA = {
  agent_user_id: 'u-ange',
  agent_profile_id: 'p-ange',
  full_name: 'Angelica Maria Molero',
  account_role: 'admin' as const,
  is_unassigned: false,
  open_conversations: '70',
  open_conversations_without_deal: '70',
  open_deals: '0',
  deals_by_stage: null,
  avg_first_response_seconds: null,
  response_samples: '0',
}

const SIN_ASIGNAR = {
  agent_user_id: null,
  agent_profile_id: null,
  full_name: null,
  account_role: null,
  is_unassigned: true,
  open_conversations: '177',
  open_conversations_without_deal: '176',
  open_deals: '1',
  deals_by_stage: [
    {
      stage_id: 'st-prospecto',
      stage_name: 'Prospecto',
      color: null,
      pipeline_id: 'p-ventas',
      position: 0,
      deals: 1,
    },
  ],
  avg_first_response_seconds: null,
  response_samples: '0',
}

describe('loadAgentPerformance', () => {
  it('mapea la fila de un asesor con sus tres métricas', async () => {
    const [juan] = await loadAgentPerformance(db({ data: [JUAN] }))

    expect(juan).toMatchObject({
      agentUserId: 'u-juan',
      // `deals.assigned_to` apunta a `profiles(id)`: el perfil viaja
      // aparte del user_id y no se pueden confundir.
      agentProfileId: 'p-juan',
      fullName: 'Juan Marino Arias Medina',
      accountRole: 'agent',
      isUnassigned: false,
      openConversations: 15,
      openConversationsWithoutDeal: 13,
      openDeals: 3,
      avgFirstResponseSeconds: 5700,
      responseSamples: 2,
    })
    expect(juan.dealsByStage).toEqual([
      {
        stageId: 'st-prospecto',
        stageName: 'Prospecto',
        color: '#3b82f6',
        pipelineId: 'p-ventas',
        position: 0,
        deals: 2,
      },
      {
        stageId: 'st-cotizado',
        stageName: 'Cotizado',
        color: '#8b5cf6',
        pipelineId: 'p-ventas',
        position: 2,
        deals: 1,
      },
    ])
  })

  // PostgREST manda `bigint` y `numeric` como string. Sin la conversión,
  // "15" + "0" sería "150" en cualquier suma de la interfaz.
  it('convierte a número los conteos que llegan como texto', async () => {
    const [juan] = await loadAgentPerformance(db({ data: [JUAN] }))
    expect(typeof juan.openConversations).toBe('number')
    expect(typeof juan.openConversationsWithoutDeal).toBe('number')
    expect(typeof juan.openDeals).toBe('number')
    expect(typeof juan.responseSamples).toBe('number')
    expect(typeof juan.avgFirstResponseSeconds).toBe('number')
  })

  // ESCENARIO: Asesor sin clientes asignados / Cuenta sin negocios.
  it('conserva el vacío como vacío: cero clientes, sin datos, sin tiempo', async () => {
    const [brayan] = await loadAgentPerformance(db({ data: [BRAYAN] }))

    expect(brayan.openConversations).toBe(0)
    expect(brayan.openConversationsWithoutDeal).toBe(0)
    // Null y NO un arreglo vacío ni etapas en cero: "sin datos" tiene
    // que poder distinguirse de "medimos y dio cero".
    expect(brayan.dealsByStage).toBeNull()
    // ESCENARIO: Asesor que nunca respondió → ausente, no cero minutos.
    expect(brayan.avgFirstResponseSeconds).toBeNull()
    expect(brayan.responseSamples).toBe(0)
  })

  // ESCENARIO: La fila sin asignar no mide tiempo.
  it('mapea la fila "Sin asignar" sin asesor y sin tiempo de respuesta', async () => {
    const [sinAsignar] = await loadAgentPerformance(db({ data: [SIN_ASIGNAR] }))

    expect(sinAsignar.isUnassigned).toBe(true)
    expect(sinAsignar.agentUserId).toBeNull()
    expect(sinAsignar.fullName).toBeNull()
    expect(sinAsignar.accountRole).toBeNull()
    expect(sinAsignar.openConversations).toBe(177)
    // La fila "Sin asignar" también lo lleva: uno de sus 177 hilos tiene
    // negocio, los otros 176 no.
    expect(sinAsignar.openConversationsWithoutDeal).toBe(176)
    expect(sinAsignar.avgFirstResponseSeconds).toBeNull()
    // Su desglose por etapa sí se calcula, con el mismo criterio.
    expect(sinAsignar.dealsByStage?.[0].deals).toBe(1)
  })

  it('le pone color a una etapa que no lo tenga, para no romper el render', async () => {
    const [fila] = await loadAgentPerformance(db({ data: [SIN_ASIGNAR] }))
    expect(fila.dealsByStage?.[0].color).toBe('#64748b')
  })

  // ESCENARIO: Una administradora con cartera.
  it('mapea a un miembro que no es agent pero tiene cartera', async () => {
    const [ange] = await loadAgentPerformance(db({ data: [ANGELICA] }))

    expect(ange).toMatchObject({
      agentUserId: 'u-ange',
      fullName: 'Angelica Maria Molero',
      // El rol viaja en la fila: es lo que le permite a la interfaz
      // explicar por qué una administradora sale junto a los asesores.
      accountRole: 'admin',
      // No es la fila "Sin asignar": sus 70 son trabajo con dueño.
      isUnassigned: false,
      openConversations: 70,
    })
  })

  // El dato que motiva la columna: Juan tiene 15 conversaciones abiertas
  // y 3 negocios abiertos, pero 13 hilos sin negocio, no 12. La
  // diferencia es un negocio suyo que cuelga de la conversación de otra
  // persona — `open_deals` se agrupa por `deals.assigned_to` y
  // `open_conversations` por `conversations.assigned_agent_id`. Restar
  // habría dado 12 y habría mentido.
  it('el conteo sin negocio no es la resta de los otros dos', async () => {
    const [juan] = await loadAgentPerformance(db({ data: [JUAN] }))

    expect(juan.openConversationsWithoutDeal).toBe(13)
    expect(juan.openConversations - juan.openDeals).toBe(12)
    expect(juan.openConversationsWithoutDeal).not.toBe(
      juan.openConversations - juan.openDeals,
    )
  })

  // Se cuenta sobre el mismo conjunto de filas que `openConversations`,
  // así que nunca puede pasarse. Si se pasara, sería un error de
  // agrupación en la RPC.
  it('nunca supera las conversaciones abiertas de la fila', async () => {
    const filas = await loadAgentPerformance(
      db({ data: [JUAN, BRAYAN, ANGELICA, SIN_ASIGNAR] }),
    )
    for (const f of filas) {
      expect(f.openConversationsWithoutDeal).toBeLessThanOrEqual(f.openConversations)
    }
  })

  // El rol de cada fila, de una pasada: los asesores con `agent`, quien
  // sale por cartera con el suyo, y "Sin asignar" sin rol porque no es
  // una persona.
  it('trae el rol de cada fila, y null en la fila "Sin asignar"', async () => {
    const filas = await loadAgentPerformance(
      db({ data: [JUAN, BRAYAN, ANGELICA, SIN_ASIGNAR] }),
    )
    expect(filas.map((f) => f.accountRole)).toEqual(['agent', 'agent', 'admin', null])
  })

  // El orden lo decide la RPC —asesores, luego quien sale por cartera,
  // y "Sin asignar" al final— y el mapeo no lo reordena.
  it('respeta el orden que trae la RPC', async () => {
    const filas = await loadAgentPerformance(
      db({ data: [JUAN, BRAYAN, ANGELICA, SIN_ASIGNAR] }),
    )
    expect(filas.map((f) => f.fullName)).toEqual([
      'Juan Marino Arias Medina',
      'Brayan Hernández Gómez',
      'Angelica Maria Molero',
      null,
    ])
    expect(filas.map((f) => f.isUnassigned)).toEqual([false, false, false, true])
  })

  // ESCENARIO: El asesor no ve la tabla. La RPC comprueba el rol adentro
  // y devuelve cero filas en vez de un error, así que la interfaz trata
  // "no te toca" igual que "no hay nada que mostrar".
  it('devuelve una lista vacía cuando la RPC no da filas', async () => {
    expect(await loadAgentPerformance(db({ data: [] }))).toEqual([])
    expect(await loadAgentPerformance(db({ data: null }))).toEqual([])
  })

  // Un fallo real sí se propaga: el dashboard lo registra y muestra su
  // estado de error, en vez de una tabla vacía que se leería como "no
  // hay asesores".
  it('propaga el error de la RPC', async () => {
    await expect(
      loadAgentPerformance(db({ error: { message: 'boom' } })),
    ).rejects.toBeTruthy()
  })
})
