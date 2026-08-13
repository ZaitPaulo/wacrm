import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { encrypt } from '@/lib/whatsapp/encryption';
import { getAccountInfo, isPublishableAccountType } from '@/lib/instagram/api';
import { getConnectionInfo } from '@/lib/instagram/config';
import { InstagramError } from '@/lib/instagram/errors';

/**
 * La conexión de Instagram de la cuenta.  (admin+)
 *
 * El token se PEGA, no se obtiene por un redirect de OAuth. Es el mismo
 * trato que ya recibe WhatsApp en este proyecto, y evita montar el
 * baile de redirecciones para un dato que se configura una vez. Lo que
 * sí se hace es verificarlo contra Instagram antes de guardarlo, para
 * que una cuenta que no sirve se rechace acá y no al publicar.
 *
 * El rol es `admin` o superior en los tres verbos, igual que la RLS de
 * `instagram_config` (migración 512): la fila guarda un token.
 */

/** GET — a qué cuenta estamos conectados. Nunca devuelve el token. */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin');
    return NextResponse.json(await getConnectionInfo(supabase, accountId));
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** POST — conecta (o reconecta) la cuenta. */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');
    const limit = checkRateLimit(
      `ig-connect:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    const accessToken =
      typeof body?.access_token === 'string' ? body.access_token.trim() : '';
    if (!accessToken) {
      return NextResponse.json(
        { error: 'Falta el token de acceso de Instagram' },
        { status: 400 }
      );
    }

    // Se verifica ANTES de guardar. Un token que no sirve guardado como
    // si sirviera convierte el primer intento de publicar en un fallo
    // sin relación aparente con lo que se hizo en Ajustes.
    let info;
    try {
      info = await getAccountInfo({ accessToken });
    } catch (err) {
      const message =
        err instanceof InstagramError
          ? err.message
          : 'No se pudo verificar la cuenta de Instagram';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    if (!isPublishableAccountType(info.accountType)) {
      return NextResponse.json(
        {
          error:
            'Esa es una cuenta personal de Instagram y no puede publicar por API. Conviértela en cuenta profesional desde la app de Instagram e inténtalo de nuevo.',
        },
        { status: 400 }
      );
    }

    const { error } = await supabase.from('instagram_config').upsert(
      {
        account_id: accountId,
        ig_user_id: info.id,
        username: info.username,
        access_token: encrypt(accessToken),
        status: 'connected',
        connected_at: new Date().toISOString(),
      },
      { onConflict: 'account_id' }
    );
    if (error) {
      console.error('[instagram/connection POST] error:', error);
      return NextResponse.json(
        { error: 'No se pudo guardar la conexión' },
        { status: 500 }
      );
    }

    return NextResponse.json({ connected: true, username: info.username });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * DELETE — desconecta.
 *
 * Se borra la fila entera y no solo el estado: dejar el token guardado
 * de una conexión que el usuario dio de baja no tiene ningún uso. Lo ya
 * publicado en Instagram no se toca, y las pendientes quedan esperando
 * a que haya cuenta de nuevo.
 */
export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin');

    const { error } = await supabase
      .from('instagram_config')
      .delete()
      .eq('account_id', accountId);
    if (error) {
      console.error('[instagram/connection DELETE] error:', error);
      return NextResponse.json(
        { error: 'No se pudo desconectar la cuenta' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
