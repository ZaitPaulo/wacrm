import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

type Params = { params: Promise<{ id: string }> };

const PAGE = 50;

/**
 * GET /api/contacts/[id]/messages?conversation_id=…&before=…
 *
 * Un hilo del contacto en SOLO LECTURA, para la hoja de vida: cualquier
 * miembro de la cuenta lo lee aunque la conversación sea de otro asesor.
 * Lo resuelve `get_contact_conversation_messages` (555), que verifica la
 * cuenta. No habilita ninguna escritura y la conversación no aparece en
 * la bandeja de quien la lee por aquí.
 *
 * Devuelve los mensajes en orden cronológico; `before` pide los
 * anteriores al más viejo recibido.
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const { supabase } = await getCurrentAccount();
    const { id: contactId } = await params;
    const url = new URL(request.url);
    const conversationId = url.searchParams.get('conversation_id');
    const before = url.searchParams.get('before');
    if (!conversationId) {
      return NextResponse.json(
        { error: 'conversation_id required' },
        { status: 400 }
      );
    }

    // La conversación tiene que ser de ESTE contacto: la ficha no es una
    // puerta a cualquier hilo de la cuenta por id. De paso trae el canal
    // y quién la atiende para el encabezado del visor.
    const { data: timeline, error: threadError } = await supabase.rpc(
      'get_contact_timeline',
      { p_contact_id: contactId, p_kinds: ['conversation'], p_limit: 200 }
    );
    if (threadError) {
      console.error('[contacts/messages] thread error:', threadError);
      return NextResponse.json(
        { error: 'No se pudo cargar el hilo' },
        { status: 500 }
      );
    }
    const thread = (
      (timeline ?? []) as { source_id: string; data: Record<string, unknown> }[]
    ).find((row) => row.source_id === conversationId);
    if (!thread) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { data, error } = await supabase.rpc(
      'get_contact_conversation_messages',
      {
        p_conversation_id: conversationId,
        p_before: before && !Number.isNaN(Date.parse(before)) ? before : null,
        p_limit: PAGE,
      }
    );
    if (error) {
      console.error('[contacts/messages] error:', error);
      return NextResponse.json(
        { error: 'No se pudo cargar el hilo' },
        { status: 500 }
      );
    }

    const rows = (data ?? []) as { created_at: string }[];
    return NextResponse.json({
      conversation: { id: conversationId, ...thread.data },
      messages: [...rows].reverse(),
      has_more: rows.length === PAGE,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
