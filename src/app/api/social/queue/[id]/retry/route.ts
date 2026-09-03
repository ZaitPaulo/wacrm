import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/social/queue/[id]/retry  (admin+)
 *
 * Devuelve a pendiente una publicación que falló, para poder aprobarla
 * de nuevo. Es POR RED: reintentar la de Facebook no toca la de
 * Instagram del mismo vehículo.
 *
 * LO QUE ESTO ARREGLA: hasta ahora una publicación fallida se iba al
 * historial sin ninguna forma de recuperarla desde la interfaz. Un
 * corte de red sacaba un vehículo de la cola para siempre y había que
 * reponerlo a mano con SQL.
 *
 * NO PUBLICA NADA. Solo devuelve la fila a `pending`; sale a la red
 * recién cuando alguien aprueba, que sigue siendo el único camino. La
 * pantalla lo nombra en esos términos —«Volver a la cola»— porque
 * llamarlo «Reintentar» hacía esperar un envío que no ocurre.
 */
export async function POST(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');
    const limit = checkRateLimit(
      `social-retry:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;

    const { data: post, error: postErr } = await supabase
      .from('social_posts')
      .select('id, status, external_post_id')
      .eq('account_id', accountId)
      .eq('id', id)
      .maybeSingle<{
        id: string;
        status: string;
        external_post_id: string | null;
      }>();
    if (postErr) {
      console.error('[social/retry] lookup error:', postErr);
      return NextResponse.json(
        { error: 'No se pudo cargar la publicación' },
        { status: 500 }
      );
    }
    if (!post) {
      return NextResponse.json(
        { error: 'Esa publicación ya no existe' },
        { status: 404 }
      );
    }

    // La prueba de que salió es el identificador, no el estado. Con
    // identificador no hay nada que reintentar: republicar duplicaría
    // algo que no se deshace.
    if (post.external_post_id) {
      return NextResponse.json(
        {
          error:
            'Esa publicación ya salió, así que no se reintenta. Republicarla la duplicaría.',
        },
        { status: 409 }
      );
    }

    // 'needs_review' entra a propósito: es la salida que el diseño
    // previó para una persona que fue a mirar la red y comprobó que no
    // había salido. La advertencia la pone la pantalla, no esta ruta.
    if (post.status !== 'failed' && post.status !== 'needs_review') {
      return NextResponse.json(
        { error: 'Solo se reintenta una publicación que falló' },
        { status: 409 }
      );
    }

    const { data, error } = await supabase
      .from('social_posts')
      // EL MOTIVO DEL FALLO NO SE BORRA. Rearmar no deshace lo que
      // pasó: quien vuelva a la cola —o quien mire el problema una hora
      // después— tiene que poder leer por qué no salió la vez anterior.
      // Borrarlo dejaba una pendiente indistinguible de una recién
      // preparada, y el motivo solo quedaba en los logs del servidor.
      //
      // Se limpia solo al publicar bien (`approveAndPublish`) o al
      // volver a fallar, que lo reescribe.
      .update({
        status: 'pending',
        publish_locked_at: null,
      })
      .eq('account_id', accountId)
      .eq('id', id)
      // Se repite el estado en el WHERE para que dos reintentos
      // simultáneos no compitan: el segundo no engancha fila.
      .in('status', ['failed', 'needs_review'])
      .is('external_post_id', null)
      .select('id')
      .maybeSingle();

    if (error) {
      // 23505 = el índice único parcial de pendientes. No es un fallo a
      // esconder: significa que el vehículo ya tiene un borrador fresco
      // esperando en esa red, y eso es justamente lo que hay que decir.
      if ((error as { code?: string }).code === '23505') {
        return NextResponse.json(
          {
            error:
              'Ese vehículo ya tiene una publicación pendiente en esa red. Revisa la que está esperando en vez de reintentar esta.',
          },
          { status: 409 }
        );
      }
      console.error('[social/retry] error:', error);
      return NextResponse.json(
        { error: 'No se pudo reintentar la publicación' },
        { status: 500 }
      );
    }
    if (!data) {
      return NextResponse.json(
        { error: 'Esa publicación ya no se puede reintentar' },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
