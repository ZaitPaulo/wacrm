import type { SupabaseClient } from '@supabase/supabase-js'
import { parseAdReferral } from '@/lib/inbound/ad-referral'

/** Lo que el prompt y la nota de traspaso usan del anuncio. */
export interface AdContext {
  headline?: string
  body?: string
}

/**
 * El anuncio del que vino la conversación: el `referral` más reciente de
 * sus mensajes (migración 526), o null si ninguno vino de un anuncio.
 *
 * Nunca lanza. Es contexto extra: si la consulta falla —por ejemplo,
 * antes de aplicar la migración— se responde sin él, como antes.
 */
export async function loadAdContext(
  db: SupabaseClient,
  conversationId: string,
): Promise<AdContext | null> {
  try {
    const { data, error } = await db
      .from('messages')
      .select('referral')
      .eq('conversation_id', conversationId)
      .not('referral', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error || !data) return null

    // Se vuelve a sanear: lo que va al prompt no confía en la fila.
    const referral = parseAdReferral((data as { referral: unknown }).referral)
    if (!referral) return null

    const ctx: AdContext = {}
    if (referral.headline) ctx.headline = referral.headline
    if (referral.body) ctx.body = referral.body
    return ctx
  } catch (err) {
    console.warn('[ai auto-reply] ad context skipped:', err)
    return null
  }
}
