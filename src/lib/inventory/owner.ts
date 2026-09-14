// ============================================================
// Propietario de un vehículo (migración 525).
//
// La FK `inventory_vehicles.owner_contact_id → contacts` solo comprueba
// que el contacto EXISTA, no de quién es. Sin esta validación, una
// petición armada a mano podría colgarle a un vehículo el contacto de
// otra cuenta — y el "NO" o el silencio de ese contacto ocultarían un
// vehículo ajeno.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Por qué no se puede usar este contacto como propietario, o `null` si
 * se puede. Sin propietario (`null` / `undefined`) siempre se puede.
 * Lanza si la consulta falla: la ruta lo convierte en un 500.
 */
export async function ownerContactError(
  supabase: SupabaseClient,
  accountId: string,
  contactId: string | null | undefined,
): Promise<string | null> {
  if (!contactId) return null
  const { data, error } = await supabase
    .from('contacts')
    .select('id')
    .eq('account_id', accountId)
    .eq('id', contactId)
    .maybeSingle()
  if (error) throw error
  return data ? null : 'El propietario no es un contacto de esta cuenta'
}
