import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  CAPTION_MAX_CHARS,
  MAX_HASHTAGS,
  validateCaption,
} from '@/lib/instagram/limits';

type Params = { params: Promise<{ id: string }> };

/**
 * PATCH /api/instagram/queue/[id]  (admin+)
 *
 * Edita el texto de una publicación pendiente.
 *
 * Los límites de Instagram se validan ACÁ, al guardar, y no al
 * publicar: descubrir el exceso por el rechazo de Meta desperdicia una
 * aprobación, que es un recurso escaso cuando hay un tope diario.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');
    const limit = checkRateLimit(`ig-queue:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (typeof body?.caption !== 'string') {
      return NextResponse.json({ error: 'Falta el texto' }, { status: 400 });
    }

    const caption = body.caption.trim();
    if (!caption) {
      return NextResponse.json(
        { error: 'El texto no puede quedar vacío' },
        { status: 400 }
      );
    }

    const problem = validateCaption(caption);
    if (problem === 'too_long') {
      return NextResponse.json(
        {
          error: `El texto supera los ${CAPTION_MAX_CHARS} caracteres que acepta Instagram`,
        },
        { status: 400 }
      );
    }
    if (problem === 'too_many_hashtags') {
      return NextResponse.json(
        { error: `Instagram acepta hasta ${MAX_HASHTAGS} etiquetas` },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('social_posts')
      .update({ edited_caption: caption })
      .eq('account_id', accountId)
      .eq('id', id)
      // Solo se edita lo que todavía no salió. Una publicación viva no
      // se modifica desde acá — el sistema no toca lo ya publicado.
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (error) {
      console.error('[instagram/queue PATCH] error:', error);
      return NextResponse.json(
        { error: 'No se pudo guardar el texto' },
        { status: 500 }
      );
    }
    if (!data) {
      return NextResponse.json(
        { error: 'Esa publicación ya no está pendiente' },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * DELETE /api/instagram/queue/[id]  (admin+)
 *
 * Descarta una pendiente. El vehículo queda intacto y nunca se publica
 * esa propuesta.
 *
 * Se marca como descartada en vez de borrarse: acá SÍ hubo una decisión
 * humana, y conviene que quede registrada — a diferencia del retiro
 * automático cuando el vehículo deja de estar disponible, que no
 * corresponde atribuirle a nadie.
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { id } = await params;

    const { data, error } = await supabase
      .from('social_posts')
      .update({ status: 'discarded' })
      .eq('account_id', accountId)
      .eq('id', id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (error) {
      console.error('[instagram/queue DELETE] error:', error);
      return NextResponse.json(
        { error: 'No se pudo descartar la publicación' },
        { status: 500 }
      );
    }
    if (!data) {
      return NextResponse.json(
        { error: 'Esa publicación ya no está pendiente' },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
