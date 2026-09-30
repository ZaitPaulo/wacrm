import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { runHandoffSlaJob } from '@/lib/handoff/sla-job'

/**
 * Una pasada del job de traspasos sin atender (bot-fase-2-traspaso-sin-perdidas).
 * La llama el cron del VPS cada 5 minutos (`deploy/cron/crontab` →
 * `tick.sh`), con el mismo secreto compartido que `/api/assignment/cron`.
 *
 * Recordatorio al asesor y aviso a owner/admin cuando vencen los plazos
 * de `assignment_settings`, contados en horario de atención. No reasigna.
 * Toda la lógica vive en `runHandoffSlaJob`; aquí solo se autentica.
 *
 * Al desplegar hay que REINICIAR el contenedor del cron: copia el
 * crontab al arrancar (docs/self-hosting.md).
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

  try {
    return NextResponse.json(await runHandoffSlaJob(supabaseAdmin()))
  } catch (err) {
    console.error('[handoff/sla/cron] falló:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'handoff sla job failed' },
      { status: 500 },
    )
  }
}
