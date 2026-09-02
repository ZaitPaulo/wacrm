import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  strictestLimits,
  validateCaption,
  type NetworkLimits,
} from '@/lib/social/limits';
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
 * EL TEXTO ES DEL VEHÍCULO, NO DE LA FILA. La cola muestra un solo
 * editor por vehículo y publica en todas sus redes con ese texto, así
 * que guardar escribe en TODAS sus pendientes. Guardar solo en una
 * dejaría la otra con el texto viejo y el botón único publicaría dos
 * cosas distintas.
 *
 * Los límites se validan ACÁ, al guardar, y no al publicar: descubrir
 * el exceso por el rechazo de Meta desperdicia una aprobación, que es
 * un recurso escaso cuando hay un tope por periodo.
 *
 * Y se valida contra el MÁS ESTRICTO de las redes que siguen
 * pendientes: un texto que una de ellas rechazaría no sirve para un
 * botón que publica en todas. Cuando queda una sola pendiente, se
 * valida contra la suya y nada más — el tope de una red que ya no
 * interviene no tiene por qué impedir escribir.
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

    // La fila se lee antes de validar porque de ella sale el vehículo, y
    // del vehículo salen todas sus pendientes. La RLS ya acota a la
    // cuenta.
    const { data: post, error: postErr } = await supabase
      .from('social_posts')
      .select('id, vehicle_id')
      .eq('account_id', accountId)
      .eq('id', id)
      .eq('status', 'pending')
      .maybeSingle<{ id: string; vehicle_id: string }>();
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

    // Las hermanas: las demás pendientes del mismo vehículo. Son las
    // que comparten el texto y las que definen contra qué se valida.
    const { data: siblings, error: sibErr } = await supabase
      .from('social_posts')
      .select('id, network')
      .eq('account_id', accountId)
      .eq('vehicle_id', post.vehicle_id)
      .eq('status', 'pending')
      .returns<{ id: string; network: string }[]>();
    if (sibErr) {
      console.error('[social/queue PATCH] siblings error:', sibErr);
      return NextResponse.json(
        { error: 'No se pudo cargar la publicación' },
        { status: 500 }
      );
    }

    const pending = siblings ?? [];
    const adapters = pending
      .map((row) => networkAdapter(row.network))
      .filter((a) => a !== undefined);
    const limits = strictestLimits(adapters.map((a) => a.limits));
    if (!limits) {
      return NextResponse.json(
        { error: 'Esa publicación va a una red que el sistema ya no maneja' },
        { status: 409 }
      );
    }

    // El nombre de la red que impone el límite, para poder decir cuál
    // es. Con un tope compartido, "no entra" sin decir dónde no entra
    // deja a quien escribe sin saber qué recortar.
    const tightest = (pick: (l: NetworkLimits) => number | null) =>
      adapters.reduce((best, a) => {
        const v = pick(a.limits);
        if (v === null) return best;
        const bv = best ? pick(best.limits) : null;
        return bv === null || v < bv ? a : best;
      }, adapters[0]);

    const problem = validateCaption(caption, limits);
    if (problem === 'too_long') {
      const red = tightest((l) => l.captionMaxChars);
      return NextResponse.json(
        {
          error: `El texto supera los ${limits.captionMaxChars} caracteres que acepta ${networkLabel(red.network)}`,
        },
        { status: 400 }
      );
    }
    if (problem === 'too_many_hashtags') {
      const red = tightest((l) => l.maxHashtags);
      return NextResponse.json(
        {
          error: `${networkLabel(red.network)} acepta hasta ${limits.maxHashtags} etiquetas`,
        },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('social_posts')
      .update({ edited_caption: caption })
      .eq('account_id', accountId)
      // TODAS las pendientes del vehículo, no solo la que se editó.
      .in(
        'id',
        pending.map((row) => row.id)
      )
      // Solo se edita lo que todavía no salió. Una publicación viva no
      // se modifica desde acá — el sistema no toca lo ya publicado.
      .eq('status', 'pending')
      .select('id');
    if (error) {
      console.error('[social/queue PATCH] error:', error);
      return NextResponse.json(
        { error: 'No se pudo guardar el texto' },
        { status: 500 }
      );
    }
    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: 'Esa publicación ya no está pendiente' },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: true, updated: data.length });
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
