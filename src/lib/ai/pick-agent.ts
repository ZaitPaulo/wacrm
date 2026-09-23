/**
 * El asesor de un traspaso, tal como lo usa la aplicación.
 *
 * A QUIÉN le toca un cliente ya no se decide acá. `pickHandoffAgent`
 * (continuidad por historial de la conversación, luego reparto por carga)
 * se retiró con el cambio `sticky-weighted-assignment`: la elección vive
 * en la base (`auto_assign_conversation` / `ai_handoff_assign`, migración
 * 537) con el orden conservar → continuidad del CONTACTO → preferido →
 * porcentajes. Se movió porque la cuota del reparto solo es correcta si
 * la lectura del historial y la escritura ocurren bajo el mismo candado
 * —dos traspasos simultáneos en TypeScript elegían al mismo asesor—, y
 * porque la herencia entre canales es un trigger que necesita la misma
 * regla de continuidad. El envoltorio está en `@/lib/assignment/auto-assign`.
 */

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

/**
 * El nombre con el que un vendedor se presenta por WhatsApp.
 * "Juan Marino Arias Medina" en un mensaje comercial suena a registro
 * civil; "Juan" suena a la persona que va a escribir.
 */
export function primerNombre(fullName: string | null | undefined): string | null {
  const primero = (fullName ?? '').trim().split(/\s+/)[0]
  return primero ? primero : null
}
