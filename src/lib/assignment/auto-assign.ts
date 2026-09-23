import type { SupabaseClient } from '@supabase/supabase-js'

import type { HandoffAgent } from '@/lib/ai/pick-agent'

/**
 * La asignación automática, vista desde la aplicación.
 *
 * Quién recibe a un cliente ya NO se decide en TypeScript: lo decide la
 * base, en `auto_assign_conversation` y `ai_handoff_assign` (migración
 * 537), con este orden —conservar al asesor vigente, continuidad del
 * contacto, el preferido del camino, porcentajes—. Está en SQL porque la
 * cuota del reparto solo es correcta si la lectura del historial y la
 * escritura ocurren bajo el mismo candado, y porque la herencia entre
 * canales (un trigger) usa la misma regla de continuidad. Ver
 * `openspec/changes/sticky-weighted-assignment/design.md`, decisión 3.
 *
 * Este módulo solo llama a esas RPC y traduce su `jsonb` a un tipo. No
 * lanza nunca: quien asigna es un traspaso, una automatización o el job,
 * y ninguno de ellos debe caerse porque la asignación falló — el cliente
 * sigue en la cola compartida y el job lo recoge después.
 */

/** Qué camino pide la asignación (columna `origin` del historial). */
export type AssignmentOrigin = 'automation' | 'flow' | 'stale_job'

/** Cómo se eligió al asesor. `kept` = ya tenía uno vigente. */
export type AssignmentSource = 'kept' | 'continuity' | 'preferred' | 'weighted' | 'none'

export interface AutoAssignResult {
  /**
   * - `assigned`: se escribió un asesor nuevo.
   * - `kept`: la conversación ya tenía un asesor vigente y se conservó.
   * - `no_agent`: no había a quién asignarla; queda en la cola compartida.
   * - `not_found`: la conversación no existe.
   * - `failed`: la llamada falló o su respuesta no se entendió.
   */
  outcome: 'assigned' | 'kept' | 'no_agent' | 'not_found' | 'failed'
  source: AssignmentSource | null
  /** El asesor que queda (nuevo o conservado), o null. */
  agent: HandoffAgent | null
  /** Solo en el traspaso: created | already_open | skipped:<motivo>. */
  deal: string | null
}

const OUTCOMES = new Set(['assigned', 'kept', 'no_agent', 'not_found'])
const SOURCES = new Set(['kept', 'continuity', 'preferred', 'weighted', 'none'])

const FALLO: AutoAssignResult = { outcome: 'failed', source: null, agent: null, deal: null }

/**
 * Traduce la respuesta de las RPC. Todo lo que no tenga la forma esperada
 * es `failed`: tratar una respuesta rara como asignación haría que el
 * traspaso le dijera al cliente un nombre que no existe.
 */
export function parseAutoAssignResult(raw: unknown): AutoAssignResult {
  if (!raw || typeof raw !== 'object') return FALLO
  const r = raw as Record<string, unknown>
  if (typeof r.outcome !== 'string' || !OUTCOMES.has(r.outcome)) return FALLO

  let agent: HandoffAgent | null = null
  if (r.agent !== null && r.agent !== undefined) {
    const a = r.agent as Record<string, unknown>
    if (typeof a !== 'object' || typeof a.user_id !== 'string') return FALLO
    agent = {
      userId: a.user_id,
      profileId: typeof a.profile_id === 'string' ? a.profile_id : null,
      fullName: typeof a.full_name === 'string' ? a.full_name : '',
    }
  }

  return {
    outcome: r.outcome as AutoAssignResult['outcome'],
    source:
      typeof r.source === 'string' && SOURCES.has(r.source)
        ? (r.source as AssignmentSource)
        : null,
    agent,
    deal: typeof r.deal === 'string' ? r.deal : null,
  }
}

async function llamar(
  db: SupabaseClient,
  fn: string,
  params: Record<string, unknown>,
): Promise<AutoAssignResult> {
  try {
    const { data, error } = await db.rpc(fn, params)
    if (error) {
      console.error(`[assignment] ${fn} falló:`, error)
      return FALLO
    }
    return parseAutoAssignResult(data)
  } catch (err) {
    console.error(`[assignment] ${fn} falló:`, err)
    return FALLO
  }
}

/**
 * Asigna una conversación por el camino automático (automatizaciones,
 * flujos, job). Nunca pisa a un asesor vigente.
 *
 * @param preferredAgentId El asesor que pide el camino (el `agent_id` de
 *   una automatización, el `assign_to` de un flujo). Va después de la
 *   continuidad del contacto.
 * @param allowWeighted Si puede repartir por porcentajes cuando no hay
 *   ni continuidad ni preferido. Los flujos pasan `false`: una derivación
 *   sin asesor configurado nunca repartió.
 */
export function autoAssignConversation(
  db: SupabaseClient,
  args: {
    conversationId: string
    origin: AssignmentOrigin
    preferredAgentId?: string | null
    allowWeighted?: boolean
  },
): Promise<AutoAssignResult> {
  return llamar(db, 'auto_assign_conversation', {
    p_conversation_id: args.conversationId,
    p_origin: args.origin,
    p_preferred_agent: args.preferredAgentId ?? null,
    p_allow_weighted: args.allowWeighted ?? true,
  })
}

/**
 * El traspaso de la IA en una transacción: elige asesor, crea el negocio
 * con el título rico ANTES de escribir el asesor (para que el negocio
 * genérico del trigger no le gane), y pausa la IA con la nota en el mismo
 * UPDATE que el asesor. Si el asesor se conserva —el lead que vuelve—, la
 * base le manda un aviso propio.
 */
export function aiHandoffAssign(
  db: SupabaseClient,
  args: { conversationId: string; summary: string; dealTitle: string | null },
): Promise<AutoAssignResult> {
  return llamar(db, 'ai_handoff_assign', {
    p_conversation_id: args.conversationId,
    p_summary: args.summary,
    p_deal_title: args.dealTitle,
  })
}

/**
 * Asigna TODAS las conversaciones de un contacto (una por canal), una por
 * una, por el camino automático. Es lo que hace la acción "asignar" de
 * las automatizaciones, que opera sobre el contacto y no sobre un hilo.
 *
 * Cada conversación se resuelve por separado en la base, y ninguna pisa
 * a un asesor vigente. A diferencia de las demás funciones de este
 * módulo, LANZA si no puede leer las conversaciones: el motor de
 * automatizaciones registra un paso que lanza como fallido, y eso es lo
 * que tiene que ver quien revisa la corrida.
 */
export async function autoAssignContact(
  db: SupabaseClient,
  args: {
    accountId: string
    contactId: string
    origin: AssignmentOrigin
    preferredAgentId?: string | null
    allowWeighted?: boolean
  },
): Promise<AutoAssignResult[]> {
  const { data, error } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', args.accountId)
    .eq('contact_id', args.contactId)
  if (error) throw new Error(`no se pudieron leer las conversaciones del contacto: ${error.message}`)

  const resultados: AutoAssignResult[] = []
  for (const { id } of (data ?? []) as { id: string }[]) {
    resultados.push(
      await autoAssignConversation(db, {
        conversationId: id,
        origin: args.origin,
        preferredAgentId: args.preferredAgentId ?? null,
        allowWeighted: args.allowWeighted ?? true,
      }),
    )
  }
  return resultados
}
