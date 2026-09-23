import type { HandoffRequest } from './types'

/**
 * El título del negocio que nace cuando la IA transfiere la conversación.
 *
 * La creación del negocio ya no vive acá: desde el cambio
 * `sticky-weighted-assignment` la hace la base, dentro de la misma
 * transacción que asigna al asesor (`ai_handoff_assign` →
 * `ensure_open_deal_for_contact`, migraciones 536-537). Tenía que ser así
 * por el orden: toda asignación a un asesor abre ahora un negocio
 * genérico por trigger, y si ese llegaba primero, el índice de "un
 * negocio abierto" hacía que se perdiera el título del traspaso. En la
 * base, el negocio rico se crea ANTES de escribir el asesor y el trigger
 * lo encuentra ya hecho.
 *
 * Lo que sí sigue acá es armar el título, porque sale de la petición de
 * traspaso que el modelo devolvió y que solo conoce TypeScript.
 */

/**
 * Título de la tarjeta: el nombre del cliente y el vehículo que pidió,
 * que es lo que el asesor necesita leer en el tablero sin abrir nada.
 *
 * Solo se arman con lo que el bot SÍ obtuvo. Un traspaso urgente puede
 * traer apenas el nombre, y entonces el título es el nombre: meterle un
 * "Sin vehículo" lo convertiría en un dato, y no lo es. Cuando no hay
 * ninguno de los dos —el traspaso por fallo técnico— se dice de dónde
 * vino la tarjeta.
 */
export function buildHandoffDealTitle(request?: HandoffRequest | null): string {
  const partes = [request?.nombre, request?.interes]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter((v) => v.length > 0)

  return partes.length > 0 ? partes.join(' — ') : 'Traspaso del asistente'
}
