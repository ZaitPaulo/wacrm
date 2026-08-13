import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { describeWindow } from '@/lib/outbound/window';
import type { MessageChannel } from '@/lib/contacts/channel-identity';

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/contacts/[id]/threads
 *
 * Los hilos de un contacto, uno por canal, con el estado de su ventana
 * de respuesta.
 *
 * Existe para responder la pregunta que alguien se hace mirando la
 * ficha: "¿por cuál de sus canales le puedo escribir, y hasta cuándo?".
 * Sin esto, la única forma de averiguarlo es abrir un hilo, escribir y
 * que el envío falle.
 *
 * La ventana se calcula para un HUMANO, porque quien mira esta pantalla
 * es quien va a responder. En Instagram y Messenger eso son 7 días; una
 * automatización tendría 24 horas y ese número no serviría acá.
 */
interface ConversationRow {
  id: string;
  channel: MessageChannel | null;
  status: string;
  last_message_text: string | null;
  last_message_at: string | null;
  unread_count: number | null;
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { id } = await params;

    const { data: conversations, error } = await supabase
      .from('conversations')
      .select(
        'id, channel, status, last_message_text, last_message_at, unread_count'
      )
      .eq('account_id', accountId)
      .eq('contact_id', id)
      .order('last_message_at', { ascending: false, nullsFirst: false });

    if (error) {
      console.error('[contacts/threads] error:', error);
      return NextResponse.json(
        { error: 'No se pudieron cargar los hilos' },
        { status: 500 }
      );
    }

    const rows = (conversations ?? []) as ConversationRow[];

    // El último mensaje del CLIENTE por hilo, que es lo que abre la
    // ventana. `last_message_at` no sirve: puede ser nuestro.
    const threads = await Promise.all(
      rows.map(async (row) => {
        const channel = row.channel ?? 'whatsapp';

        const { data: inbound } = await supabase
          .from('messages')
          .select('created_at')
          .eq('conversation_id', row.id)
          .eq('sender_type', 'customer')
          .order('created_at', { ascending: false })
          .limit(1);

        const lastInboundAt = inbound?.[0]?.created_at
          ? new Date(inbound[0].created_at as string)
          : null;

        const window = describeWindow({
          channel,
          senderKind: 'human',
          lastInboundAt,
        });

        return {
          conversation_id: row.id,
          channel,
          status: row.status,
          last_message_text: row.last_message_text,
          last_message_at: row.last_message_at,
          unread_count: row.unread_count ?? 0,
          window: {
            open: window.open,
            closes_at: window.closesAt?.toISOString() ?? null,
            alternative: window.alternative,
          },
        };
      })
    );

    return NextResponse.json({ threads });
  } catch (err) {
    return toErrorResponse(err);
  }
}
