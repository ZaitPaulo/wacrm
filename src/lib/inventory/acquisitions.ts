// ============================================================
// Persistencia del costo de adquisición de un vehículo.
//
// Vive aparte de `payload.ts` porque escribe en OTRA tabla
// (`vehicle_acquisitions`) y bajo OTRO permiso (admin+), aunque los
// datos lleguen en el mismo body que el resto del vehículo.
//
// La RLS de la migración 508 ya rechazaría a un 'agent'; el chequeo de
// rol que hay aquí sólo sirve para devolver un 403 con mensaje en vez de
// un "0 filas afectadas" silencioso que el usuario no sabría interpretar.
// ============================================================

import { canViewMargins } from '@/lib/auth/roles'
import type { AccountRole } from '@/lib/auth/roles'
import type { getCurrentAccount } from '@/lib/auth/account'
import { buildAcquisitionPayload } from './payload'

type SupabaseClient = Awaited<ReturnType<typeof getCurrentAccount>>['supabase']

/**
 * Aplica al registro de adquisición los datos de compra que vengan en el
 * body. No hace nada si el body no los trae.
 *
 * @returns `{ error }` con un mensaje listo para responder, o `{}` si
 *   todo fue bien (incluido el caso "no había nada que hacer").
 */
export async function persistAcquisition(
  supabase: SupabaseClient,
  accountId: string,
  vehicleId: string,
  role: AccountRole,
  body: unknown,
): Promise<{ error?: string; status?: number }> {
  const parsed = buildAcquisitionPayload(body)
  if ('error' in parsed) return { error: parsed.error, status: 400 }

  const touchesAcquisition = parsed.clear || parsed.value !== null
  if (!touchesAcquisition) return {}

  if (!canViewMargins(role)) {
    return {
      error: 'Solo un administrador puede registrar el costo de compra',
      status: 403,
    }
  }

  if (parsed.clear) {
    const { error } = await supabase
      .from('vehicle_acquisitions')
      .delete()
      .eq('account_id', accountId)
      .eq('vehicle_id', vehicleId)
    if (error) {
      console.error('[acquisitions] delete error:', error)
      return { error: 'No se pudo borrar el costo de compra', status: 500 }
    }
    return {}
  }

  // onConflict en vehicle_id: la tabla tiene UNIQUE ahí, así que
  // reeditar el costo actualiza el registro en vez de crear otro.
  const { error } = await supabase.from('vehicle_acquisitions').upsert(
    {
      account_id: accountId,
      vehicle_id: vehicleId,
      purchase_cost: parsed.value!.purchase_cost,
      purchase_date: parsed.value!.purchase_date,
    },
    { onConflict: 'vehicle_id' },
  )
  if (error) {
    console.error('[acquisitions] upsert error:', error)
    return { error: 'No se pudo guardar el costo de compra', status: 500 }
  }

  return {}
}
