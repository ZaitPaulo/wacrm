import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'

/** Conversaciones por pasada. Con el cron cada 5 minutos son hasta 600
 *  por hora, muy por encima del volumen real (~30 leads nuevos por día),
 *  sin una transacción larga. */
const LOTE = 50

/**
 * Una pasada del job de conversaciones olvidadas (P4, cambio
 * `sticky-weighted-assignment`). La llama el cron del VPS cada 5 minutos
 * (`deploy/cron/crontab` → `tick.sh`), con el mismo secreto compartido
 * que `/api/automations/cron`.
 *
 * Todo el trabajo lo hace la base, `run_stale_assignment_job` (migración
 * 537): asigna con continuidad o porcentajes las conversaciones no
 * cerradas que llevan X HORAS sin asesor (3 en producción), y solo las que
 * quedaron sin asesor DESPUÉS de activarse la regla: el rezago que existía
 * al activarla no lo toca nunca.
 * Es idempotente y seguro ante dos corridas simultáneas: la segunda
 * encuentra el candado tomado y devuelve `skipped: true` sin tocar nada.
 * Cada asignación dispara el aviso al asesor y abre el negocio del
 * contacto (triggers de la 027/521 y la 536).
 *
 * Ruta propia, como las demás tareas del cron, para que una fallando no
 * bloquee las otras. Al desplegar hay que REINICIAR el contenedor del
 * cron: copia el crontab al arrancar (docs/self-hosting.md).
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

  const { data, error } = await supabaseAdmin().rpc('run_stale_assignment_job', {
    p_limit: LOTE,
  })
  if (error) {
    console.error('[assignment/cron] run_stale_assignment_job falló:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const r = (data ?? {}) as { skipped?: boolean; assigned?: number }
  return NextResponse.json({ assigned: r.assigned ?? 0, skipped: r.skipped === true })
}
