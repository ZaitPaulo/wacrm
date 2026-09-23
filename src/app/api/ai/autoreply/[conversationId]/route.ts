import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { asesorAlTomar, puedeControlarIa } from '@/lib/inbox/assignment'
import { AUTOREPLY_ERROR_CODES } from '@/lib/inbox/autoreply-errors'

type Params = { params: Promise<{ conversationId: string }> }

/**
 * POST /api/ai/autoreply/[conversationId]  (agent+)
 *
 * Pausa o reactiva la IA en una conversación desde la bandeja: los
 * botones "Tomar el control" y "Reanudar la IA" del banner.
 *
 * Body: { paused: boolean, assign_to_me?: boolean }
 *   - paused: true  → pausa la IA (una persona toma el hilo). Con
 *                     `assign_to_me`, además se asigna a quien pulsa,
 *                     PERO solo si el hilo no tenía asesor: tomar el
 *                     control no le quita el cliente a nadie.
 *   - paused: false → reactiva la IA y le da cupo nuevo
 *                     (`ai_reply_count = 0`, `ai_handoff_attempts = 0`).
 *                     La nota del traspaso (`ai_handoff_summary`) se
 *                     conserva. Y el asesor TAMBIÉN se conserva.
 *
 * EL ASESOR YA NO SE TOCA AL REACTIVAR (cambio `sticky-weighted-assignment`)
 *
 * Antes reactivar ponía `assigned_agent_id = null`, porque la IA se
 * abstenía en cuanto había un humano asignado. Con el asesor pegajoso
 * (P2) eso cambió: la IA depende solo de `ai_autoreply_disabled`, y el
 * asesor de un contacto solo lo cambia un owner/admin a mano. Reactivar
 * deja el hilo con el bot Y con su asesor, que es exactamente lo que
 * pide el negocio: el bot atiende, y cuando traspase va a ese asesor.
 *
 * Consecuencia: ya no hace falta service-role. Antes lo necesitaba el
 * `agent` porque al soltar el hilo la RLS de la 520 rechazaba la fila
 * resultante; ahora la fila sigue siendo suya y la sesión alcanza. Y
 * "reactivar con la IA ya activa" dejó de ser una forma de soltar el hilo,
 * así que ya no se rechaza (`ai_already_active` no se emite más): es
 * inocuo, como pulsar dos veces.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId, role } = await requireRole('agent')

    // Reuse the send bucket: this is a cheap per-user inbox action and
    // toggling it in a tight loop has no legitimate use.
    const limit = checkRateLimit(`ai-takeover:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const { conversationId } = await params
    const body = await request.json().catch(() => null)
    if (!body || typeof body.paused !== 'boolean') {
      return NextResponse.json({ error: 'paused (boolean) is required' }, { status: 400 })
    }
    const paused = body.paused as boolean
    const assignToMe = body.assign_to_me === true

    // La lectura va con la sesión: si el `agent` no ve la conversación
    // (no es suya), acá es un 404.
    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .select('id, assigned_agent_id')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (convErr) {
      console.error('[ai/autoreply] conversation lookup error:', convErr)
      return NextResponse.json({ error: 'Failed to load conversation' }, { status: 500 })
    }
    if (!conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }
    const asignadoActual = (conv as { assigned_agent_id: string | null }).assigned_agent_id

    if (!puedeControlarIa({ role, userId, currentAssigneeId: asignadoActual })) {
      return NextResponse.json(
        {
          error: 'You can only control the AI on a conversation assigned to you',
          code: AUTOREPLY_ERROR_CODES.notAssignee,
        },
        { status: 403 },
      )
    }

    const update: Record<string, unknown> = { ai_autoreply_disabled: paused }
    if (paused) {
      const nuevo = asesorAlTomar({ assignToMe, userId, currentAssigneeId: asignadoActual })
      if (nuevo !== undefined) update.assigned_agent_id = nuevo
    } else {
      // Cupo nuevo para el bot en este hilo. Es una acción manual y con
      // límite de frecuencia, no automatizable, así que no sirve para
      // saltarse el tope a escala.
      update.ai_reply_count = 0
      // El contador de transferencias rechazadas vuelve a cero: reactivar
      // deja el hilo como nuevo a ojos del gate de datos.
      update.ai_handoff_attempts = 0
    }

    const { error: upErr } = await supabase
      .from('conversations')
      .update(update)
      .eq('id', conversationId)
      .eq('account_id', accountId)
    if (upErr) {
      console.error('[ai/autoreply] update error:', upErr)
      return NextResponse.json({ error: 'Failed to update conversation' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      paused,
      assigned_agent_id:
        'assigned_agent_id' in update ? (update.assigned_agent_id as string) : asignadoActual,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
