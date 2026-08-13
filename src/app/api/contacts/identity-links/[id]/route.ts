import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { unlinkContacts } from '@/lib/contacts/identity-links';

type Params = { params: Promise<{ id: string }> };

/**
 * DELETE /api/contacts/identity-links/[id]
 *
 * Deshace una vinculación, devolviéndole a cada ficha lo que era suyo.
 *
 * Existe porque unir mal es el error caro de este flujo, y la única
 * forma de que sugerir sea seguro es que revertir también lo sea. No
 * borra el registro: lo marca como deshecho.
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent');
    const limit = checkRateLimit(
      `ident-unlink:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const result = await unlinkContacts({
      db: supabase,
      accountId,
      linkId: id,
      userId,
    });

    if (!result.ok) {
      if (result.reason === 'link_not_found') {
        return NextResponse.json(
          { error: 'Esa vinculación no existe' },
          { status: 404 }
        );
      }
      if (result.reason === 'already_undone') {
        return NextResponse.json(
          { error: 'Esa vinculación ya se había deshecho' },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: 'No se pudo deshacer la vinculación' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
