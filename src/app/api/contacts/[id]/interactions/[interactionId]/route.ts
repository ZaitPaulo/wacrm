import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  parseInteractionPatch,
  type InteractionKind,
} from '@/lib/contacts/interactions';

type Params = { params: Promise<{ id: string; interactionId: string }> };

/**
 * PATCH /api/contacts/[id]/interactions/[interactionId]  (agent+)
 *
 * Corrige una interacción: resultado, fecha, duración o nota. Solo el
 * autor o un admin; lo decide la RLS, y a cualquier otro la actualización
 * no le afecta ninguna fila (403).
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await requireRole('agent');
    const { id: contactId, interactionId } = await params;
    const body = await request.json().catch(() => null);

    const { data: current } = await supabase
      .from('contact_interactions')
      .select('kind')
      .eq('id', interactionId)
      .eq('contact_id', contactId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!current) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const parsed = parseInteractionPatch(body, current.kind as InteractionKind);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    if (Object.keys(parsed.value).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('contact_interactions')
      .update(parsed.value)
      .eq('id', interactionId)
      .eq('contact_id', contactId)
      .select('*')
      .maybeSingle();
    if (error) {
      console.error('[contacts/interactions PATCH] error:', error);
      return NextResponse.json(
        { error: 'No se pudo corregir la interacción' },
        { status: 500 }
      );
    }
    if (!data) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json(data);
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * DELETE /api/contacts/[id]/interactions/[interactionId]  (agent+)
 *
 * Borra una interacción. Solo el autor o un admin (RLS).
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await requireRole('agent');
    const { id: contactId, interactionId } = await params;

    const { data, error } = await supabase
      .from('contact_interactions')
      .delete()
      .eq('id', interactionId)
      .eq('contact_id', contactId)
      .eq('account_id', accountId)
      .select('id');
    if (error) {
      console.error('[contacts/interactions DELETE] error:', error);
      return NextResponse.json(
        { error: 'No se pudo borrar la interacción' },
        { status: 500 }
      );
    }
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
