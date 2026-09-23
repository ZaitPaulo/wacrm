import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import {
  escribeConServiceRole,
  esDevolucionAlBot,
  puedeCambiarAsignacion,
  puedeDejarSinAsignar,
} from '@/lib/inbox/assignment'
import { AUTOREPLY_ERROR_CODES } from '@/lib/inbox/autoreply-errors'

type Params = { params: Promise<{ conversationId: string }> }

/**
 * POST /api/ai/autoreply/[conversationId]  (agent+)
 *
 * Toggle the AI auto-reply bot for one conversation from the inbox — the
 * "Take over" / "Resume AI" banner.
 *
 * Body: { paused: boolean, assign_to_me?: boolean }
 *   - paused: true  → pause the bot here (a human is taking over). When
 *                     `assign_to_me` is set, also assign the thread to the
 *                     caller (the usual "Take over" flow). Assignment
 *                     fires the `on_conversation_assigned` trigger.
 *   - paused: false → hand the thread back to the bot: clear the pause
 *                     and reset the per-conversation reply count so it
 *                     gets fresh slots. La nota del traspaso
 *                     (`ai_handoff_summary`) se CONSERVA. If the
 *                     caller currently owns the thread, unassign it too so
 *                     the bot isn't blocked by the "human owns this" gate.
 *
 * LA LECTURA VA CON EL CLIENTE DE SESIÓN Y LA ESCRITURA DEPENDE DEL CASO
 *
 * Pausar escribe con el cliente de sesión, como siempre: la fila
 * resultante sigue siendo visible para quien la escribe, así que la RLS
 * la deja pasar.
 *
 * REACTIVAR NO PUEDE. Devolverle el hilo al bot exige quitar la
 * asignación —la auto-respuesta se abstiene en cuanto hay un humano
 * asignado, así que un asignado viejo dejaría el botón en un no-op
 * silencioso—, y para un `agent` eso choca con la política de SELECT de
 * `conversations` (migración 520), que se aplica también a la fila
 * RESULTANTE del UPDATE: al soltarla se la deja invisible a sí mismo en
 * la misma sentencia. Comprobado contra la base de producción el
 * 2026-09-21 como `authenticated` con el JWT de un `agent`:
 *
 *   ERROR: new row violates row-level security policy for table "conversations"
 *
 * Y NO lo arregla tocar el trigger `enforce_agent_keeps_assignment` de
 * la 520, que es un control distinto y anterior: se comprobó quitando el
 * trigger entero y el UPDATE sigue fallando. (Hubo una migración 530 que
 * le añadía al trigger una excepción de devolución al bot; se descartó
 * sin desplegarse por eso mismo.) Tampoco es el `WITH CHECK` de la política de UPDATE, que ya
 * es permisivo: se probó con `WITH CHECK (true)` y falla igual.
 *
 * Relajar `conversations_select` no es opción: abriría las 121
 * conversaciones sin asignar a los tres asesores, que es exactamente lo
 * que la 520 fue a cerrar. Así que SOLO el UPDATE de reactivación va con
 * service-role.
 *
 * ESO APAGA LOS DOS CONTROLES DE LA BASE a la vez —la RLS, y el trigger
 * porque `auth.uid()` queda en NULL—, así que lo que dejan de comprobar
 * se comprueba antes en código: que la conversación sea de la cuenta de
 * quien llama (la lectura previa, con el cliente de sesión, que es lo que
 * conserva la comprobación de visibilidad), que quien llama sea el
 * asignado actual o un `admin`/`owner`, y —para un `agent`— que esta
 * operación sea de verdad una devolución al bot: que la IA estuviera
 * pausada y sea esta llamada la que la reactiva (`esDevolucionAlBot`).
 * Si la IA ya estaba activa, `paused: false` solo quitaría el asesor, y
 * eso es soltar el hilo, que un `agent` no puede.
 *
 * Si alguien viene a "limpiar" este service-role dentro de seis meses,
 * esto es lo que va a romper: el botón "Reactivar IA" vuelve a dar 500
 * para todos los asesores, que en esta cuenta son los tres que atienden.
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
      return NextResponse.json(
        { error: 'paused (boolean) is required' },
        { status: 400 },
      )
    }
    const paused = body.paused as boolean
    const assignToMe = body.assign_to_me === true

    // Confirm the conversation is in the caller's account before writing.
    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .select('id, assigned_agent_id, ai_autoreply_disabled')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (convErr) {
      console.error('[ai/autoreply] conversation lookup error:', convErr)
      return NextResponse.json(
        { error: 'Failed to load conversation' },
        { status: 500 },
      )
    }
    if (!conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }
    const { assigned_agent_id: asignadoActual, ai_autoreply_disabled: iaPausadaAntes } =
      conv as {
        assigned_agent_id: string | null
        ai_autoreply_disabled: boolean | null
      }

    const update: Record<string, unknown> = { ai_autoreply_disabled: paused }

    if (paused) {
      if (assignToMe) update.assigned_agent_id = userId
    } else {
      // Resuming hands the thread *back to the bot*. Clear the pause and
      // the handoff note, and — crucially — release ANY assignment, not
      // just the caller's own: the auto-reply eligibility gate stands
      // down whenever a human is assigned, so leaving a stale assignee
      // (e.g. the agent a prior handoff routed to) would silently keep
      // the bot muted and make "Resume AI" a no-op. This is the explicit
      // choice to let the bot own the thread again.
      update.assigned_agent_id = null
      // Give the bot a fresh reply budget on this thread. This is a
      // deliberate, manual, rate-limited action (not automatable), so it
      // can't be used to bypass the per-conversation cap at scale — it's
      // a human choosing to re-engage the assistant.
      update.ai_reply_count = 0
      // `ai_handoff_summary` NO se borra. Esa nota lleva el motivo del
      // traspaso y los datos de la calificación —nombre, presupuesto,
      // interés, crédito— y es lo único que permite que quien retome el
      // hilo más adelante no empiece de cero. Borrarla al reactivar
      // tiraba a la basura lo que el bot ya había averiguado, en el
      // momento exacto en que el hilo vuelve a quedar sin dueño.
      //
      // No se acumula: `handOffToHuman` la reemplaza entera en cada
      // traspaso nuevo, así que siempre refleja el último.
      // El contador de transferencias rechazadas sí vuelve a cero:
      // reactivar deja el hilo como nuevo a ojos del gate de datos. Si
      // no, un hilo que ya acumuló un rechazo urgente transferiría de
      // inmediato la próxima vez, sin darle al bot su turno.
      update.ai_handoff_attempts = 0
    }

    // Reactivar deja el hilo sin asesor, y eso es lo que la RLS no puede
    // dejar pasar: ese UPDATE va con service-role, y solo ese. Antes se
    // comprueba en código lo que la base ya no va a comprobar.
    if (!paused) {
      if (
        !puedeCambiarAsignacion({
          role,
          userId,
          currentAssigneeId: asignadoActual,
        })
      ) {
        return NextResponse.json(
          {
            error: 'You can only hand back a conversation assigned to you',
            code: AUTOREPLY_ERROR_CODES.notAssignee,
          },
          { status: 403 },
        )
      }
      // Reactivar quita la asignación siempre. Para un `agent` eso solo
      // vale si ES una devolución al bot —la IA estaba pausada y esta
      // llamada la reactiva—; con la IA ya activa sería soltar el hilo.
      // Es la regla del trigger de la 520, que con service-role no corre.
      const devolverAlBot = esDevolucionAlBot({
        iaPausadaAntes,
        iaPausadaDespues: paused,
      })
      if (!puedeDejarSinAsignar({ role, devolverAlBot })) {
        return NextResponse.json(
          {
            error:
              'The AI is already active on this conversation; an agent cannot use this to leave it unassigned',
            code: AUTOREPLY_ERROR_CODES.aiAlreadyActive,
          },
          { status: 403 },
        )
      }
    }

    // Con qué cliente se escribe lo decide `escribeConServiceRole`, y no
    // una condición escrita acá: la misma regla la usa
    // PATCH /api/conversations/[id]/assignee, y si cada ruta la dedujera
    // por su cuenta acabarían divergiendo.
    //
    // En corto: solo se sale del camino normal quien no cabe en él. Un
    // `admin` sigue escribiendo con su sesión —la RLS le deja, y así el
    // aviso al asignado conserva su nombre—; un `agent` que se queda sin
    // la conversación necesita service-role porque la RLS rechaza la
    // fila resultante.
    const nuevoAsignado = paused
      ? assignToMe
        ? userId
        : asignadoActual
      : null
    const writer = escribeConServiceRole({ role, userId, nuevoAsignado })
      ? supabaseAdmin()
      : supabase
    const { error: upErr } = await writer
      .from('conversations')
      .update(update)
      .eq('id', conversationId)
      .eq('account_id', accountId)
    if (upErr) {
      console.error('[ai/autoreply] update error:', upErr)
      return NextResponse.json(
        { error: 'Failed to update conversation' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true, paused })
  } catch (err) {
    return toErrorResponse(err)
  }
}
