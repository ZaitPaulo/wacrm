import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { listManagedPages } from '@/lib/social/facebook/api';
import { SocialPublishError } from '@/lib/social/errors';

/**
 * POST /api/social/connection/facebook/pages  (admin+)
 *
 * Las páginas que administra el dueño del token pegado. NO GUARDA NADA:
 * es el primer paso de una conexión de dos, y existe porque un usuario
 * puede administrar varias páginas y elegir por él sería publicar en la
 * equivocada — algo visible para los clientes del negocio y que no se
 * deshace.
 *
 * EL TOKEN DE CADA PÁGINA NO SALE DE ACÁ. La respuesta lleva id y
 * nombre y nada más; el token se vuelve a pedir a Meta al guardar, con
 * el mismo token de usuario. Devolverlo al navegador para que lo mande
 * de vuelta sería filtrar al cliente exactamente la credencial que la
 * RLS de `facebook_config` existe para proteger.
 */
export async function POST(request: Request) {
  try {
    const { userId } = await requireRole('admin');
    const limit = checkRateLimit(
      `fb-connect:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    const accessToken =
      typeof body?.access_token === 'string' ? body.access_token.trim() : '';
    if (!accessToken) {
      return NextResponse.json(
        { error: 'Falta el token de acceso de Facebook' },
        { status: 400 }
      );
    }

    let pages;
    try {
      pages = await listManagedPages({ userAccessToken: accessToken });
    } catch (err) {
      const message =
        err instanceof SocialPublishError
          ? err.message
          : 'No se pudo consultar las páginas de Facebook';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    if (pages.length === 0) {
      return NextResponse.json(
        {
          error:
            'Ese token no da acceso a ninguna página de Facebook con permiso para publicar. Revisa que seas administrador de la página y que el token incluya los permisos de páginas.',
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      pages: pages.map((page) => ({ id: page.id, name: page.name })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
