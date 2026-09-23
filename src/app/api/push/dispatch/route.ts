import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { getVapidConfig, secretMatches } from '@/lib/push/config'
import type { PushableNotification } from '@/lib/push/payload'
import {
  deliverNotification,
  supabaseSubscriptionStore,
  webPushSender,
} from '@/lib/push/send'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/push/dispatch   (interna — la llama la base de datos)
 *
 * Envía el push de UNA notificación. La llama el trigger
 * `on_notification_request_push` (migración 542) por `pg_net`, en cuanto
 * se crea o se refresca un aviso en `notifications`. Por eso cubre todos
 * los caminos que asignan o reciben mensajes sin que ninguno la llame.
 *
 * Header `x-push-secret` = `PUSH_DISPATCH_SECRET` (el mismo valor que se
 * cargó en Vault con `configure_push_dispatch`). Body:
 * `{ notification_id }`.
 *
 * Idempotente: `claim_notification_push` registra la versión
 * `(id, created_at)` antes de enviar; si ya estaba registrada (despacho
 * repetido, o el barrido llegó antes) no devuelve nada y aquí no se
 * envía. Si la notificación ya se leyó, tampoco.
 *
 * Sin VAPID responde 503 SIN reclamar: así, cuando se configure, el
 * barrido todavía puede enviar lo reciente.
 */
export async function POST(request: Request) {
  const expected = process.env.PUSH_DISPATCH_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'push dispatch not configured' }, { status: 503 })
  }
  if (!secretMatches(request.headers.get('x-push-secret'), expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as { notification_id?: unknown } | null
  const id = body?.notification_id
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    return NextResponse.json({ error: 'notification_id must be a uuid' }, { status: 400 })
  }

  const vapid = getVapidConfig()
  if (!vapid) {
    return NextResponse.json({ error: 'push not configured' }, { status: 503 })
  }

  const admin = supabaseAdmin()
  const { data, error } = await admin.rpc('claim_notification_push', {
    p_notification_id: id,
  })
  if (error) {
    console.error('[push/dispatch] claim error:', error.message)
    return NextResponse.json({ error: 'claim failed' }, { status: 500 })
  }
  const notification = ((data ?? []) as (PushableNotification & { user_id: string })[])[0]
  if (!notification) {
    return NextResponse.json({ skipped: true })
  }

  const result = await deliverNotification(
    supabaseSubscriptionStore(admin),
    webPushSender(vapid),
    notification,
  )
  return NextResponse.json(result)
}
