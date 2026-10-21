import type { SupabaseClient } from '@supabase/supabase-js'
import { loadCatalogSection } from '@/lib/i18n/server-catalog'

// ============================================================
// Aviso de saldo agotado del proveedor (reducir-consumo-gemini).
//
// En octubre de 2026 el saldo prepago de Gemini se agotó dos veces y el
// bot traspasó todo como "fallo del proveedor" durante días sin que nadie
// se enterara. Ahora owner y admin reciben un aviso del CRM —nunca por
// WhatsApp, que Meta cobra—, como máximo uno cada 6 horas por cuenta.
// ============================================================

/** Ventana mínima entre dos avisos de la misma cuenta. */
export const BILLING_ALERT_INTERVAL_MS = 6 * 60 * 60 * 1000

/** Los ajustes del bot viven en la página de agentes. */
const SETTINGS_PATH = '/agents'

const FALLBACK_TEXTS = {
  title: 'El bot se quedó sin saldo en Gemini',
  body: 'Las respuestas automáticas están fallando y los clientes pasan directo a un asesor. Recarga el saldo en Google AI Studio para que el bot vuelva a responder.',
}

async function loadTexts(): Promise<typeof FALLBACK_TEXTS> {
  const section = await loadCatalogSection('AiBillingAlert')
  const pick = (key: keyof typeof FALLBACK_TEXTS) => {
    const value = section?.[key]
    return typeof value === 'string' && value.trim() ? value : FALLBACK_TEXTS[key]
  }
  return { title: pick('title'), body: pick('body') }
}

/**
 * Reclama el turno de aviso con un UPDATE condicional —NULL o más viejo
 * que la ventana—, así dos fallos simultáneos no avisan dos veces, y
 * notifica a cada owner y admin. Devuelve cuántas notificaciones creó.
 * No lanza: un aviso que falla no puede tumbar el traspaso del cliente.
 */
export async function notifyBillingExhausted(
  db: SupabaseClient,
  accountId: string,
  now: Date = new Date(),
): Promise<number> {
  try {
    const cutoff = new Date(now.getTime() - BILLING_ALERT_INTERVAL_MS).toISOString()
    const { data: claimed, error: claimErr } = await db
      .from('ai_configs')
      .update({ billing_alerted_at: now.toISOString() })
      .eq('account_id', accountId)
      .or(`billing_alerted_at.is.null,billing_alerted_at.lt.${cutoff}`)
      .select('account_id')
    if (claimErr) {
      console.error('[ai billing] no se pudo reclamar el aviso de saldo:', claimErr)
      return 0
    }
    if (!Array.isArray(claimed) || claimed.length === 0) return 0

    const { data: admins, error: adminsErr } = await db
      .from('profiles')
      .select('user_id')
      .eq('account_id', accountId)
      .in('account_role', ['owner', 'admin'])
    if (adminsErr) {
      console.error('[ai billing] no se pudieron leer owner/admin:', adminsErr)
      return 0
    }
    const recipients = ((admins ?? []) as { user_id: string }[]).map((a) => a.user_id)
    if (recipients.length === 0) return 0

    const texts = await loadTexts()
    const { error: insErr } = await db.from('notifications').insert(
      recipients.map((user_id) => ({
        account_id: accountId,
        user_id,
        type: 'ai_billing_exhausted',
        title: texts.title,
        body: texts.body,
        link_path: SETTINGS_PATH,
      })),
    )
    if (insErr) {
      console.error('[ai billing] aviso de saldo no creado:', insErr)
      return 0
    }
    return recipients.length
  } catch (err) {
    console.error('[ai billing] aviso de saldo falló:', err)
    return 0
  }
}
