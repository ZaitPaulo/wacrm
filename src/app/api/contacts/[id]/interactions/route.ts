import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { parseInteractionInput } from '@/lib/contacts/interactions';

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/contacts/[id]/interactions  (agent+)
 *
 * Registra una llamada, una visita sin cita u otra interacción con el
 * contacto, a nombre de quien la registra. Vale para cualquier contacto
 * de la cuenta, lo atienda quien lo atienda. La RLS de
 * `contact_interactions` (554) repite la regla de rol y de autor, y el
 * trigger rechaza fechas futuras.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent');
    const { id: contactId } = await params;
    const body = await request.json().catch(() => null);

    const parsed = parseInteractionInput(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { data: contact } = await supabase
      .from('contacts')
      .select('id')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!contact) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { data, error } = await supabase
      .from('contact_interactions')
      .insert({
        account_id: accountId,
        contact_id: contactId,
        user_id: userId,
        ...parsed.value,
      })
      .select('*')
      .single();

    if (error) {
      console.error('[contacts/interactions POST] error:', error);
      return NextResponse.json(
        { error: 'No se pudo registrar la interacción' },
        { status: 500 }
      );
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
