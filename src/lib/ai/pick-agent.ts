import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * A quién le toca la próxima conversación transferida por la IA.
 *
 * Antes esto no existía: `handoff_agent_id` era un único asesor elegido
 * a mano, y en producción todas las transferencias caían sobre la misma
 * persona mientras los tres miembros con rol `agent` estaban en cero.
 *
 * Hoy hay DOS criterios, y el orden entre ellos es la decisión:
 *
 *   1. CONTINUIDAD. Si esta conversación ya tuvo asesor, vuelve a él.
 *   2. CARGA. Si no lo tuvo —o ese asesor ya no es candidato—, va al
 *      que menos conversaciones abiertas tenga.
 *
 * La carga reparte bien un lead NUEVO, pero no debería mover uno que ya
 * tiene dueño: un cliente que ya habló con alguien no tiene por qué
 * volver a empezar con otro. El caso que lo motivó es concreto: Juan
 * reactiva la IA en un hilo suyo, el hilo deja de contar como su carga
 * —los no asignados no son carga de nadie— y el siguiente traspaso lo
 * manda a otro asesor por una diferencia de una conversación.
 *
 * La continuidad se lee del historial de asignaciones (migración 531),
 * no de `conversations.assigned_agent_id`: esa columna es el estado de
 * ahora y en este punto vale NULL, que es justamente por lo que
 * estamos repartiendo.
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

/**
 * El asesor elegido para un traspaso, con las dos identidades que piden
 * las tablas: `userId` para la conversación y `profileId` para el negocio.
 */
export interface HandoffAgent {
  userId: string
  /** Nombre completo del perfil; el aviso al cliente usa el primero. */
  fullName: string
  /**
   * `profiles.id` del asesor, que NO es su `user_id`.
   *
   * Lo pide `deals.assigned_to`, cuya FK apunta a `profiles(id)`
   * mientras que `conversations.assigned_agent_id` guarda el id de
   * `auth.users`. Confundirlos deja el negocio sin asignar o revienta
   * la FK, así que el que resuelve el asesor devuelve los dos.
   */
  profileId: string | null
}

interface ProfileRow {
  id: string
  user_id: string
  full_name: string | null
}

interface ConversationRow {
  assigned_agent_id: string | null
}

/**
 * Devuelve el asesor que recibe esta conversación —el que ya la tuvo,
 * o el que menos carga tiene—, o null cuando la cuenta no tiene a nadie
 * que pueda atender.
 *
 * Best-effort por diseño: si una consulta falla, se degrada al criterio
 * siguiente y, en el peor caso, devuelve null y la conversación cae en
 * la cola compartida. Es preferible a que un error de lectura tumbe la
 * transferencia entera, que es lo único que de verdad no puede fallar.
 */
export async function pickHandoffAgent(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
): Promise<HandoffAgent | null> {
  // Orden por antigüedad: es el desempate cuando todos están en cero, y
  // hace la elección reproducible en vez de arbitraria.
  const { data: perfiles, error: perfilesErr } = await db
    .from('profiles')
    .select('id, user_id, full_name')
    .eq('account_id', accountId)
    .in('account_role', ROLES_QUE_ATIENDEN)
    .order('created_at', { ascending: true })

  if (perfilesErr || !perfiles || perfiles.length === 0) return null
  const candidatos = perfiles as ProfileRow[]

  // ---- 1. Continuidad -------------------------------------------
  const anterior = await ultimoAsesorDeLaConversacion(db, conversationId)
  if (anterior) {
    const sigueSiendoCandidato = candidatos.find((p) => p.user_id === anterior)
    // Que ya no esté en la lista cubre los dos casos de una: se fue de
    // la cuenta, o sigue pero lo ascendieron a admin. En cualquiera de
    // los dos deja de ser a quien devolverle el cliente, y se reparte.
    if (sigueSiendoCandidato) return aHandoffAgent(sigueSiendoCandidato)
  }

  // ---- 2. Carga --------------------------------------------------
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

  return aHandoffAgent(elegido)
}

function aHandoffAgent(p: ProfileRow): HandoffAgent {
  return { userId: p.user_id, fullName: p.full_name ?? '', profileId: p.id ?? null }
}

/**
 * El último asesor que tuvo asignada esta conversación, según el
 * historial (migración 531), o null si nunca tuvo ninguno.
 *
 * Se filtra por `to_agent_id not null` a propósito: el historial
 * también guarda las devoluciones al bot (`to_agent_id` en NULL) y esas
 * no nombran a nadie. La fila más reciente que SÍ nombra a alguien es
 * quien lo atendió por última vez, y las filas de siembra sirven igual
 * para esto —su fecha es aproximada, pero el asesor que nombran es el
 * real—.
 *
 * Best-effort: cualquier error se trata como "no hay historial" y el
 * reparto cae a la carga. Cubre también la ventana en la que el código
 * ya está desplegado y la migración todavía no.
 */
async function ultimoAsesorDeLaConversacion(
  db: SupabaseClient,
  conversationId: string,
): Promise<string | null> {
  try {
    const { data, error } = await db
      .from('conversation_assignments')
      .select('to_agent_id')
      .eq('conversation_id', conversationId)
      .not('to_agent_id', 'is', null)
      .order('changed_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error || !data) return null
    return (data as { to_agent_id: string | null }).to_agent_id ?? null
  } catch {
    return null
  }
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
