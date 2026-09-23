import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import {
  destinatarioValido,
  escribeConServiceRole,
  puedeCambiarAsignacion,
  puedeDejarSinAsignar,
} from '@/lib/inbox/assignment'

type Params = { params: Promise<{ conversationId: string }> }

/**
 * PATCH /api/conversations/[conversationId]/assignee   (agent+)
 *
 * Cambia el asesor asignado a una conversación. Es lo que hay detrás del
 * desplegable "Asignar a" de la bandeja.
 *
 * Body: { assigned_agent_id: string | null }
 *
 * POR QUÉ EXISTE ESTE ENDPOINT, SI LA BANDEJA YA ESCRIBÍA DIRECTO
 *
 * Porque no escribía: fallaba. La bandeja hacía el UPDATE desde el
 * navegador con el cliente de sesión, y para un `agent` la RLS lo
 * rechaza SIEMPRE que la conversación deje de ser suya — o sea en el
 * único caso en que el desplegable sirve para algo:
 *
 *   ERROR: new row violates row-level security policy for table "conversations"
 *
 * La causa es la política de SELECT de `conversations` (migración 520),
 * que se aplica también a la fila RESULTANTE del UPDATE: al pasarle la
 * conversación a un compañero, el asesor se la deja invisible a sí mismo
 * en la misma sentencia. No es el trigger `enforce_agent_keeps_assignment`
 * —se comprobó quitándolo y sigue fallando— ni el `WITH CHECK` de la
 * política de UPDATE, que ya es permisivo.
 *
 * Es un defecto PREEXISTENTE, de la 520, no de este cambio: el asesor
 * veía "Failed to update assignment" y no había forma de reasignar. Se
 * arregla acá porque la causa y la vía son las mismas que las del botón
 * "Reactivar IA".
 *
 * POR QUÉ SERVICE-ROLE, Y QUÉ SE PAGA POR ELLO
 *
 * La alternativa era relajar `conversations_select`, y no: eso abriría
 * también las conversaciones sin asignar —121 hoy— a los tres asesores,
 * que es justo lo que la 520 fue a cerrar. Así que la escritura va con
 * service-role.
 *
 * SERVICE-ROLE APAGA LOS DOS CONTROLES DE LA BASE: la RLS y, porque
 * `auth.uid()` queda en NULL, también el trigger de la 520. Todo lo que
 * la base dejaría de comprobar se comprueba acá antes de escribir, con
 * las funciones puras de `@/lib/inbox/assignment`:
 *
 *   1. LA LECTURA PREVIA VA CON EL CLIENTE DE SESIÓN, a propósito. Es lo
 *      que conserva la comprobación de visibilidad: si el asesor no
 *      puede ver la conversación, acá es un 404 y no llega a la
 *      escritura. Sustituirla por el cliente admin "para simplificar"
 *      abriría la cartera de los compañeros.
 *   2. La conversación tiene que ser de la cuenta de quien llama.
 *   3. Quien llama tiene que ser el asignado actual, o `admin`/`owner`.
 *   4. El destinatario tiene que ser miembro de la cuenta:
 *      `assigned_agent_id` no tiene clave ajena, así que sin esto se
 *      podría escribir cualquier UUID.
 *   5. Dejarla sin asignar sigue siendo cosa de `admin`/`owner`, que es
 *      la regla del trigger reescrita en código.
 *
 * Si alguien viene dentro de seis meses a "limpiar" el service-role de
 * acá, esto es lo que va a romper: el desplegable de asignar vuelve a
 * fallar para todos los asesores, que en esta cuenta son los tres que
 * atienden.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId, role } = await requireRole('agent')

    // Mismo cubo que el resto de acciones de bandeja: es una escritura
    // barata por usuario y reasignar en bucle no tiene uso legítimo.
    const limit = checkRateLimit(`assignee:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

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

    // (1) y (2) — con el cliente de sesión, que es lo que mantiene la
    // comprobación de visibilidad de la 520.
    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .select('id, assigned_agent_id')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (convErr) {
      console.error('[conversations/assignee] lookup error:', convErr)
      return NextResponse.json(
        { error: 'Failed to load conversation' },
        { status: 500 },
      )
    }
    if (!conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }
    const actual = (conv as { assigned_agent_id: string | null }).assigned_agent_id

    // (3)
    if (!puedeCambiarAsignacion({ role, userId, currentAssigneeId: actual })) {
      return NextResponse.json(
        { error: 'You can only reassign a conversation assigned to you' },
        { status: 403 },
      )
    }

    // (5) — soltar el hilo no es pasarlo. Por este endpoint no hay
    // excepción de devolución al bot: para eso está
    // POST /api/ai/autoreply/[conversationId].
    if (target === null && !puedeDejarSinAsignar({ role, devolverAlBot: false })) {
      return NextResponse.json(
        {
          error:
            'An agent can pass the conversation to a teammate or hand it back to the bot, but not leave it unassigned',
        },
        { status: 403 },
      )
    }

    // (4) — los miembros se leen con el cliente de sesión: la política de
    // `profiles` deja a cualquier miembro ver a los de su cuenta.
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

    // CON QUÉ CLIENTE SE ESCRIBE, y por qué no siempre el mismo.
    //
    // Un `admin` sigue escribiendo con su sesión: la RLS le deja porque
    // ve toda la cuenta, y eso hace que el aviso al nuevo asignado
    // conserve el nombre de quien reasignó ("Angélica te asignó una
    // conversación con Juan"). Con service-role `auth.uid()` es NULL y
    // el aviso sale impersonal ("Se te asignó…"), que es información que
    // los admin tienen HOY y que no hay razón para quitarles.
    //
    // Un `agent` sí necesita service-role: al pasarle la conversación a
    // un compañero deja de verla, y la política de SELECT de la 520 se
    // aplica también a la fila resultante. Él no pierde nada — hasta
    // ahora no podía reasignar en absoluto.
    //
    // La decisión sale de `escribeConServiceRole` y no de una condición
    // escrita acá, para que esta ruta y la de reactivación no puedan
    // divergir. NO se unifique a una sola rama: degradaría el aviso de
    // los admin sin que nadie lo note.
    //
    // `account_id` se repite en el WHERE aunque ya se validó arriba:
    // cuando la rama es la de service-role, es la única barrera de
    // tenencia que queda en la sentencia.
    const writer = escribeConServiceRole({ role, userId, nuevoAsignado: target })
      ? supabaseAdmin()
      : supabase
    const { error: upErr } = await writer
      .from('conversations')
      .update({ assigned_agent_id: target })
      .eq('id', conversationId)
      .eq('account_id', accountId)
    if (upErr) {
      console.error('[conversations/assignee] update error:', upErr)
      return NextResponse.json(
        { error: 'Failed to update assignment' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true, assigned_agent_id: target })
  } catch (err) {
    return toErrorResponse(err)
  }
}
