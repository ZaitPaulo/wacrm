import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { validateCaption } from '@/lib/social/limits';
import { networkAdapter } from '@/lib/social/networks';

type Params = { params: Promise<{ id: string }> };

/**
 * El nombre de la red como lo lee una persona.
 *
 * Todo mensaje de error tiene que nombrar la red: con dos conexiones
 * activas, "la cuenta" es ambiguo y manda a mirar la que funcionaba.
 */
function networkLabel(network: string): string {
  return network === 'facebook' ? 'Facebook' : 'Instagram';
}

/**
 * PATCH /api/social/queue/[id]  (admin+)
 *
 * Edita el texto de una publicación pendiente.
 *
 * Los límites se validan ACÁ, al guardar, y no al publicar: descubrir
 * el exceso por el rechazo de Meta desperdicia una aprobación, que es
 * un recurso escaso cuando hay un tope por periodo.
 *
 * Y son los DE LA RED DE ESTA FILA, no los de una red fija. Advertir
 * por un tope que en el destino real no existe impide guardar un texto
 * perfectamente válido; aplicar el tope más laxo al destino más
 * estricto desperdicia la aprobación que se quería proteger.
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

    // La fila se lee antes de validar porque de ella sale la red, y de
    // la red salen los límites. La RLS ya acota a la cuenta.
    const { data: post, error: postErr } = await supabase
      .from('social_posts')
      .select('id, network')
      .eq('account_id', accountId)
      .eq('id', id)
      .eq('status', 'pending')
      .maybeSingle<{ id: string; network: string }>();
    if (postErr) {
      console.error('[social/queue PATCH] lookup error:', postErr);
      return NextResponse.json(
        { error: 'No se pudo cargar la publicación' },
        { status: 500 }
      );
    }
    if (!post) {
      return NextResponse.json(
        { error: 'Esa publicación ya no está pendiente' },
        { status: 409 }
      );
    }

    const adapter = networkAdapter(post.network);
    if (!adapter) {
      console.error('[social/queue PATCH] red desconocida:', post.network);
      return NextResponse.json(
        { error: 'Esa publicación va a una red que el sistema ya no maneja' },
        { status: 409 }
      );
    }

    const problem = validateCaption(caption, adapter.limits);
    if (problem === 'too_long') {
      return NextResponse.json(
        {
          error: `El texto supera los ${adapter.limits.captionMaxChars} caracteres que acepta ${networkLabel(adapter.network)}`,
        },
        { status: 400 }
      );
    }
    if (problem === 'too_many_hashtags') {
      return NextResponse.json(
        {
          error: `${networkLabel(adapter.network)} acepta hasta ${adapter.limits.maxHashtags} etiquetas`,
        },
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
      console.error('[social/queue PATCH] error:', error);
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
 * DELETE /api/social/queue/[id]  (admin+)
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
      console.error('[social/queue DELETE] error:', error);
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
