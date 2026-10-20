import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { parseTimelineQuery } from '@/lib/contacts/timeline';

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/contacts/[id]/timeline?kinds=a,b&before=…&before_key=…&limit=…
 *
 * La hoja de vida del contacto, de lo más reciente a lo más antiguo. La
 * arma `get_contact_timeline` (migración 555) con la sesión del usuario:
 * la función verifica la cuenta y decide si viaja el costo de
 * adquisición, así que esta ruta no repite ninguna de las dos reglas.
 * Un contacto de otra cuenta devuelve una lista vacía, igual que la RLS.
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const { supabase } = await getCurrentAccount();
    const { id } = await params;
    const q = parseTimelineQuery(new URL(request.url).searchParams);

    const { data, error } = await supabase.rpc('get_contact_timeline', {
      p_contact_id: id,
      p_kinds: q.kinds,
      p_before: q.before,
      p_before_key: q.beforeKey,
      p_limit: q.limit,
    });

    if (error) {
      console.error('[contacts/timeline] error:', error);
      return NextResponse.json(
        { error: 'No se pudo cargar la hoja de vida' },
        { status: 500 }
      );
    }

    return NextResponse.json({ events: data ?? [], limit: q.limit });
  } catch (err) {
    return toErrorResponse(err);
  }
}
