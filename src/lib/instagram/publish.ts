import type { SupabaseClient } from '@supabase/supabase-js';

import { getPublishingLimit, publishImagePost } from './api';
import { loadInstagramConfig } from './config';
import { ensurePublishableImages } from './images';
import { InstagramError, isOutcomeUnknown } from './errors';

// ============================================================
// Aprobar y publicar.
//
// Es el único camino por el que algo sale a Instagram, y siempre lo
// dispara una persona. No hay cron, automatización ni regla que llame
// a esto.
//
// El orden de los pasos no es arbitrario — cada uno evita gastar el
// siguiente:
//
//   1. margen del tope   (barato, y si no queda, nada más importa)
//   2. candado           (antes de tocar Meta, nunca después)
//   3. revalidación      (el inventario cambia por caminos que la cola
//                         no observa)
//   4. imágenes a JPEG   (trabajo caro, solo si todo lo anterior pasó)
//   5. envío
// ============================================================

/**
 * Cuánto se honra un candado antes de leerlo como abandonado.
 *
 * Mismo criterio y mismo valor que `DELIVERY_LOCK_STALE_MS` en las
 * difusiones: largo para no robarle el turno a un envío lento, corto
 * para que un proceso muerto no deje la publicación trabada hasta que
 * alguien toque la base a mano.
 */
export const PUBLISH_LOCK_STALE_MS = 30 * 60 * 1000;

export type PublishOutcome =
  | { status: 'published'; externalPostId: string }
  | { status: 'locked' }
  | { status: 'not_pending' }
  | { status: 'no_connection' }
  | { status: 'quota_exhausted'; remaining: number }
  | { status: 'quota_unknown' }
  | { status: 'vehicle_unavailable' }
  | { status: 'vehicle_missing' }
  | { status: 'failed'; kind: 'credentials' | 'content'; reason: string }
  | { status: 'needs_review'; reason: string };

interface PostRow {
  id: string;
  vehicle_id: string;
  status: string;
  proposed_caption: string;
  edited_caption: string | null;
  image_urls: string[];
}

/**
 * Toma el candado de publicación.
 *
 * Un solo UPDATE condicional, así que la toma es atómica: al llamador
 * concurrente su WHERE ya no le engancha y recibe `false`. Es el mismo
 * mecanismo que `claimBroadcastDelivery`, y por la misma razón — dos
 * clics no pueden publicar dos veces, y una publicación de Instagram no
 * se retira.
 */
export async function claimPublishLock(
  db: SupabaseClient,
  accountId: string,
  postId: string,
  now: Date = new Date()
): Promise<boolean> {
  const staleCutoff = new Date(
    now.getTime() - PUBLISH_LOCK_STALE_MS
  ).toISOString();

  const { data, error } = await db
    .from('social_posts')
    .update({ publish_locked_at: now.toISOString() })
    .eq('id', postId)
    .eq('account_id', accountId)
    // Solo un pendiente se publica: si otra petición ya lo dejó
    // publicado, este WHERE no engancha y el candado no se toma.
    .eq('status', 'pending')
    .or(`publish_locked_at.is.null,publish_locked_at.lt.${staleCutoff}`)
    .select('id');

  if (error) {
    console.error('[instagram publish] claim failed:', error.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

/** Suelta el candado. Best-effort: uno viejo vence solo. */
export async function releasePublishLock(
  db: SupabaseClient,
  postId: string
): Promise<void> {
  const { error } = await db
    .from('social_posts')
    .update({ publish_locked_at: null })
    .eq('id', postId);
  if (error) {
    console.error('[instagram publish] release failed:', error.message);
  }
}

/**
 * Aprueba una publicación pendiente y la envía a Instagram.
 *
 * Devuelve siempre un desenlace descrito, nunca lanza por un fallo
 * esperable: quien llama traduce el desenlace a un mensaje y a un
 * código HTTP.
 */
export async function approveAndPublish(args: {
  db: SupabaseClient;
  accountId: string;
  postId: string;
  userId: string;
}): Promise<PublishOutcome> {
  const { db, accountId, postId, userId } = args;

  const { data: post, error: postErr } = await db
    .from('social_posts')
    .select(
      'id, vehicle_id, status, proposed_caption, edited_caption, image_urls'
    )
    .eq('account_id', accountId)
    .eq('id', postId)
    .maybeSingle<PostRow>();
  if (postErr) throw postErr;
  if (!post) return { status: 'not_pending' };
  if (post.status !== 'pending') return { status: 'not_pending' };

  const config = await loadInstagramConfig(db, accountId);
  if (!config) return { status: 'no_connection' };

  // 1. Margen. Se pregunta ANTES de tomar el candado: si no queda, la
  // publicación sigue pendiente y disponible para mañana, sin haber
  // quedado trabada por un candado que nadie va a soltar.
  let remaining: number;
  try {
    remaining = (
      await getPublishingLimit({
        igUserId: config.igUserId,
        accessToken: config.accessToken,
      })
    ).remaining;
  } catch (err) {
    console.error('[instagram publish] quota check failed:', err);
    // No poder verificar el margen impide aprobar. Publicar a ciegas
    // no es una alternativa: el rechazo de Meta gastaría el intento.
    return { status: 'quota_unknown' };
  }
  if (remaining <= 0) return { status: 'quota_exhausted', remaining };

  // 2. Candado, antes de hablar con Meta.
  if (!(await claimPublishLock(db, accountId, postId))) {
    return { status: 'locked' };
  }

  try {
    // 3. Revalidación. Entre preparar y aprobar pueden pasar días.
    const { data: vehicle, error: vehErr } = await db
      .from('inventory_vehicles')
      .select('id, status')
      .eq('account_id', accountId)
      .eq('id', post.vehicle_id)
      .maybeSingle<{ id: string; status: string }>();
    if (vehErr) throw vehErr;

    if (!vehicle) {
      // El vehículo ya no existe: la pendiente no tiene objeto. La fila
      // caerá igual por el ON DELETE CASCADE, pero puede no haber
      // ocurrido todavía si llegamos por otro camino.
      await db.from('social_posts').delete().eq('id', postId);
      return { status: 'vehicle_missing' };
    }
    if (vehicle.status !== 'available') {
      return { status: 'vehicle_unavailable' };
    }

    // 4. Imágenes en el formato que Instagram acepta. Verifica de paso
    // que sigan estando: una URL caída falla acá, antes del envío.
    const imageUrls = await ensurePublishableImages({
      db,
      accountId,
      imageUrls: post.image_urls,
    });

    // 5. Envío. El texto editado gana sobre el propuesto.
    const caption = post.edited_caption ?? post.proposed_caption;
    const externalPostId = await publishImagePost({
      igUserId: config.igUserId,
      accessToken: config.accessToken,
      imageUrls,
      caption,
    });

    await db
      .from('social_posts')
      .update({
        status: 'published',
        external_post_id: externalPostId,
        published_at: new Date().toISOString(),
        approved_by: userId,
        publish_locked_at: null,
        failure_kind: null,
        failure_reason: null,
      })
      .eq('id', postId);

    return { status: 'published', externalPostId };
  } catch (err) {
    return recordFailure(db, postId, err);
  } finally {
    // Si el camino feliz ya lo puso en null, esto no cambia nada. Si
    // algo lanzó antes de guardar, suelta el candado igual: una fila
    // trabada es peor que una fila fallida, porque no se puede
    // reintentar hasta que el candado venza.
    await releasePublishLock(db, postId);
  }
}

/**
 * Escribe el desenlace de un envío fallido.
 *
 * La distinción que importa: cuando NO SE SABE si la publicación salió,
 * la fila va a revisión manual y no a fallida. Marcarla fallida
 * invitaría a reintentar, y reintentar puede duplicar una publicación
 * que no se puede retirar.
 */
async function recordFailure(
  db: SupabaseClient,
  postId: string,
  err: unknown
): Promise<PublishOutcome> {
  const reason = err instanceof Error ? err.message : String(err);

  if (isOutcomeUnknown(err)) {
    console.error('[instagram publish] desenlace desconocido:', reason);
    await db
      .from('social_posts')
      .update({
        status: 'needs_review',
        publish_locked_at: null,
        failure_reason: reason,
      })
      .eq('id', postId);
    return { status: 'needs_review', reason };
  }

  const kind = err instanceof InstagramError ? err.kind : 'content';
  console.error(`[instagram publish] falló (${kind}):`, reason);

  await db
    .from('social_posts')
    .update({
      status: 'failed',
      publish_locked_at: null,
      failure_kind: kind,
      failure_reason: reason,
    })
    .eq('id', postId);

  return { status: 'failed', kind, reason };
}
