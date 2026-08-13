import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { getPublishingLimit } from '@/lib/instagram/api';
import { loadInstagramConfig } from '@/lib/instagram/config';

/**
 * GET /api/instagram/queue  (admin+)
 *
 * La cola: pendientes a revisar, más lo que hace falta para decidir
 * sobre cada una —la ficha del vehículo, sus fotos, y si ese vehículo
 * ya se publicó antes— y el margen que queda del tope.
 */

// El vehículo se pide embebido para armar la vista previa sin una
// segunda vuelta. Ni notas internas ni costo: esta pantalla decide qué
// sale a un feed público.
const QUEUE_COLUMNS = `
  id, vehicle_id, status, proposed_caption, edited_caption, image_urls,
  external_post_id, published_at, failure_kind, failure_reason, created_at,
  vehicle:inventory_vehicles(id, brand, model, year, price, status)
`;

interface QueueRow {
  id: string;
  vehicle_id: string;
  status: string;
  published_at: string | null;
}

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin');

    const { data: posts, error } = await supabase
      .from('social_posts')
      .select(QUEUE_COLUMNS)
      .eq('account_id', accountId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[instagram/queue GET] error:', error);
      return NextResponse.json(
        { error: 'No se pudo cargar la cola' },
        { status: 500 }
      );
    }

    const rows = (posts ?? []) as unknown as QueueRow[];

    // El antecedente de publicación NO se guarda en la fila: se deriva
    // de las publicaciones anteriores del mismo vehículo (decisión 11).
    // Así nunca puede contradecirlas.
    const publishedByVehicle = new Map<string, string>();
    for (const row of rows) {
      if (row.status !== 'published' || !row.published_at) continue;
      const previous = publishedByVehicle.get(row.vehicle_id);
      if (!previous || row.published_at > previous) {
        publishedByVehicle.set(row.vehicle_id, row.published_at);
      }
    }

    const withHistory = rows.map((row) => ({
      ...row,
      previously_published_at:
        row.status === 'pending'
          ? (publishedByVehicle.get(row.vehicle_id) ?? null)
          : null,
    }));

    // El margen se le pregunta a Instagram, no se calcula (decisión 6).
    // Que falle no puede tumbar la pantalla: la cola se ve igual y el
    // margen aparece como desconocido, que es lo que después impide
    // aprobar.
    let quota: {
      used: number;
      total: number;
      remaining: number;
      durationSeconds: number;
    } | null = null;
    let connected = false;

    const config = await loadInstagramConfig(supabase, accountId);
    if (config) {
      connected = true;
      try {
        quota = await getPublishingLimit({
          igUserId: config.igUserId,
          accessToken: config.accessToken,
        });
      } catch (err) {
        console.error('[instagram/queue GET] quota error:', err);
      }
    }

    return NextResponse.json({ posts: withHistory, quota, connected });
  } catch (err) {
    return toErrorResponse(err);
  }
}
