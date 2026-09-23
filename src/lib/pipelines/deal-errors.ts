// ============================================================
// Traducción de los errores de `deals` a mensajes del catálogo.
//
// Vive acá y no dentro de `deal-form.tsx` por lo mismo que
// `deal-vehicle.ts`: es lógica pura, se prueba sin montar el
// formulario ni el cliente de Supabase, y la usan los dos caminos de
// guardado (alta y edición).
// ============================================================

import { isUniqueViolation } from "@/lib/contacts/dedupe";

/** Claves de `Pipelines.form` que este módulo puede devolver. */
export type DealErrorKey =
  | "toastDuplicateOpenDeal"
  | "toastFailedSave"
  | "toastFailedCreate";

/**
 * Elige el mensaje que ve el asesor cuando la base rechaza un negocio.
 *
 * El único caso con nombre propio es la violación de unicidad (SQLSTATE
 * 23505). Desde la migración 532 hay un índice único parcial sobre
 * `deals (conversation_id) WHERE status = 'open'`: una conversación no
 * puede tener dos negocios abiertos a la vez. Es un cambio de
 * comportamiento para la creación manual desde la bandeja, que antes lo
 * permitía, y sin esta traducción el asesor vería "No se pudo crear el
 * negocio" sin manera de saber que el negocio que quiere ya existe.
 *
 * Cualquier otro error cae al mensaje genérico de siempre: inventarle un
 * motivo a un fallo desconocido es peor que decir que falló.
 *
 * @param error Lo que devolvió Supabase en `{ error }`.
 * @param fallbackKey Mensaje genérico del camino que llamó: alta o edición.
 */
export function dealErrorKey(
  error: unknown,
  fallbackKey: "toastFailedSave" | "toastFailedCreate",
): DealErrorKey {
  if (isUniqueViolation(error)) return "toastDuplicateOpenDeal";
  return fallbackKey;
}
