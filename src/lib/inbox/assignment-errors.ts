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
 * El 403 tiene dos causas distintas del lado del servidor y el mismo
 * código: reasignar un hilo que no es tuyo, o dejarlo sin asignar siendo
 * `agent`. Se distinguen acá con lo que el cliente ya sabe —si mandó
 * `null` estaba soltando el hilo—, en vez de leer el texto de la
 * respuesta, que es inglés de servidor y puede cambiar sin aviso.
 *
 * El caso de soltar no debería ser alcanzable desde el desplegable, que
 * ya esconde "Sin asignar" para un `agent`, pero se maneja igual: la
 * frontera real es el endpoint y la interfaz puede cambiar.
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
