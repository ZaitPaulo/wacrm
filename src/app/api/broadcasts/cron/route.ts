import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { runBroadcastFollowUps } from '@/lib/whatsapp/broadcast-follow-up'
import { runNoReplyDelisting } from '@/lib/whatsapp/broadcast-no-reply'

/**
 * Una pasada de las tareas programadas de las difusiones. La llama el cron
 * del VPS cada 5 minutos (`deploy/cron/crontab` → `tick.sh`), con el mismo
 * secreto compartido que `/api/automations/cron`.
 *
 * Dos fases independientes:
 *   - `followUps`: el recordatorio a quien no respondió (migración 524);
 *   - `delisting`: la baja por silencio, que oculta los vehículos de quien
 *     no respondió en el plazo (migración 525).
 * Cada una en su propio try: que falle una no impide la otra. Si falla
 * alguna, la respuesta es un 500 con el detalle de las dos, para que el
 * log del cron (`tick.sh`) lo muestre como FALLO.
 *
 * Ruta propia y no un paso más de la de automatizaciones: el crontab las
 * separa para que una fallando no bloquee la otra.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = supabaseAdmin()
  let failed = false

  let followUps: unknown
  try {
    followUps = await runBroadcastFollowUps(db)
  } catch (err) {
    failed = true
    console.error('[broadcast cron] follow-up pass failed:', err)
    followUps = { error: err instanceof Error ? err.message : 'follow-up pass failed' }
  }

  let delisting: unknown
  try {
    delisting = await runNoReplyDelisting(db)
  } catch (err) {
    failed = true
    console.error('[broadcast cron] no-reply delisting failed:', err)
    delisting = { error: err instanceof Error ? err.message : 'no-reply delisting failed' }
  }

  return NextResponse.json({ followUps, delisting }, { status: failed ? 500 : 200 })
}
