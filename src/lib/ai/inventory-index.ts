import type { SupabaseClient } from '@supabase/supabase-js'
import { KB_BODY, KB_TRANSMISSION } from '@/lib/inventory/knowledge-sync'

// ============================================================
// El inventario COMPLETO que ve el asistente en cada respuesta.
//
// El bot conocía el inventario solo por RAG: 5 extractos elegidos por
// parecido de texto sobre 123 vehículos. Eso sirve para "cuéntame del
// Sandero" y falla para "quiero algo de 25 millones", porque la
// similitud vectorial no ordena magnitudes. El 2026-09-07 le dijo a un
// cliente que no quedaba nada en su presupuesto teniendo un Sandero en
// $22.000.000 disponible: no mintió, informó sobre el 4% del catálogo
// que le mostraron.
//
// Arreglarlo solo para el precio dejaba el mismo hueco para el año, el
// kilometraje o la transmisión. Así que el modelo recibe la lista
// entera y filtra él. Medido sobre el inventario real: 123 vehículos,
// ~2.000 tokens, ~$0.0015 por mensaje.
//
// El RAG sigue: esto cubre QUÉ existe, los extractos cubren el detalle
// de un vehículo concreto (color, cilindraje, placa, ficha con fotos).
// ============================================================

/**
 * Tope de vehículos en el índice. 400 son ~6.500 tokens, cómodos, y
 * dejan a LoraMotors triplicar su inventario sin tocar nada.
 *
 * Pasado el tope el índice se recorta Y se declara incompleto, lo que
 * le retira al modelo el permiso de afirmar que algo no existe. Un
 * índice truncado presentado como completo sería peor que el problema
 * original: hoy el bot no sabe lo que no vio; así creería saberlo.
 */
export const INVENTORY_INDEX_LIMIT = 400

/** El inventario cambia pocas veces al día y los mensajes llegan en
 *  ráfagas. Un minuto evita una consulta por mensaje y deja que un
 *  vehículo vendido desaparezca casi enseguida. */
const CACHE_TTL_MS = 60_000

export interface InventoryIndex {
  /** Una línea por vehículo, listo para el prompt. */
  text: string
  /** Cuántos hay disponibles en total (antes del recorte). */
  total: number
  /** True cuando `text` no los trae todos. */
  truncated: boolean
}

interface VehicleRow {
  public_ref: string | null
  brand: string
  model: string
  year: number
  price: number
  mileage: number | null
  transmission: string | null
  body_type: string | null
}

const cache = new Map<string, { at: number; value: InventoryIndex | null }>()

/** Para los tests, y por si alguna vez hace falta forzar una relectura. */
export function clearInventoryIndexCache(): void {
  cache.clear()
}

/** 22.000.000 → "$22M"; 59.900.000 → "$59.9M". El decimal solo cuando
 *  aporta: es una columna para comparar de un vistazo, no para cotizar
 *  — la cifra exacta se la da al cliente desde la ficha del RAG. */
function millones(price: number): string {
  const m = price / 1_000_000
  const txt = m.toFixed(1).replace(/\.0$/, '')
  return `$${txt}M`
}

function linea(v: VehicleRow): string {
  // Los nulos se omiten en vez de imprimirse: una línea con "null" o con
  // separadores vacíos le enseña ruido al modelo.
  const partes = [
    v.public_ref,
    `${v.brand} ${v.model} ${v.year}`,
    millones(v.price),
    v.mileage != null ? `${Math.round(v.mileage / 1000)}k kms` : null,
    v.transmission ? (KB_TRANSMISSION[v.transmission] ?? v.transmission) : null,
    v.body_type ? (KB_BODY[v.body_type] ?? v.body_type) : null,
  ]
  return partes.filter(Boolean).join(' · ')
}

/**
 * Índice del inventario disponible de la cuenta, o null cuando no hay
 * nada que mostrar o la lectura falla.
 *
 * Null nunca es un error para el llamador: se responde sin índice, que
 * es exactamente como se respondía antes. Una consulta caída no puede
 * costarle la respuesta a un cliente.
 */
export async function buildInventoryIndex(
  db: SupabaseClient,
  accountId: string,
): Promise<InventoryIndex | null> {
  const hit = cache.get(accountId)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value

  const { data, error } = await db
    .from('inventory_vehicles')
    .select('public_ref, brand, model, year, price, mileage, transmission, body_type')
    .eq('account_id', accountId)
    .eq('status', 'available')
    // Por precio ascendente: es el criterio que más aparece en la
    // conversación, y deja "lo más barato que tienes" en la primera
    // línea, donde el modelo mira con menos esfuerzo.
    .order('price', { ascending: true })

  let value: InventoryIndex | null = null
  if (!error && data && data.length > 0) {
    const rows = data as VehicleRow[]
    const mostrados = rows.slice(0, INVENTORY_INDEX_LIMIT)
    value = {
      text: mostrados.map(linea).join('\n'),
      total: rows.length,
      truncated: rows.length > INVENTORY_INDEX_LIMIT,
    }
  }

  cache.set(accountId, { at: Date.now(), value })
  return value
}
