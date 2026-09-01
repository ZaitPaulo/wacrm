import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { connectedNetworks, networkAdapter } from '@/lib/social/networks';
import type { NetworkLimits } from '@/lib/social/limits';
import { refreshPendingCaptions } from '@/lib/social/queue';

/**
 * GET /api/social/queue  (admin+)
 *
 * La cola de TODAS las redes: pendientes a revisar, más lo que hace
 * falta para decidir sobre cada una —la ficha del vehículo, sus fotos,
 * a qué red va y si ese vehículo ya se publicó antes en esa red— y el
 * margen que queda del tope donde la red informe uno.
 */

// El vehículo se pide embebido para armar la vista previa sin una
// segunda vuelta. Ni notas internas ni costo: esta pantalla decide qué
// sale a un feed público.
const QUEUE_COLUMNS = `
  id, vehicle_id, network, status, proposed_caption, edited_caption, image_urls,
  external_post_id, published_at, failure_kind, failure_reason, created_at,
  vehicle:inventory_vehicles(id, brand, model, year, price, status)
`;

interface QueueRow {
  id: string;
  vehicle_id: string;
  network: string;
  status: string;
  published_at: string | null;
}

/** El estado de una red, tal como lo necesita la pantalla. */
interface NetworkState {
  network: string;
  /** A dónde se publica: `@usuario`, o el nombre de la página. */
  displayName: string | null;
  /**
   * `true` si esta red informa un tope por periodo.
   *
   * Separa los dos motivos por los que `quota` puede venir en null y
   * que NO significan lo mismo: la red no tiene tope (Facebook, y no
   * pasa nada), o lo tiene y no se pudo leer (y entonces no se puede
   * aprobar, porque publicar a ciegas gastaría el intento).
   */
  reportsQuota: boolean;
  quota: {
    used: number;
    total: number;
    remaining: number;
    durationSeconds: number;
  } | null;
  /**
   * Los límites de esta red, para que la pantalla valide contra ellos.
   *
   * Viajan en la respuesta en vez de importarse en el cliente porque
   * son la misma fuente que usa el servidor al guardar: si el editor
   * midiera contra otros números, avisaría de un exceso que no hay o
   * dejaría pasar uno que el guardado va a rechazar.
   */
  limits: NetworkLimits;
}

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin');

    // Los borradores se rearman contra la ficha actual ANTES de
    // leerlos: el texto propuesto se congela al encolar, así que un
    // cambio de plantilla o de los datos del negocio no llegaría solo.
    // Que falle no puede tumbar la pantalla — se ve la cola con el
    // texto que había, que es peor que refrescado pero mucho mejor que
    // nada.
    try {
      await refreshPendingCaptions(accountId);
    } catch (err) {
      console.error('[social/queue GET] refresh error:', err);
    }

    const { data: posts, error } = await supabase
      .from('social_posts')
      .select(QUEUE_COLUMNS)
      .eq('account_id', accountId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[social/queue GET] error:', error);
      return NextResponse.json(
        { error: 'No se pudo cargar la cola' },
        { status: 500 }
      );
    }

    const rows = (posts ?? []) as unknown as QueueRow[];

    // El antecedente de publicación NO se guarda en la fila: se deriva
    // de las publicaciones anteriores del mismo vehículo (decisión 11).
    // Así nunca puede contradecirlas.
    //
    // Es POR VEHÍCULO Y RED: republicar donde ya salió no es lo mismo
    // que estrenarlo en la otra red, y quien revisa necesita ver esa
    // diferencia para decidir.
    const publishedByVehicleNetwork = new Map<string, string>();
    for (const row of rows) {
      if (row.status !== 'published' || !row.published_at) continue;
      const key = `${row.vehicle_id}:${row.network}`;
      const previous = publishedByVehicleNetwork.get(key);
      if (!previous || row.published_at > previous) {
        publishedByVehicleNetwork.set(key, row.published_at);
      }
    }

    const withHistory = rows.map((row) => ({
      ...row,
      previously_published_at:
        row.status === 'pending'
          ? (publishedByVehicleNetwork.get(
              `${row.vehicle_id}:${row.network}`
            ) ?? null)
          : null,
    }));

    // El margen se le pregunta a cada red, no se calcula (decisión 6), y
    // solo a las que lo informan (decisión 8). Que falle no puede tumbar
    // la pantalla: la cola se ve igual y el margen aparece como
    // desconocido, que es lo que después impide aprobar.
    const networks: NetworkState[] = [];
    for (const connected of await connectedNetworks(supabase, accountId)) {
      const adapter = networkAdapter(connected.network);
      const state: NetworkState = {
        network: connected.network,
        displayName: connected.displayName,
        reportsQuota: connected.quota !== undefined,
        quota: null,
        limits: adapter!.limits,
      };
      if (connected.quota) {
        try {
          state.quota = await connected.quota();
        } catch (err) {
          console.error(
            `[social/queue GET] quota error (${connected.network}):`,
            err
          );
        }
      }
      networks.push(state);
    }

    return NextResponse.json({ posts: withHistory, networks });
  } catch (err) {
    return toErrorResponse(err);
  }
}
