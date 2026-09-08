import { cache } from 'react'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type {
  ShowcaseAccount,
  ShowcaseVehicle,
  ShowcaseVehicleDetail,
  ShowcaseData,
} from './format'
import { serverSupabaseUrl } from '@/lib/supabase/server-url'

const ACCOUNT_COLUMNS =
  'id, name, default_currency, public_whatsapp, public_brand_color, public_name, public_logo_url, public_address, public_phone, public_email, public_hours'

// ============================================================
// Datos de la vitrina pública (server-only).
//
// Lee con el cliente SERVICE-ROLE porque la vitrina no tiene sesión y
// no queremos abrir acceso anónimo en la RLS. Todo se acota a la cuenta
// marcada como vitrina (accounts.showcase_enabled) y a vehículos
// 'available'. Mirror del patrón admin-client de ai/flows/automations.
// ============================================================

let _client: SupabaseClient | null = null

function admin(): SupabaseClient {
  if (!_client) {
    _client = createClient(
      serverSupabaseUrl(),
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _client
}

/**
 * Solo la cuenta marcada como vitrina, sin su inventario.
 *
 * Existe para el layout público, que necesita el color de marca y nada
 * más. Con `getShowcase()` cada vista de ficha arrastraba las 128 filas
 * de `inventory_vehicles` —con sus `images` y su `features`— para leer
 * una única columna de `accounts`: el `cache()` de React deduplica por
 * función, y la ficha llama a `getShowcaseVehicle`, no a `getShowcase`,
 * así que esa consulta no se reaprovechaba nunca.
 */
export const getShowcaseAccount = cache(async (): Promise<ShowcaseAccount | null> => {
  const db = admin()

  const { data: account, error } = await db
    .from('accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('showcase_enabled', true)
    .maybeSingle()
  if (error) {
    console.error('[showcase] account fetch error:', error)
    return null
  }
  return (account as ShowcaseAccount) ?? null
})

/**
 * Devuelve la cuenta marcada como vitrina + sus vehículos disponibles,
 * o `null` si ninguna cuenta tiene la vitrina activada.
 */
export const getShowcase = cache(async (): Promise<ShowcaseData | null> => {
  const db = admin()

  const { data: account, error: accErr } = await db
    .from('accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('showcase_enabled', true)
    .maybeSingle()
  if (accErr) {
    console.error('[showcase] account fetch error:', accErr)
    return null
  }
  if (!account) return null

  const { data: vehicles, error: vehErr } = await db
    .from('inventory_vehicles')
    .select(
      'id, brand, model, year, price, mileage, transmission, fuel_type, body_type, condition, features, images, public_ref',
    )
    .eq('account_id', account.id)
    .eq('status', 'available')
    .order('created_at', { ascending: false })
  if (vehErr) {
    console.error('[showcase] vehicles fetch error:', vehErr)
  }

  return {
    account: account as ShowcaseAccount,
    vehicles: (vehicles ?? []) as ShowcaseVehicle[],
  }
})

/**
 * Un vehículo 'available' de la cuenta vitrina, por id, con todos los
 * campos de detalle + la cuenta (para el CTA y el footer) + hasta 3
 * vehículos parecidos (misma body_type, ordenados por cercanía de precio).
 * `null` si no existe, no está disponible, o no pertenece a la vitrina activa.
 */
export const getShowcaseVehicle = cache(
  async (
    id: string,
  ): Promise<{
    account: ShowcaseAccount
    vehicle: ShowcaseVehicleDetail
    similarVehicles: ShowcaseVehicle[]
  } | null> => {
    const db = admin()

    const { data: account, error: accErr } = await db
      .from('accounts')
      .select(ACCOUNT_COLUMNS)
      .eq('showcase_enabled', true)
      .maybeSingle()
    if (accErr || !account) return null

    const { data: vehicle, error: vehErr } = await db
      .from('inventory_vehicles')
      .select(
        'id, brand, model, year, price, mileage, transmission, fuel_type, body_type, color, condition, features, images, public_ref',
      )
      .eq('account_id', account.id)
      .eq('id', id)
      .eq('status', 'available')
      .maybeSingle()
    if (vehErr || !vehicle) return null

    let similarVehicles: ShowcaseVehicle[] = []
    if (vehicle.body_type) {
      const { data: similar, error: simErr } = await db
        .from('inventory_vehicles')
        .select(
          'id, brand, model, year, price, mileage, transmission, fuel_type, body_type, condition, features, images, public_ref',
        )
        .eq('account_id', account.id)
        .eq('status', 'available')
        .eq('body_type', vehicle.body_type)
        .neq('id', vehicle.id)
        // Se piden solo los del entorno de precio (±40 %) y con tope, en
        // vez de toda la carrocería: "Camioneta" son decenas de filas con
        // sus `images`, y de ahí se usan tres. El orden final por cercanía
        // de precio se hace en memoria porque Postgres no ordena por
        // distancia a un valor sin una expresión que el cliente no expone.
        .gte('price', vehicle.price * 0.6)
        .lte('price', vehicle.price * 1.4)
        .limit(20)

      if (!simErr && similar && similar.length > 0) {
        similarVehicles = (similar as ShowcaseVehicle[])
          .sort(
            (a, b) =>
              Math.abs(Number(a.price) - Number(vehicle.price)) -
              Math.abs(Number(b.price) - Number(vehicle.price)),
          )
          .slice(0, 3)
      }
    }

    return {
      account: account as ShowcaseAccount,
      vehicle: vehicle as ShowcaseVehicleDetail,
      similarVehicles,
    }
  },
)
