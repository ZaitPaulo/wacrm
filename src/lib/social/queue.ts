import { getTranslations } from 'next-intl/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/ai/admin-client';

import { composeVehiclePost } from './compose';
import {
  allNetworks,
  connectedNetworks,
  networkAdapter,
  type SocialNetwork,
} from './networks';
import type { NetworkLimits } from './limits';
import {
  buildVehicleCaption,
  type AccountForCaption,
  type VehicleForCaption,
} from './caption';

// ============================================================
// Encolado: un vehículo disponible deja un borrador pendiente POR CADA
// RED CONECTADA.
//
// Calcado de syncVehicleKnowledge (src/lib/inventory/knowledge-sync.ts),
// que resuelve el mismo problema para el knowledge base:
//
//   - status 'available'                 -> prepara/refresca el borrador
//   - otro status (sold/reserved/hidden) -> retira el pendiente
//
// LAS REDES SE TRATAN AISLADAS. Un fallo preparando el borrador de una
// no puede impedir que se prepare el de la otra: con dos redes, un
// error de Instagram que dejara a Facebook sin borrador sería un
// acoplamiento invisible desde la cola. Se intentan todas y recién al
// final se propaga el primer error, para que el llamador se entere sin
// que la primera red que falle se lleve a las demás.
//
// UNA RED DESCONECTADA NO DEJA PENDIENTES. Un borrador que nadie puede
// aprobar solo se puede descartar, así que llenar la cola de esas
// entradas es trabajo manual con pasos extra.
//
// Corre con el cliente SERVICE-ROLE porque la RLS de social_posts exige
// 'admin' y quien edita inventario es 'agent'. Cada consulta se acota
// por account_id a mano, igual que allá.
//
// Lanza si algo falla; el llamador (la API route) lo captura y degrada
// a warning para no tumbar el guardado del vehículo. Encolar NUNCA
// puede impedir cargar inventario.
// ============================================================

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

/** El traductor del namespace de la publicación, ya resuelto. */
type Translator = (key: string, values?: Record<string, string>) => string;

/**
 * (Re)sincroniza los borradores de publicación de un vehículo, uno por
 * cada red que la cuenta tenga conectada.
 *
 * Idempotente: llamarla dos veces con el mismo estado no crea dos
 * pendientes. La unicidad parcial de la migración 512 lo garantiza
 * también del lado de la base, y es por vehículo Y RED — dos redes no
 * se pisan entre ellas.
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
  // Se retira de TODAS las redes: dejó de ser publicable en general.
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

  const connected = await connectedNetworks(admin, accountId);
  const connectedIds = new Set(connected.map((n) => n.network));

  // Lo que quedó fuera se limpia. Cubre el caso de desconectar una red
  // con pendientes vivas: se quedarían esperando una aprobación
  // imposible hasta que alguien las descartara a mano.
  for (const adapter of allNetworks()) {
    if (!connectedIds.has(adapter.network)) {
      await removePending(accountId, vehicleId, adapter.network);
    }
  }

  const t = await getTranslations('SocialPost');
  const translate: Translator = (key, values) => t(key, values);

  let firstError: unknown = null;

  for (const network of connected) {
    const adapter = networkAdapter(network.network);
    if (!adapter) continue;
    try {
      await syncNetworkPost({
        admin,
        accountId,
        vehicleId,
        vehicle,
        account,
        network: adapter.network,
        limits: adapter.limits,
        t: translate,
      });
    } catch (err) {
      // Se registra y se sigue con la red siguiente. El primero se
      // guarda para propagarlo al final: el llamador tiene que poder
      // enterarse de que algo falló, pero no a costa de la otra red.
      console.error(
        `[social queue] falló el borrador de ${adapter.network} para ${vehicleId}:`,
        err instanceof Error ? err.message : err
      );
      firstError ??= err;
    }
  }

  if (firstError) throw firstError;
}

/**
 * El borrador de UNA red. Todo lo que acá se decide vale solo para esa
 * red: el recorte de fotos depende de su máximo, y el pendiente que
 * busca y escribe está acotado por `network`.
 */
async function syncNetworkPost(args: {
  admin: SupabaseClient;
  accountId: string;
  vehicleId: string;
  vehicle: VehicleRow;
  account: AccountForCaption;
  network: SocialNetwork;
  limits: NetworkLimits;
  t: Translator;
}): Promise<void> {
  const { admin, accountId, vehicleId, vehicle, account, network, limits, t } =
    args;

  const composed = composeVehiclePost({
    vehicle,
    account,
    images: vehicle.images,
    limits,
    t,
  });

  // Sin imágenes no hay nada que publicar. Si además había un pendiente
  // —le borraron las fotos después de encolarlo— se retira: sus URLs
  // congeladas apuntan a lo que ya no está, y ese pendiente solo puede
  // terminar en un fallo al publicar.
  if (!composed.ok) {
    console.warn(
      `[social queue] vehículo ${vehicleId} sin publicación en ${network}: ${composed.reason}`
    );
    await removePending(accountId, vehicleId, network);
    return;
  }

  const { data: existing, error: exErr } = await admin
    .from('social_posts')
    .select('id, edited_caption')
    .eq('account_id', accountId)
    .eq('vehicle_id', vehicleId)
    .eq('network', network)
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
    // las imágenes. Y se decide por publicación, no por vehículo: quien
    // editó el texto de una red no editó el de la otra.
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
    network,
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
 * Retira los pendientes de un vehículo, si los tenía.
 *
 * Sin `network` retira los de TODAS las redes, que es lo correcto
 * cuando el vehículo dejó de ser publicable: no lo es para una red sí y
 * para otra no. Con `network` retira solo esa, para los casos que sí
 * son de una red concreta —quedó desconectada, o sus fotos no alcanzan
 * para su formato—.
 *
 * Se BORRA en vez de marcarse como descartado: descartar es una
 * decisión que toma una persona, y registrar como tal algo que nadie
 * decidió le atribuiría al equipo una acción que no ocurrió. Es el
 * mismo criterio con que knowledge-sync borra el documento del KB en
 * lugar de dejar una lápida.
 *
 * Lo ya publicado no se toca: el sistema nunca borra de una red.
 */
async function removePending(
  accountId: string,
  vehicleId: string,
  network?: SocialNetwork
): Promise<void> {
  let query = supabaseAdmin()
    .from('social_posts')
    .delete()
    .eq('account_id', accountId)
    .eq('vehicle_id', vehicleId)
    .eq('status', 'pending');
  if (network) query = query.eq('network', network);

  const { error } = await query;
  if (error) throw error;
}

/**
 * Vuelve a armar los borradores pendientes contra la ficha actual, en
 * todas las redes.
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
 *
 * El texto es el mismo en todas las redes (decisión 6), así que se
 * calcula UNA VEZ por vehículo y se compara contra cada pendiente. Lo
 * que varía por red es qué se valida contra él, no cómo se arma.
 */
export async function refreshPendingCaptions(accountId: string): Promise<void> {
  const admin = supabaseAdmin();

  const { data: pending, error: pendErr } = await admin
    .from('social_posts')
    .select('id, vehicle_id, network, proposed_caption')
    .eq('account_id', accountId)
    .eq('status', 'pending')
    .is('edited_caption', null)
    .returns<
      {
        id: string;
        vehicle_id: string;
        network: string;
        proposed_caption: string;
      }[]
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
  const t = await getTranslations('SocialPost');

  // El texto de un vehículo no depende de la red, así que armarlo una
  // vez por vehículo evita repetir el trabajo cuando el mismo auto
  // tiene pendientes en las dos.
  const captions = new Map<string, string>();

  for (const post of pending) {
    const vehicle = byId.get(post.vehicle_id);
    // Un pendiente sin vehículo no se limpia acá: de eso se encarga
    // `syncVehiclePost`, y esta función solo reescribe texto.
    if (!vehicle) continue;

    let caption = captions.get(post.vehicle_id);
    if (caption === undefined) {
      caption = buildVehicleCaption({
        vehicle,
        account,
        t: (key, values) => t(key, values),
      });
      captions.set(post.vehicle_id, caption);
    }
    if (caption === post.proposed_caption) continue;

    const { error: upErr } = await admin
      .from('social_posts')
      .update({ proposed_caption: caption })
      .eq('account_id', accountId)
      .eq('id', post.id);
    if (upErr) throw upErr;
  }
}
