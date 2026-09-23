// ============================================================
// Qué le decimos al asesor cuando falla cambiar el asignado.
//
// El endpoint `PATCH /api/conversations/[conversationId]/assignee`
// devuelve mensajes en inglés pensados para quien lee un log, no para
// quien está atendiendo a un cliente. Acá se traduce el código de estado
// a una clave del catálogo.
//
// Pura y aparte del componente para poder probar la tabla de casos sin
// montar la bandeja, igual que `deal-errors.ts` con el formulario de
// negocios.
// ============================================================

/** Claves de `Inbox.messageThread` que este módulo puede devolver. */
export type AssignmentErrorKey =
  | "assignForbidden"
  | "assignCannotUnassign"
  | "assignNotMember"
  | "assignNotFound"
  | "assignRateLimited"
  | "assignFailed";

/**
 * Elige el mensaje para un intento fallido de reasignación.
 *
 * El 403 significa siempre lo mismo desde `sticky-weighted-assignment`:
 * solo un owner/admin cambia el asesor. Se distingue igual si el intento
 * era reasignar o soltar —con lo que el cliente ya sabe, si mandó
 * `null`—, para que el mensaje nombre lo que se intentó, en vez de leer
 * el texto de la respuesta, que es inglés de servidor.
 *
 * No debería ser alcanzable: al `agent` la bandeja ni le muestra el
 * desplegable. Se maneja igual porque la frontera real es el endpoint y
 * la interfaz puede cambiar.
 *
 * Cualquier estado no contemplado cae al mensaje genérico. Inventarle un
 * motivo a un fallo desconocido es peor que decir que falló.
 *
 * @param status Código HTTP de la respuesta.
 * @param opts.unassigning Si el intento era dejar la conversación sin asignar.
 */
export function assignmentErrorKey(
  status: number,
  opts: { unassigning: boolean },
): AssignmentErrorKey {
  switch (status) {
    case 400:
      return "assignNotMember";
    case 403:
      return opts.unassigning ? "assignCannotUnassign" : "assignForbidden";
    case 404:
      return "assignNotFound";
    case 429:
      return "assignRateLimited";
    default:
      return "assignFailed";
  }
}
