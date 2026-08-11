// ============================================================
// Atribución de consultas: qué vehículo originó una conversación.
//
// Cierra la cadena vitrina → WhatsApp → CRM. El visitante pulsa el CTA
// de un vehículo, WhatsApp abre con un mensaje que lleva `[Ref: XXXXXX]`,
// y al llegar ese mensaje se registra contra el vehículo.
//
// Corre con SERVICE-ROLE porque el webhook no tiene sesión de usuario.
// Eso es aceptable aquí: `vehicle_inquiries` no es dato sensible y cada
// consulta se acota por account_id a mano. No confundir con las métricas
// de MARGEN, que nunca deben leerse con service-role — ahí la RLS es la
// única defensa del costo de compra.
// ============================================================

import { supabaseAdmin } from '@/lib/ai/admin-client'
import { parseRefTag } from './public-ref'

/**
 * Registra la consulta si el mensaje entrante trae un código de
 * referencia válido de la cuenta.
 *
 * Best-effort por diseño: cualquier fallo se registra como advertencia y
 * se traga. Perder una atribución es un dato de menos en un gráfico;
 * romper el webhook es perder el mensaje del cliente.
 *
 * @param text Texto del mensaje entrante, tal como llegó.
 */
export async function recordVehicleInquiry(
  accountId: string,
  contactId: string | null,
  conversationId: string | null,
  text: string | null | undefined,
): Promise<void> {
  try {
    const ref = parseRefTag(text)
    // Sin código no se atribuye nada. No se adivina por cercanía
    // temporal: un falso positivo ensucia la métrica más que un hueco.
    if (!ref) return

    const admin = supabaseAdmin()

    const { data: vehicle, error: lookupError } = await admin
      .from('inventory_vehicles')
      .select('id')
      .eq('account_id', accountId)
      .eq('public_ref', ref)
      .maybeSingle()

    if (lookupError) {
      console.warn('[inquiries] no se pudo resolver el código:', lookupError)
      return
    }
    // Código de otra cuenta, o de un vehículo ya borrado.
    if (!vehicle) return

    const { error: insertError } = await admin.from('vehicle_inquiries').insert({
      account_id: accountId,
      vehicle_id: vehicle.id,
      contact_id: contactId,
      conversation_id: conversationId,
    })

    if (insertError) {
      console.warn('[inquiries] no se pudo registrar la consulta:', insertError)
    }
  } catch (err) {
    console.warn('[inquiries] fallo inesperado al atribuir la consulta:', err)
  }
}
