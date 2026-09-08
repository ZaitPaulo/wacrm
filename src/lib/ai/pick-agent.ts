import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * A quién le toca la próxima conversación transferida por la IA.
 *
 * Antes esto no existía: `handoff_agent_id` era un único asesor elegido
 * a mano, y en producción todas las transferencias caían sobre la misma
 * persona mientras los tres miembros con rol `agent` estaban en cero.
 *
 * El criterio es la carga real —conversaciones abiertas asignadas— y no
 * un turno rotativo, porque repartir parejo sin mirar quién ya tiene
 * diez hilos vivos no reparte nada.
 */

/**
 * Roles que atienden clientes: solo `agent`.
 *
 * `admin` estuvo aquí un rato y fue un error: el reparto le mandó un
 * cliente a un administrador de LoraMotors el 2026-09-07. Que un admin
 * pueda abrir la bandeja no significa que le toque atender; los asesores
 * son los `agent` y punto.
 */
const ROLES_QUE_ATIENDEN = ['agent']

export interface HandoffAgent {
  userId: string
  /** Nombre completo del perfil; el aviso al cliente usa el primero. */
  fullName: string
}

interface ProfileRow {
  user_id: string
  full_name: string | null
}

interface ConversationRow {
  assigned_agent_id: string | null
}

/**
 * Devuelve el asesor con menos conversaciones abiertas, o null cuando la
 * cuenta no tiene a nadie que pueda atender.
 *
 * Best-effort por diseño: si una de las dos consultas falla, devuelve
 * null y la conversación cae en la cola compartida. Es preferible a que
 * un error de lectura tumbe la transferencia entera, que es lo único
 * que de verdad no puede fallar.
 */
export async function pickHandoffAgent(
  db: SupabaseClient,
  accountId: string,
): Promise<HandoffAgent | null> {
  // Orden por antigüedad: es el desempate cuando todos están en cero, y
  // hace la elección reproducible en vez de arbitraria.
  const { data: perfiles, error: perfilesErr } = await db
    .from('profiles')
    .select('user_id, full_name')
    .eq('account_id', accountId)
    .in('account_role', ROLES_QUE_ATIENDEN)
    .order('created_at', { ascending: true })

  if (perfilesErr || !perfiles || perfiles.length === 0) return null
  const candidatos = perfiles as ProfileRow[]

  const { data: abiertas, error: abiertasErr } = await db
    .from('conversations')
    .select('assigned_agent_id')
    .eq('account_id', accountId)
    .eq('status', 'open')

  if (abiertasErr) return null

  const carga = new Map<string, number>()
  for (const c of (abiertas ?? []) as ConversationRow[]) {
    // Las conversaciones sin dueño no son carga de nadie.
    if (!c.assigned_agent_id) continue
    carga.set(c.assigned_agent_id, (carga.get(c.assigned_agent_id) ?? 0) + 1)
  }

  // `reduce` sobre la lista ya ordenada: al comparar con `<` estricto, un
  // empate conserva al que venía antes, que es exactamente el desempate
  // por antigüedad.
  const elegido = candidatos.reduce((mejor, actual) =>
    (carga.get(actual.user_id) ?? 0) < (carga.get(mejor.user_id) ?? 0) ? actual : mejor,
  )

  return { userId: elegido.user_id, fullName: elegido.full_name ?? '' }
}

/**
 * El nombre con el que un vendedor se presenta por WhatsApp.
 * "Juan Marino Arias Medina" en un mensaje comercial suena a registro
 * civil; "Juan" suena a la persona que va a escribir.
 */
export function primerNombre(fullName: string | null | undefined): string | null {
  const primero = (fullName ?? '').trim().split(/\s+/)[0]
  return primero ? primero : null
}
