import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { encrypt } from '@/lib/whatsapp/encryption';
import { listManagedPages } from '@/lib/social/facebook/api';
import { getConnectionInfo } from '@/lib/social/facebook/config';
import { SocialPublishError } from '@/lib/social/errors';

/**
 * La conexión de Facebook de la cuenta.  (admin+)
 *
 * `/api/social/connection/facebook`, con la red como segmento literal y
 * no dinámico: conectar Facebook no es el mismo trámite que conectar
 * Instagram. Allá alcanza con pegar un token; acá hace falta además
 * elegir en cuál de las páginas que administra el usuario se publica,
 * y ese paso vive en `./pages`.
 *
 * El token se PEGA, no se obtiene por un redirect de OAuth — mismo
 * trato que WhatsApp e Instagram en este proyecto.
 *
 * El rol es `admin` o superior en los tres verbos, igual que la RLS de
 * `facebook_config` (migración 517): la fila guarda un token.
 */

/** GET — a qué página estamos conectados. Nunca devuelve el token. */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin');
    return NextResponse.json(await getConnectionInfo(supabase, accountId));
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST — conecta (o reconecta) la página elegida.
 *
 * Recibe el token de USUARIO otra vez, junto con la página elegida en
 * el paso anterior, y va a buscarle a Meta el token DE ESA PÁGINA. Es
 * lo que se guarda: publicar en una página se autentica con el suyo, y
 * derivarlo en cada publicación sería una petición de red más y un
 * punto de fallo más en el momento menos conveniente (decisión 3).
 *
 * Se pide de nuevo a Meta en vez de recibirlo del navegador para que el
 * token de la página nunca viaje al cliente.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');
    const limit = checkRateLimit(
      `fb-connect:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    const accessToken =
      typeof body?.access_token === 'string' ? body.access_token.trim() : '';
    const pageId = typeof body?.page_id === 'string' ? body.page_id.trim() : '';

    if (!accessToken) {
      return NextResponse.json(
        { error: 'Falta el token de acceso de Facebook' },
        { status: 400 }
      );
    }
    if (!pageId) {
      return NextResponse.json(
        { error: 'Falta elegir la página en la que se va a publicar' },
        { status: 400 }
      );
    }

    // Se verifica ANTES de guardar. Una página que ya no administra, o
    // un token que caducó entre los dos pasos, se rechaza acá y con su
    // motivo — no días después, al publicar, sin relación aparente con
    // lo que se hizo en Ajustes.
    let pages;
    try {
      pages = await listManagedPages({ userAccessToken: accessToken });
    } catch (err) {
      const message =
        err instanceof SocialPublishError
          ? err.message
          : 'No se pudo verificar la página de Facebook';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const page = pages.find((candidate) => candidate.id === pageId);
    if (!page) {
      return NextResponse.json(
        {
          error:
            'Ya no tienes permiso para publicar en esa página. Vuelve a empezar la conexión y elige de nuevo.',
        },
        { status: 400 }
      );
    }

    const { error } = await supabase.from('facebook_config').upsert(
      {
        account_id: accountId,
        page_id: page.id,
        page_name: page.name,
        access_token: encrypt(page.accessToken),
        // Meta no informa vencimiento en este listado, y un token de
        // página derivado de uno de usuario de larga duración no suele
        // caducar mientras el permiso siga concedido. Queda en NULL en
        // vez de afirmar una fecha que no sabemos: el sistema sigue
        // tratando el vencimiento como posible y lo va a descubrir por
        // un fallo de credenciales, que dice qué red reconectar.
        token_expires_at: null,
        status: 'connected',
        connected_at: new Date().toISOString(),
      },
      { onConflict: 'account_id' }
    );
    if (error) {
      console.error('[social/connection/facebook POST] error:', error);
      return NextResponse.json(
        { error: 'No se pudo guardar la conexión' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      connected: true,
      page_id: page.id,
      page_name: page.name,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * DELETE — desconecta.
 *
 * Se borra la fila entera y no solo el estado: dejar el token guardado
 * de una conexión que el usuario dio de baja no tiene ningún uso. Lo ya
 * publicado en Facebook no se toca, y las pendientes de esta red se
 * retiran en el siguiente encolado — un borrador que nadie puede
 * aprobar solo se puede descartar.
 *
 * INSTAGRAM NO SE VE AFECTADO. Son dos conexiones independientes, y esa
 * independencia es justamente lo que este diseño compra.
 */
export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin');

    const { error } = await supabase
      .from('facebook_config')
      .delete()
      .eq('account_id', accountId);
    if (error) {
      console.error('[social/connection/facebook DELETE] error:', error);
      return NextResponse.json(
        { error: 'No se pudo desconectar la página' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
