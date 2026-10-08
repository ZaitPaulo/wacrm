import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { runAppointmentCron } from '@/lib/appointments/cron'

/**
 * Una pasada del cron de la Agenda (agenda-citas): confirmaciones al
 * cliente, recordatorios del día anterior y resumen diario de cada
 * asesor. La llama el cron del VPS cada minuto (`deploy/cron/crontab` →
 * `tick.sh`), con el mismo secreto compartido que las demás rutas de cron.
 *
 * Las tres pasadas son independientes: un fallo de una queda en
 * `errors` y las otras siguen. Toda la lógica vive en
 * `runAppointmentCron`; aquí solo se autentica.
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
    return NextResponse.json(await runAppointmentCron(supabaseAdmin()))
  } catch (err) {
    console.error('[appointments/cron] falló:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'appointment cron failed' },
      { status: 500 },
    )
  }
}
