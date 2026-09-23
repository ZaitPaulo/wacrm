import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * El lead que vuelve habla primero con el bot.
 *
 * Con el asesor pegajoso (P2) la pausa del traspaso también lo es: un
 * cliente que vuelve semanas después por otra campaña no volvería a oír
 * al bot nunca. La regla, decidida por el Director: si entra un mensaje
 * del cliente en una conversación con la IA pausada y el último mensaje
 * ANTERIOR —de quien sea— tiene más de N días (`assignment_settings.
 * bot_reactivate_after_days`, 7 por defecto), la IA se reactiva para ese
 * entrante, igual que "Reactivar IA". El asesor se conserva: cuando el
 * bot traspase, va directo a él.
 *
 * Solo si el asesor es `agent` o no hay asesor (Director, 2026-09-23): en
 * un hilo de un owner/admin —los propietarios de Angélica— el bot nunca
 * se reactiva solo. Esa regla también vive en la base.
 *
 * La decisión la toma la base (`reactivate_ai_for_returning_lead`,
 * migración 538) en un solo UPDATE condicionado, medido contra la fecha
 * del propio entrante: en una ráfaga solo el primer mensaje reactiva, en
 * cualquier orden en que se procesen. El `referral` del anuncio NO es
 * disparador: reactivaría el bot en medio de una negociación viva.
 *
 * Nunca lanza: corre en la difusión del webhook, antes de los flujos y la
 * IA, y un fallo acá no puede costar el resto. Sin reactivación el
 * cliente queda como estaba —con su asesor—, que es un mal menor.
 *
 * @returns true si la IA quedó reactivada por este entrante.
 */
export async function reactivateBotForReturningLead(
  db: SupabaseClient,
  conversationId: string,
  inboundMessageId: string,
): Promise<boolean> {
  try {
    const { data, error } = await db.rpc('reactivate_ai_for_returning_lead', {
      p_conversation_id: conversationId,
      p_inbound_message_id: inboundMessageId,
    })
    if (error) {
      console.error('[ai returning-lead] no se pudo evaluar la reactivación:', error)
      return false
    }
    return data === true
  } catch (err) {
    console.error('[ai returning-lead] no se pudo evaluar la reactivación:', err)
    return false
  }
}
