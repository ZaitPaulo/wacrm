import { NextResponse } from 'next/server'

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { getVapidConfig } from '@/lib/push/config'
import { buildTestPushPayload } from '@/lib/push/payload'
import {
  deliverToSubscriptions,
  supabaseSubscriptionStore,
  webPushSender,
  type StoredSubscription,
} from '@/lib/push/send'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

const TITLE_MAX = 100
const BODY_MAX = 200

function str(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max ? v : null
}

/**
 * POST /api/push/test   (cualquier miembro con sesión)
 *
 * "Enviar aviso de prueba" de la tarjeta de avisos. Manda un push SOLO
 * al endpoint de este dispositivo, y solo si es del usuario que lo pide.
 * Body: `{ endpoint, title, body }` — los textos llegan ya traducidos
 * desde la interfaz, que es donde vive el catálogo de idiomas.
 *
 * Respuestas: 200 enviado · 404 el endpoint no es suyo · 410 el servicio
 * de push dice que la suscripción ya no existe (se borró; hay que
 * reactivar) · 502 el servicio de push falló · 503 sin VAPID.
 */
export async function POST(request: Request) {
  try {
    const { userId } = await getCurrentAccount()

    const limit = checkRateLimit(`push-test:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const vapid = getVapidConfig()
    if (!vapid) {
      return NextResponse.json({ error: 'push not configured' }, { status: 503 })
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const endpoint = str(body?.endpoint, 2048)
    const title = str(body?.title, TITLE_MAX)
    const text = str(body?.body, BODY_MAX)
    if (!endpoint || !title || !text) {
      return NextResponse.json({ error: 'endpoint, title and body are required' }, { status: 400 })
    }

    const admin = supabaseAdmin()
    const { data: sub, error } = await admin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('endpoint', endpoint)
      .eq('user_id', userId)
      .maybeSingle()
    if (error) {
      console.error('[push/test] lookup error:', error.message)
      return NextResponse.json({ error: 'Failed to load subscription' }, { status: 500 })
    }
    if (!sub) {
      return NextResponse.json({ error: 'subscription not found' }, { status: 404 })
    }

    const result = await deliverToSubscriptions(
      supabaseSubscriptionStore(admin),
      webPushSender(vapid),
      [sub as StoredSubscription],
      buildTestPushPayload(title, text),
      { TTL: 60, urgency: 'high' },
    )
    if (result.removed > 0) {
      return NextResponse.json({ error: 'subscription expired' }, { status: 410 })
    }
    if (result.sent === 0) {
      return NextResponse.json({ error: 'push service error' }, { status: 502 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
