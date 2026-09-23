// ============================================================
// Qué le decimos al asesor cuando falla "Tomar el control" o
// "Reanudar la IA".
//
// `POST /api/ai/autoreply/[conversationId]` devuelve `error` en inglés,
// pensado para quien lee un log. Para el asesor, la ruta añade un `code`
// estable en los rechazos que tienen explicación propia, y acá se
// traduce a una clave de `Inbox.aiBanner`.
//
// Se lee el `code` y no el texto por lo mismo que `assignment-errors.ts`
// no lee el texto: el inglés de servidor puede cambiar sin aviso. Y no
// basta el código HTTP, porque los dos rechazos de la reactivación son
// 403 —y el de `requireRole` para un `viewer` también—.
// ============================================================

/** Códigos que la ruta pone en `code`. Compartidos para no divergir. */
export const AUTOREPLY_ERROR_CODES = {
  /** Un `agent` quiso devolver al bot un hilo que no es suyo. */
  notAssignee: "not_assignee",
  /**
   * Un `agent` pidió reactivar la IA en un hilo donde ya estaba activa:
   * eso solo quitaría el asesor, y soltar el hilo no le está permitido.
   * Desde la interfaz pasa con una vista vieja (otra pestaña, otro
   * compañero ya lo reactivó).
   *
   * YA NO SE EMITE desde `sticky-weighted-assignment`: reactivar dejó de
   * quitar al asesor, así que hacerlo con la IA activa es inocuo. Se
   * conserva la traducción por si un cliente viejo en caché lo recibe de
   * una versión anterior del servidor durante el despliegue.
   */
  aiAlreadyActive: "ai_already_active",
} as const;

/** Claves de `Inbox.aiBanner` que este módulo puede devolver. */
export type AutoreplyErrorKey =
  | "resumeNotYours"
  | "resumeAlreadyActive"
  | "updateError";

/**
 * Elige el mensaje para un intento fallido de pausar o reanudar la IA.
 *
 * Cualquier código no contemplado cae al mensaje genérico: inventarle un
 * motivo a un fallo desconocido es peor que decir que falló.
 *
 * @param code El campo `code` de la respuesta, si vino.
 */
export function autoreplyErrorKey(code: unknown): AutoreplyErrorKey {
  switch (code) {
    case AUTOREPLY_ERROR_CODES.notAssignee:
      return "resumeNotYours";
    case AUTOREPLY_ERROR_CODES.aiAlreadyActive:
      return "resumeAlreadyActive";
    default:
      return "updateError";
  }
}
