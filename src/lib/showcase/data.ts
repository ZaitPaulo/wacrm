import { cache } from 'react'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type {
  ShowcaseAccount,
  ShowcaseVehicle,
  ShowcaseVehicleDetail,
  ShowcaseData,
} from './format'

const ACCOUNT_COLUMNS =
  'id, name, public_whatsapp, public_name, public_logo_url, public_address, public_phone, public_email, public_hours'

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
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _client
}

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
      'id, brand, model, year, price, mileage, transmission, fuel_type, body_type, features, images',
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
 * campos de detalle + la cuenta (para el CTA y el footer). `null` si no
 * existe, no está disponible, o no pertenece a la vitrina activa.
 */
export const getShowcaseVehicle = cache(
  async (
    id: string,
  ): Promise<{ account: ShowcaseAccount; vehicle: ShowcaseVehicleDetail } | null> => {
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
        'id, brand, model, year, price, mileage, transmission, fuel_type, body_type, color, condition, doors, features, images',
      )
      .eq('account_id', account.id)
      .eq('id', id)
      .eq('status', 'available')
      .maybeSingle()
    if (vehErr || !vehicle) return null

    return {
      account: account as ShowcaseAccount,
      vehicle: vehicle as ShowcaseVehicleDetail,
    }
  },
)
