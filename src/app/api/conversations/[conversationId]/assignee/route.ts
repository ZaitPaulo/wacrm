import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { destinatarioValido, puedeCambiarAsignacion } from '@/lib/inbox/assignment'

type Params = { params: Promise<{ conversationId: string }> }

/**
 * PATCH /api/conversations/[conversationId]/assignee   (owner/admin)
 *
 * Cambia a mano el asesor asignado a una conversación: el desplegable
 * "Asignar a" del encabezado del hilo.
 *
 * Body: { assigned_agent_id: string | null }
 *
 * SOLO OWNER/ADMIN (cambio `sticky-weighted-assignment`, P2)
 *
 * El asesor de un contacto permanece siempre, salvo que un owner/admin
 * lo cambie: ante cada campaña, el mismo lead cae con el mismo asesor.
 * Hasta este cambio un `agent` podía pasarle su conversación a un
 * compañero por acá; ya no. La regla vive en `puedeCambiarAsignacion`, y
 * la interfaz ni le ofrece el control al `agent`.
 *
 * ESCRIBE CON LA SESIÓN, SIN SERVICE-ROLE
 *
 * El service-role estaba solo para el `agent`, que al pasar la
 * conversación se la dejaba invisible a sí mismo y la RLS de la 520
 * rechazaba la fila resultante. Un admin ve toda la cuenta: con su sesión
 * la RLS lo deja, el trigger de la 520 sigue vigilando, y el aviso al
 * nuevo asesor conserva el nombre de quien reasignó ("Angélica te asignó
 * una conversación con Juan"), que con service-role saldría impersonal.
 *
 * Una asignación manual a un `agent` abre además el negocio del contacto
 * en Ventas / Prospecto si no tiene uno abierto (trigger de la 536).
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId, role } = await requireRole('admin')

    // Mismo cubo que el resto de acciones de bandeja: es una escritura
    // barata por usuario y reasignar en bucle no tiene uso legítimo.
    const limit = checkRateLimit(`assignee:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    // Redundante con requireRole('admin'), a propósito: la regla tiene un
    // solo dueño (`puedeCambiarAsignacion`) y si mañana cambia, cambia acá.
    if (!puedeCambiarAsignacion({ role })) {
      return NextResponse.json(
        { error: 'Only an owner or admin can change the assignee' },
        { status: 403 },
      )
    }

    const { conversationId } = await params
    const body = await request.json().catch(() => null)
    if (
      !body ||
      !('assigned_agent_id' in body) ||
      !(typeof body.assigned_agent_id === 'string' || body.assigned_agent_id === null)
    ) {
      return NextResponse.json(
        { error: 'assigned_agent_id (string or null) is required' },
        { status: 400 },
      )
    }
    const target = body.assigned_agent_id as string | null

    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .select('id, assigned_agent_id')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (convErr) {
      console.error('[conversations/assignee] lookup error:', convErr)
      return NextResponse.json({ error: 'Failed to load conversation' }, { status: 500 })
    }
    if (!conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }
    const actual = (conv as { assigned_agent_id: string | null }).assigned_agent_id

    // `assigned_agent_id` no tiene clave ajena: sin esto se podría escribir
    // cualquier UUID.
    if (target !== null) {
      const { data: miembros, error: miembrosErr } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('account_id', accountId)
      if (miembrosErr) {
        console.error('[conversations/assignee] members error:', miembrosErr)
        return NextResponse.json({ error: 'Failed to load members' }, { status: 500 })
      }
      const ids = ((miembros ?? []) as { user_id: string }[]).map((m) => m.user_id)
      if (!destinatarioValido({ targetUserId: target, miembros: ids })) {
        return NextResponse.json(
          { error: 'The new assignee is not a member of this account' },
          { status: 400 },
        )
      }
    }

    // Nada que hacer: se contesta bien para que la interfaz no tenga que
    // distinguir este caso.
    if (actual === target) {
      return NextResponse.json({ success: true, assigned_agent_id: target })
    }

    const { error: upErr } = await supabase
      .from('conversations')
      .update({ assigned_agent_id: target })
      .eq('id', conversationId)
      .eq('account_id', accountId)
    if (upErr) {
      console.error('[conversations/assignee] update error:', upErr)
      return NextResponse.json({ error: 'Failed to update assignment' }, { status: 500 })
    }

    return NextResponse.json({ success: true, assigned_agent_id: target })
  } catch (err) {
    return toErrorResponse(err)
  }
}
