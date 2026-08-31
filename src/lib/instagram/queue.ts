import { getTranslations } from 'next-intl/server';
import { supabaseAdmin } from '@/lib/ai/admin-client';

import { composeVehiclePost } from './compose';
import {
  buildVehicleCaption,
  type AccountForCaption,
  type VehicleForCaption,
} from './caption';

// ============================================================
// Encolado: un vehículo disponible deja un borrador pendiente.
//
// Calcado de syncVehicleKnowledge (src/lib/inventory/knowledge-sync.ts),
// que resuelve el mismo problema para el knowledge base:
//
//   - status 'available'                 -> prepara/refresca el borrador
//   - otro status (sold/reserved/hidden) -> retira el pendiente
//
// Corre con el cliente SERVICE-ROLE porque la RLS de social_posts exige
// 'admin' y quien edita inventario es 'agent'. Cada consulta se acota
// por account_id a mano, igual que allá.
//
// Lanza si algo falla; el llamador (la API route) lo captura y degrada
// a warning para no tumbar el guardado del vehículo. Encolar NUNCA
// puede impedir cargar inventario.
// ============================================================

const NETWORK = 'instagram';

/** Columnas que necesita la composición, y ninguna más. */
const VEHICLE_COLUMNS =
  'id, status, images, brand, model, year, price, warranty_price, mileage, ' +
  'transmission, engine_displacement, plate_city, soat_expires_at, ' +
  'tecnomecanica_expires_at';

const ACCOUNT_COLUMNS =
  'default_currency, public_name, public_address, public_whatsapp, ' +
  'public_phone, public_email';

interface VehicleRow extends VehicleForCaption {
  id: string;
  status: string;
  images: string[] | null;
}

/**
 * (Re)sincroniza el borrador de publicación de un vehículo.
 *
 * Idempotente: llamarla dos veces con el mismo estado no crea dos
 * pendientes. La unicidad parcial de la migración 512 lo garantiza
 * también del lado de la base.
 */
export async function syncVehiclePost(
  accountId: string,
  vehicleId: string
): Promise<void> {
  const admin = supabaseAdmin();

  const { data: vehicle, error } = await admin
    .from('inventory_vehicles')
    .select(VEHICLE_COLUMNS)
    .eq('account_id', accountId)
    .eq('id', vehicleId)
    .maybeSingle<VehicleRow>();
  if (error) throw error;
  if (!vehicle) return;

  // Publicable significa EXACTAMENTE disponible (decisión 10). Un
  // vehículo reservado u oculto ya no aparece en la vitrina, así que
  // anunciarlo llevaría a una ficha que el interesado no puede ver.
  if (vehicle.status !== 'available') {
    await removePending(accountId, vehicleId);
    return;
  }

  const { data: account, error: accErr } = await admin
    .from('accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('id', accountId)
    .maybeSingle<AccountForCaption>();
  if (accErr) throw accErr;
  if (!account) return;

  const t = await getTranslations('InstagramPost');

  const composed = composeVehiclePost({
    vehicle,
    account,
    images: vehicle.images,
    t: (key, values) => t(key, values),
  });

  // Sin imágenes no hay nada que publicar. Si además había un pendiente
  // —le borraron las fotos después de encolarlo— se retira: sus URLs
  // congeladas apuntan a lo que ya no está, y ese pendiente solo puede
  // terminar en un fallo al publicar.
  if (!composed.ok) {
    console.warn(
      `[instagram queue] vehículo ${vehicleId} sin publicación: ${composed.reason}`
    );
    await removePending(accountId, vehicleId);
    return;
  }

  const { data: existing, error: exErr } = await admin
    .from('social_posts')
    .select('id, edited_caption')
    .eq('account_id', accountId)
    .eq('vehicle_id', vehicleId)
    .eq('network', NETWORK)
    .eq('status', 'pending')
    .maybeSingle<{ id: string; edited_caption: string | null }>();
  if (exErr) throw exErr;

  if (existing) {
    // Ya hay un pendiente: no se duplica. Se refresca contra la ficha
    // actual, porque un borrador con el precio viejo es justo lo que
    // este sistema existe para no publicar.
    //
    // Salvo que alguien ya haya escrito su propia versión: pisarle el
    // texto a quien lo editó sería peor que mostrar un precio viejo,
    // porque pierde trabajo sin avisar. En ese caso solo se refrescan
    // las imágenes.
    const patch: Record<string, unknown> = { image_urls: composed.imageUrls };
    if (existing.edited_caption === null) {
      patch.proposed_caption = composed.caption;
    }

    const { error: upErr } = await admin
      .from('social_posts')
      .update(patch)
      .eq('account_id', accountId)
      .eq('id', existing.id);
    if (upErr) throw upErr;
    return;
  }

  // No hay pendiente. Se crea uno — también cuando el vehículo ya se
  // publicó antes: un auto que reingresa es un hecho comercial nuevo
  // (decisión 11), y la cola muestra el antecedente para que quien
  // revisa decida con esa información a la vista.
  const { error: insErr } = await admin.from('social_posts').insert({
    account_id: accountId,
    vehicle_id: vehicleId,
    network: NETWORK,
    status: 'pending',
    proposed_caption: composed.caption,
    image_urls: composed.imageUrls,
  });
  if (insErr) {
    // 23505 = otra petición ganó la carrera y ya insertó el pendiente.
    // El índice único parcial hizo su trabajo; no es un error.
    if ((insErr as { code?: string }).code === '23505') return;
    throw insErr;
  }
}

/**
 * Retira el pendiente de un vehículo, si lo tenía.
 *
 * Se BORRA en vez de marcarse como descartado: descartar es una
 * decisión que toma una persona, y registrar como tal algo que nadie
 * decidió le atribuiría al equipo una acción que no ocurrió. Es el
 * mismo criterio con que knowledge-sync borra el documento del KB en
 * lugar de dejar una lápida.
 *
 * Lo ya publicado no se toca: el sistema nunca borra de Instagram.
 */
async function removePending(
  accountId: string,
  vehicleId: string
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('social_posts')
    .delete()
    .eq('account_id', accountId)
    .eq('vehicle_id', vehicleId)
    .eq('network', NETWORK)
    .eq('status', 'pending');
  if (error) throw error;
}

/**
 * Vuelve a armar los borradores pendientes contra la ficha actual.
 *
 * `syncVehiclePost` solo corre cuando alguien guarda un vehículo. Con
 * eso alcanza mientras lo que cambia es el vehículo, pero no cuando
 * cambia la PLANTILLA del texto o un dato público del negocio —la
 * dirección, el teléfono—: ahí los pendientes se quedarían con el texto
 * viejo hasta que alguien tocara cada vehículo a mano, uno por uno.
 *
 * Se llama al abrir la cola, que es el único momento en que esos
 * borradores le importan a alguien. Solo escribe lo que de verdad
 * cambió, así que en estado estable no hace ninguna escritura.
 *
 * NO toca lo que una persona editó: ese texto es trabajo suyo y
 * pisarlo sería perderlo sin avisar. Es la misma regla que aplica
 * `syncVehiclePost`.
 */
export async function refreshPendingCaptions(accountId: string): Promise<void> {
  const admin = supabaseAdmin();

  const { data: pending, error: pendErr } = await admin
    .from('social_posts')
    .select('id, vehicle_id, proposed_caption')
    .eq('account_id', accountId)
    .eq('network', NETWORK)
    .eq('status', 'pending')
    .is('edited_caption', null)
    .returns<
      { id: string; vehicle_id: string; proposed_caption: string }[]
    >();
  if (pendErr) throw pendErr;
  if (!pending || pending.length === 0) return;

  const { data: account, error: accErr } = await admin
    .from('accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('id', accountId)
    .maybeSingle<AccountForCaption>();
  if (accErr) throw accErr;
  if (!account) return;

  const { data: vehicles, error: vehErr } = await admin
    .from('inventory_vehicles')
    .select(VEHICLE_COLUMNS)
    .eq('account_id', accountId)
    .in(
      'id',
      pending.map((p) => p.vehicle_id)
    )
    .returns<VehicleRow[]>();
  if (vehErr) throw vehErr;

  const byId = new Map((vehicles ?? []).map((v) => [v.id, v]));
  const t = await getTranslations('InstagramPost');

  for (const post of pending) {
    const vehicle = byId.get(post.vehicle_id);
    // Un pendiente sin vehículo no se limpia acá: de eso se encarga
    // `syncVehiclePost`, y esta función solo reescribe texto.
    if (!vehicle) continue;

    const caption = buildVehicleCaption({
      vehicle,
      account,
      t: (key, values) => t(key, values),
    });
    if (caption === post.proposed_caption) continue;

    const { error: upErr } = await admin
      .from('social_posts')
      .update({ proposed_caption: caption })
      .eq('account_id', accountId)
      .eq('id', post.id);
    if (upErr) throw upErr;
  }
}
