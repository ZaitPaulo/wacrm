// ============================================================
// Baja automática de vehículos (migración 525).
//
// El sistema oculta por su cuenta un vehículo en dos casos: su
// propietario respondió "NO" a la consulta de disponibilidad (paso de
// automatización `hide_owner_vehicle`), o no respondió en el plazo de la
// difusión (baja por silencio, en el cron de difusiones). Los dos pasan
// por acá, para que ocultar signifique siempre lo mismo:
//
//   1. `hide_owner_vehicles` en la base: `hidden` SOLO si seguía
//      disponible, y una línea fechada con el motivo en las notas.
//   2. Por cada vehículo que de verdad cambió, lo mismo que hace la API
//      del inventario al cambiar un estado: sacarlo de la base de
//      conocimiento del bot y retirar su borrador de redes.
//
// El paso 2 es best-effort, como en la API: la baja ya está hecha — la
// vitrina y el índice del bot filtran por estado — y un fallo del KB no
// puede deshacerla ni cortar a los demás vehículos.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { syncVehicleKnowledge } from '@/lib/inventory/knowledge-sync'
import { syncVehiclePost } from '@/lib/social/queue'

/**
 * Oculta los vehículos que sigan disponibles y devuelve los ids que
 * cambió. `reason` completa la nota: "Oculto automáticamente el
 * AAAA-MM-DD: <reason>.". Lanza solo si la base rechaza la operación.
 */
export async function hideVehicles(
  db: SupabaseClient,
  accountId: string,
  vehicleIds: string[],
  reason: string
): Promise<string[]> {
  if (vehicleIds.length === 0) return []

  const { data, error } = await db.rpc('hide_owner_vehicles', {
    p_account_id: accountId,
    p_vehicle_ids: vehicleIds,
    p_reason: reason,
  })
  if (error) throw new Error(`hide_owner_vehicles failed: ${error.message}`)

  const hidden = ((data ?? []) as { vehicle_id: string }[]).map((r) => r.vehicle_id)
  await syncHiddenVehicles(accountId, hidden)
  return hidden
}

/**
 * Lo que sigue a ocultar un vehículo: fuera del KB del bot y sin borrador
 * de redes. La usa también la baja por silencio, que oculta en SQL y
 * solo necesita este paso.
 */
export async function syncHiddenVehicles(
  accountId: string,
  vehicleIds: string[]
): Promise<void> {
  for (const id of vehicleIds) {
    try {
      await syncVehicleKnowledge(accountId, id)
    } catch (err) {
      console.error('[auto-delist] KB sync error:', id, err)
    }
    try {
      await syncVehiclePost(accountId, id)
    } catch (err) {
      console.error('[auto-delist] social queue error:', id, err)
    }
  }
}
