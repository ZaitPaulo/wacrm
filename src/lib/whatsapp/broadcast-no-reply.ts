// ============================================================
// Baja por silencio de las difusiones (migración 525).
//
// Una difusión con `no_reply_hide_after_days` oculta, vencido el plazo
// desde el envío ORIGINAL, los vehículos disponibles de cada destinatario
// que no escribió nada desde entonces. Es la regla del cliente para la
// consulta de disponibilidad a los dueños: dos meses sin respuesta y el
// carro sale de la vitrina.
//
// Quién se da de baja lo decide `apply_due_no_reply_hides` en la base, en
// una transacción y una sola vez por destinatario. Este módulo solo pide
// la pasada y hace lo que sigue a ocultar: sacar cada vehículo del KB del
// bot y retirar su borrador de redes.
//
// A diferencia de los recordatorios, NO pasa por el horario de atención:
// no le escribe a nadie.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { syncHiddenVehicles } from '@/lib/inventory/auto-delist'

/** Destinatarios revisados por pasada. Con el cron cada 5 minutos, sobra. */
export const NO_REPLY_MAX_PER_PASS = 200

export interface NoReplyPassResult {
  /** Vehículos ocultados en esta pasada. */
  hidden: number
}

export async function runNoReplyDelisting(db: SupabaseClient): Promise<NoReplyPassResult> {
  const { data, error } = await db.rpc('apply_due_no_reply_hides', {
    p_limit: NO_REPLY_MAX_PER_PASS,
  })
  if (error) throw new Error(`apply_due_no_reply_hides failed: ${error.message}`)

  const rows = (data ?? []) as { account_id: string; vehicle_id: string }[]

  // El KB se sincroniza por cuenta: `syncVehicleKnowledge` lee con la
  // cuenta como filtro y un vehículo nunca se busca en otra.
  const byAccount = new Map<string, string[]>()
  for (const r of rows) {
    const ids = byAccount.get(r.account_id) ?? []
    ids.push(r.vehicle_id)
    byAccount.set(r.account_id, ids)
  }
  for (const [accountId, ids] of byAccount) {
    await syncHiddenVehicles(accountId, ids)
  }

  return { hidden: rows.length }
}
