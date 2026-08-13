import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { linkContacts } from '@/lib/contacts/identity-links';
import {
  suggestIdentityLinks,
  type SuggestionCandidate,
} from '@/lib/contacts/identity-suggestions';
import type { MessageChannel } from '@/lib/contacts/channel-identity';

/**
 * Sugerencias de fichas que podrían ser la misma persona, y la acción
 * de unirlas.
 *
 * SUGERIR, NUNCA FUSIONAR SOLO. El GET propone; unir siempre pasa por
 * el POST, que exige que alguien lo pida. Unir mal mezcla el historial
 * de dos clientes distintos, y ese daño es peor y más difícil de
 * revertir que dejar dos fichas separadas.
 */
interface CandidateRow {
  id: string;
  name: string | null;
  merged_into_contact_id: string | null;
  contact_channels: { channel: MessageChannel }[] | null;
}

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();

    const { data, error } = await supabase
      .from('contacts')
      .select('id, name, merged_into_contact_id, contact_channels(channel)')
      .eq('account_id', accountId);

    if (error) {
      console.error('[identity-links GET] error:', error);
      return NextResponse.json(
        { error: 'No se pudieron cargar las sugerencias' },
        { status: 500 }
      );
    }

    const rows = (data ?? []) as unknown as CandidateRow[];

    const candidates: SuggestionCandidate[] = rows.map((r) => ({
      contactId: r.id,
      name: r.name,
      channels: (r.contact_channels ?? []).map((c) => c.channel),
      mergedInto: r.merged_into_contact_id,
    }));

    const porId = new Map(rows.map((r) => [r.id, r]));

    // Se hidrata con el nombre y los canales de cada ficha para que la
    // pantalla pueda mostrar qué se estaría uniendo, no dos UUID.
    const suggestions = suggestIdentityLinks(candidates).map((s) => ({
      contact_ids: s.contactIds,
      matched_on: s.matchedOn,
      contacts: s.contactIds.map((id) => {
        const row = porId.get(id);
        return {
          id,
          name: row?.name ?? null,
          channels: (row?.contact_channels ?? []).map((c) => c.channel),
        };
      }),
    }));

    return NextResponse.json({ suggestions });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST — une dos fichas.
 *
 * `agent` o superior, el mismo rol que edita un contacto: esto es una
 * operación sobre la ficha. Lo que la protege no es el rol sino que
 * nunca ocurre sin que alguien la pida.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent');
    const limit = checkRateLimit(
      `ident-link:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    const survivingId =
      typeof body?.surviving_contact_id === 'string'
        ? body.surviving_contact_id
        : '';
    const mergedId =
      typeof body?.merged_contact_id === 'string' ? body.merged_contact_id : '';

    if (!survivingId || !mergedId) {
      return NextResponse.json(
        { error: 'Faltan las dos fichas a unir' },
        { status: 400 }
      );
    }

    const result = await linkContacts({
      db: supabase,
      accountId,
      survivingId,
      mergedId,
      userId,
    });

    if (!result.ok) return linkFailureResponse(result.reason);
    return NextResponse.json({ success: true, link_id: result.linkId });
  } catch (err) {
    return toErrorResponse(err);
  }
}

function linkFailureResponse(reason: string): NextResponse {
  switch (reason) {
    case 'same_contact':
      return NextResponse.json(
        { error: 'No se puede unir una ficha consigo misma' },
        { status: 400 }
      );
    case 'contact_not_found':
      return NextResponse.json(
        { error: 'Alguna de las dos fichas ya no existe' },
        { status: 404 }
      );
    case 'already_linked':
      return NextResponse.json(
        { error: 'Una de las dos ya está unida a otra ficha' },
        { status: 409 }
      );
    case 'channel_conflict':
      return NextResponse.json(
        {
          error:
            'Las dos fichas tienen conversación del mismo canal. Unirlas partiría el historial, así que hay que resolverlo a mano.',
        },
        { status: 409 }
      );
    default:
      return NextResponse.json(
        { error: 'No se pudieron unir las fichas' },
        { status: 500 }
      );
  }
}
