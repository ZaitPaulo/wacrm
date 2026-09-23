import type { AccountRole } from '@/lib/auth/roles'

/**
 * Quién puede cambiar la asignación de una conversación, en código.
 *
 * EL ASESOR ES PEGAJOSO (cambio `sticky-weighted-assignment`, P2)
 *
 * El asesor de un contacto permanece siempre, salvo que un `owner` o
 * `admin` lo cambie a mano: ante cada campaña, el mismo lead que escribe
 * muchas veces tiene que caer con el mismo asesor. De ahí las reglas:
 *
 *   - Solo `owner`/`admin` reasignan o sueltan. El `agent` ya no le pasa
 *     su conversación a un compañero ni la suelta —eso revierte lo que
 *     permitía el cambio `agent-performance-dashboard`—.
 *   - "Reactivar IA" ya no quita al asesor: devolverle el hilo al bot
 *     dejó de ser una forma de soltarlo. La IA ya no depende de que el
 *     hilo esté sin asesor, solo de `ai_autoreply_disabled`.
 *   - "Tomar el control" pausa la IA y solo asigna a quien lo pulsa si
 *     el hilo no tenía asesor; nunca reemplaza a uno.
 *
 * SIN SERVICE-ROLE
 *
 * Antes los dos endpoints escribían con service-role cuando actuaba un
 * `agent`, porque la política de SELECT de `conversations` (520) rechaza
 * la fila resultante cuando el `agent` se queda sin la conversación. Con
 * estas reglas eso ya no ocurre: el `admin` ve toda la cuenta, y el
 * `agent` solo pausa o reactiva la IA en un hilo que sigue siendo suyo.
 * Así que los dos escriben con la sesión, y vuelven a mandar la RLS, el
 * trigger de la 520 y el aviso con el nombre de quien reasignó.
 *
 * Los caminos automáticos (IA, automatizaciones, flujos, job) no pasan
 * por acá: los decide `auto_assign_conversation` en la base, que nunca
 * pisa a un asesor vigente, y el trigger `protect_sticky_assignment` lo
 * sostiene frente a cualquier escritura sin sesión.
 *
 * Son funciones puras a propósito: la parte que decide se prueba sin
 * base de datos ni HTTP, y los endpoints solo la aplican.
 */

/** Roles que mandan sobre cualquier conversación de su cuenta. */
const ROLES_QUE_ADMINISTRAN: readonly AccountRole[] = ['owner', 'admin']

/** ¿Es `owner` o `admin`? */
export function administra(role: AccountRole): boolean {
  return ROLES_QUE_ADMINISTRAN.includes(role)
}

/**
 * ¿Puede quien llama cambiar a mano el asesor de una conversación, a otro
 * miembro o a nadie? Solo `owner`/`admin`.
 */
export function puedeCambiarAsignacion(args: { role: AccountRole }): boolean {
  return administra(args.role)
}

/**
 * ¿Puede quien llama pausar ("Tomar el control") o reactivar la IA en
 * esta conversación?
 *
 * `owner`/`admin` en cualquiera de su cuenta. Un `agent` solo en la que
 * tiene asignada: es su cliente. `viewer` nunca: es de solo lectura.
 */
export function puedeControlarIa(args: {
  role: AccountRole
  userId: string
  currentAssigneeId: string | null
}): boolean {
  if (administra(args.role)) return true
  if (args.role !== 'agent') return false
  return args.currentAssigneeId !== null && args.currentAssigneeId === args.userId
}

/**
 * A quién queda asignada la conversación cuando alguien pulsa "Tomar el
 * control" (`assign_to_me`).
 *
 * Solo si no tenía asesor, a quien lo pulsa. Con asesor, `undefined` =
 * no se toca: tomar el control es pausar la IA, no quitarle el cliente a
 * nadie. Un admin que quiere reasignar usa el desplegable.
 */
export function asesorAlTomar(args: {
  assignToMe: boolean
  userId: string
  currentAssigneeId: string | null
}): string | undefined {
  if (!args.assignToMe) return undefined
  return args.currentAssigneeId === null ? args.userId : undefined
}

/**
 * ¿Es válido el destinatario de una reasignación?
 *
 * `conversations.assigned_agent_id` NO tiene clave ajena contra
 * `auth.users` ni contra `profiles`, así que sin esta comprobación se
 * podría escribir ahí cualquier UUID —el de otra cuenta, o uno
 * inventado— y la conversación quedaría asignada a nadie sin que la base
 * dijera una palabra.
 *
 * `miembros` son los `user_id` de los perfiles de la cuenta de quien
 * llama. `null` es soltar, y eso lo decide {@link puedeCambiarAsignacion}.
 */
export function destinatarioValido(args: {
  targetUserId: string | null
  miembros: readonly string[]
}): boolean {
  if (args.targetUserId === null) return true
  return args.miembros.includes(args.targetUserId)
}
