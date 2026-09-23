import { NextResponse } from 'next/server'

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { isAllowedPushEndpoint } from '@/lib/push/config'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/** Las claves reales miden 87 (p256dh) y 22 (auth) caracteres base64url. */
const KEY_MAX = 256
const ENDPOINT_MAX = 2048
const USER_AGENT_MAX = 512

function str(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= max ? v : null
}

/**
 * POST /api/push/subscriptions   (cualquier miembro con sesión)
 *
 * Guarda la suscripción push de ESTE dispositivo a nombre de quien
 * llama. Body: el `PushSubscription.toJSON()` del navegador,
 * `{ endpoint, keys: { p256dh, auth } }`.
 *
 * Escribe con service-role a propósito: si el endpoint ya estaba a
 * nombre de otro usuario (dos asesores en el mismo computador) hay que
 * pasárselo al actual, y la RLS no deja tocar una fila ajena. Lo que la
 * RLS comprobaría se garantiza aquí: el `user_id` y el `account_id` salen
 * de la sesión, nunca del cuerpo.
 *
 * El endpoint tiene que ser de un servicio de push conocido: el servidor
 * le hace POST, y aceptar cualquier URL lo convertiría en un proxy hacia
 * la red interna.
 */
export async function POST(request: Request) {
  try {
    const { userId, accountId } = await getCurrentAccount()

    const limit = checkRateLimit(`push-subscribe:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as
      | { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }
      | null
    const endpoint = str(body?.endpoint, ENDPOINT_MAX)
    const p256dh = str(body?.keys?.p256dh, KEY_MAX)
    const auth = str(body?.keys?.auth, KEY_MAX)
    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json({ error: 'endpoint and keys are required' }, { status: 400 })
    }
    if (!isAllowedPushEndpoint(endpoint)) {
      return NextResponse.json({ error: 'unsupported push service' }, { status: 400 })
    }

    const userAgent = request.headers.get('user-agent')?.slice(0, USER_AGENT_MAX) ?? null

    const { error } = await supabaseAdmin()
      .from('push_subscriptions')
      .upsert(
        {
          user_id: userId,
          account_id: accountId,
          endpoint,
          p256dh,
          auth,
          user_agent: userAgent,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'endpoint' },
      )
    if (error) {
      console.error('[push/subscriptions] upsert error:', error.message)
      return NextResponse.json({ error: 'Failed to save subscription' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/push/subscriptions   (cualquier miembro con sesión)
 *
 * Olvida el dispositivo. Body: `{ endpoint }`. Va con el cliente de
 * sesión: la RLS solo deja borrar las propias, así que un endpoint ajeno
 * simplemente no borra nada.
 */
export async function DELETE(request: Request) {
  try {
    const { supabase } = await getCurrentAccount()
    const body = (await request.json().catch(() => null)) as { endpoint?: unknown } | null
    const endpoint = str(body?.endpoint, ENDPOINT_MAX)
    if (!endpoint) {
      return NextResponse.json({ error: 'endpoint is required' }, { status: 400 })
    }
    const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
    if (error) {
      console.error('[push/subscriptions] delete error:', error.message)
      return NextResponse.json({ error: 'Failed to delete subscription' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
