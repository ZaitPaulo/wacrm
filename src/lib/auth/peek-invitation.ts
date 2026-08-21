// ============================================================
// Lectura server-only de una invitación, para renderizar la previa
// del enlace (`/join/[token]/opengraph-image`).
//
// Por qué no reusa `@/lib/supabase/server`
//   Ese cliente lee y escribe cookies. La OG image la pide un crawler
//   anónimo (WhatsApp, Telegram, Slack), nunca hay sesión que refrescar,
//   y arrastrar `cookies()` solo añade una razón más para que la ruta
//   falle. La RPC `peek_invitation` es SECURITY DEFINER, así que la
//   clave anónima alcanza.
//
// Por qué la anon key y no la service-role
//   La service-role salta RLS entera; aquí no hace falta nada de eso y
//   mantenerla fuera de esta ruta pública es gratis.
//
// El token en claro nunca cruza a la base: se hashea acá y la búsqueda
// va por `token_hash`, igual que en /api/invitations/[token]/peek.
// ============================================================

import { createClient } from '@supabase/supabase-js'

import { hashInviteToken } from './invitations'

export interface InvitationPreview {
  accountName: string
  role: 'admin' | 'agent' | 'viewer'
  expiresAt: string
}

/**
 * Datos mínimos de una invitación vigente, o `null` si el token no
 * existe, ya se usó, venció, o la consulta falló.
 *
 * Colapsar todos los fallos en `null` es intencional: quien consume
 * esto dibuja una imagen, y una previa genérica es mejor resultado que
 * una que anuncie "invitación vencida" por un error transitorio de red.
 */
export async function peekInvitation(
  token: string,
): Promise<InvitationPreview | null> {
  if (!token) return null

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null

  try {
    const db = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await db.rpc('peek_invitation', {
      p_token_hash: hashInviteToken(token),
    })
    if (error) {
      console.error('[peekInvitation] rpc error:', error)
      return null
    }
    if (!data || data.ok !== true) return null

    return {
      accountName: String(data.account_name ?? ''),
      role: data.role,
      expiresAt: String(data.expires_at ?? ''),
    }
  } catch (err) {
    console.error('[peekInvitation] unexpected error:', err)
    return null
  }
}
