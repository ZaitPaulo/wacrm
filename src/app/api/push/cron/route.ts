import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { getVapidConfig, secretMatches } from '@/lib/push/config'
import type { PushableNotification } from '@/lib/push/payload'
import {
  deliverNotification,
  supabaseSubscriptionStore,
  webPushSender,
} from '@/lib/push/send'

/**
 * GET /api/push/cron   (cron, cada minuto — `deploy/cron/crontab`)
 *
 * Red de seguridad del despacho inmediato. `pg_net` dispara y olvida: si
 * la app se estaba reiniciando (un despliegue) cuando el trigger pidió el
 * push, nadie reintenta. Este barrido reclama las versiones de aviso sin
 * envío registrado con entre 20 s y 15 min de antigüedad y las manda.
 * También cubre un entorno donde Vault aún no está configurado: ahí todo
 * push sale por aquí, con hasta un minuto de retraso.
 *
 * Header `x-cron-secret` = `AUTOMATION_CRON_SECRET`, como las demás
 * rutas de cron.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  if (!secretMatches(request.headers.get('x-cron-secret'), expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const vapid = getVapidConfig()
  if (!vapid) {
    // Sin reclamar nada: que un entorno sin push no llene el registro.
    return NextResponse.json({ processed: 0, disabled: true })
  }

  const admin = supabaseAdmin()
  const { data, error } = await admin.rpc('claim_pending_notification_pushes', { p_limit: 50 })
  if (error) {
    console.error('[push/cron] claim error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const pending = (data ?? []) as (PushableNotification & { user_id: string })[]
  const store = supabaseSubscriptionStore(admin)
  const sender = webPushSender(vapid)
  const totals = { processed: pending.length, sent: 0, removed: 0, failed: 0 }
  for (const n of pending) {
    try {
      const r = await deliverNotification(store, sender, n)
      totals.sent += r.sent
      totals.removed += r.removed
      totals.failed += r.failed
    } catch (err) {
      totals.failed++
      console.error('[push/cron] delivery error:', (err as Error).message)
    }
  }
  return NextResponse.json(totals)
}
