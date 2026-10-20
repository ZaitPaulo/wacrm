import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/contacts/[id]/summary
 *
 * El resumen de la hoja de vida (cliente desde, asesor por canal, citas,
 * vehículos, negocios abiertos) y `can_edit`, que dice si quien mira
 * puede editar el contacto. Lo calcula `get_contact_summary` (555).
 * 404 si el contacto no existe o es de otra cuenta.
 */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { supabase } = await getCurrentAccount();
    const { id } = await params;

    const { data, error } = await supabase.rpc('get_contact_summary', {
      p_contact_id: id,
    });

    if (error) {
      console.error('[contacts/summary] error:', error);
      return NextResponse.json(
        { error: 'No se pudo cargar el resumen' },
        { status: 500 }
      );
    }
    if (!data) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (err) {
    return toErrorResponse(err);
  }
}
