import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { approveAndPublish, type PublishOutcome } from '@/lib/social/publish';
import type { SocialNetwork } from '@/lib/social/networks';

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/social/queue/[id]/approve  (admin+)
 *
 * ESTE ES EL ÚNICO CAMINO por el que algo sale a una red, y lo dispara
 * una persona. No hay cron, automatización ni regla que llegue hasta
 * acá.
 *
 * Aprueba UNA publicación: la de la red de esta fila. La del mismo
 * vehículo en la otra red es otra fila y otra decisión (decisión 1).
 */
export async function POST(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');
    const limit = checkRateLimit(
      `social-publish:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const outcome = await approveAndPublish({
      db: supabase,
      accountId,
      postId: id,
      userId,
    });

    return respond(outcome);
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * El nombre de la red como lo lee una persona.
 *
 * TODO MENSAJE DE ERROR LA NOMBRA. Con dos conexiones activas, "vuelve
 * a conectar la cuenta" es ambiguo: manda a tocar la que funcionaba, y
 * quien intenta arreglar Facebook termina rompiendo Instagram.
 */
function label(network: SocialNetwork): string {
  return network === 'facebook' ? 'Facebook' : 'Instagram';
}

/** Dónde se arregla la conexión de cada red, dicho tal cual se ve. */
function connectionHint(network: SocialNetwork): string {
  return network === 'facebook'
    ? 'la página de Facebook en Ajustes'
    : 'la cuenta de Instagram en Ajustes';
}

/**
 * Traduce el desenlace a una respuesta.
 *
 * Cada mensaje apunta al lugar donde SE ARREGLA el problema: un token
 * vencido manda a Ajustes y una foto rechazada manda al vehículo.
 * Confundirlos hace que la persona busque donde no es.
 */
function respond(outcome: PublishOutcome) {
  switch (outcome.status) {
    case 'published':
      return NextResponse.json({
        success: true,
        external_post_id: outcome.externalPostId,
      });

    case 'locked':
      return NextResponse.json(
        { error: 'Esta publicación se está enviando ahora mismo' },
        { status: 409 }
      );

    case 'not_pending':
      return NextResponse.json(
        { error: 'Esa publicación ya no está pendiente' },
        { status: 409 }
      );

    case 'unknown_network':
      return NextResponse.json(
        {
          error: `Esa publicación va a "${outcome.network}", una red que el sistema ya no maneja. Descártala.`,
        },
        { status: 409 }
      );

    case 'no_connection':
      return NextResponse.json(
        {
          error: `No hay ${connectionHint(outcome.network)} conectada. Conéctala antes de publicar.`,
        },
        { status: 409 }
      );

    case 'quota_exhausted':
      return NextResponse.json(
        {
          error: `Se alcanzó el tope de publicaciones que ${label(outcome.network)} permite en el periodo. La publicación sigue pendiente; vuelve a intentarlo más tarde.`,
        },
        { status: 429 }
      );

    case 'quota_unknown':
      return NextResponse.json(
        {
          error: `No se pudo verificar cuántas publicaciones quedan disponibles en ${label(outcome.network)}. No se publicó nada; inténtalo de nuevo en un momento.`,
        },
        { status: 503 }
      );

    case 'vehicle_unavailable':
      return NextResponse.json(
        {
          error:
            'El vehículo ya no está disponible, así que no se publicó. Descarta la publicación o vuelve a poner el vehículo como disponible.',
        },
        { status: 409 }
      );

    case 'vehicle_missing':
      return NextResponse.json(
        {
          error:
            'El vehículo ya no existe. La publicación se retiró de la cola.',
        },
        { status: 409 }
      );

    case 'needs_review':
      return NextResponse.json(
        {
          error: `Se perdió la respuesta de ${label(outcome.network)} y no sabemos si la publicación salió. Revísalo en ${label(outcome.network)} antes de volver a intentarlo — el sistema no reintenta solo para no publicar dos veces.`,
        },
        { status: 502 }
      );

    case 'failed':
      return NextResponse.json(
        {
          error:
            outcome.kind === 'credentials'
              ? `${label(outcome.network)} rechazó las credenciales. Vuelve a conectar ${connectionHint(outcome.network)}.`
              : `${label(outcome.network)} rechazó la publicación: ${outcome.reason}`,
        },
        { status: 502 }
      );
  }
}
