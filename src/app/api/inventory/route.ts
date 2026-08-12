import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { buildVehiclePayload } from '@/lib/inventory/payload'
import { persistAcquisition } from '@/lib/inventory/acquisitions'
import { syncVehicleKnowledge } from '@/lib/inventory/knowledge-sync'

// Lista nominal a propósito (nunca `*`): mantiene bajo control qué sale
// hacia el cliente cuando se agregan columnas.
//
// El precio a pagar por esa decisión es que OLVIDAR una columna aquí no
// falla: el formulario de /inventory carga desde esta ruta, inicializa
// en vacío lo que no llega y al guardar lo manda como null. Así se
// perdían en cada edición las seis especificaciones de la migración 504
// —transmisión, combustible, carrocería, color, condición y puertas—,
// que nunca se agregaron a esta lista. Al sumar columnas nuevas hay que
// añadirlas aquí en el mismo cambio.
const VEHICLE_COLUMNS =
  'id, brand, model, year, license_plate, vin, price, mileage, status, features, images, internal_notes, kb_document_id, created_at, updated_at, sold_price, sold_at, sold_to_contact_id, public_ref, transmission, fuel_type, body_type, color, condition, doors, engine_displacement, plate_city, warranty_price, soat_expires_at, tecnomecanica_expires_at, has_lien, on_display, accepts_trade_in'

// El costo de compra se pide como tabla embebida, no como columna. Para
// un 'agent' o un 'viewer' la RLS de vehicle_acquisitions (migración 508)
// devuelve vacío y el campo llega como null — sin error y sin filtrar
// que el dato existe. Ese silencio ES el comportamiento correcto.
const VEHICLE_COLUMNS_WITH_ACQUISITION = `${VEHICLE_COLUMNS}, acquisition:vehicle_acquisitions(purchase_cost, purchase_date)`

/**
 * GET /api/inventory
 *
 * Lista los vehículos de la cuenta (cualquier miembro).
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('inventory_vehicles')
      .select(VEHICLE_COLUMNS_WITH_ACQUISITION)
      .eq('account_id', accountId)
      .order('updated_at', { ascending: false })
    if (error) {
      console.error('[inventory GET] error:', error)
      return NextResponse.json(
        { error: 'No se pudo cargar el inventario' },
        { status: 500 },
      )
    }

    // PostgREST puede devolver la tabla embebida como objeto o como
    // arreglo de un elemento según cómo infiera la cardinalidad. Se
    // normaliza a "objeto o null" para que el cliente no tenga que
    // adivinar la forma.
    const vehicles = (data ?? []).map((row) => {
      const { acquisition, ...vehicle } = row as Record<string, unknown>
      const first = Array.isArray(acquisition) ? acquisition[0] : acquisition
      return { ...vehicle, acquisition: first ?? null }
    })

    return NextResponse.json({ vehicles })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/inventory  (agent+)
 *
 * Crea un vehículo y lo sincroniza con el knowledge base del bot. Si el
 * sync del KB falla, el vehículo queda guardado igual y se devuelve un
 * warning (mismo criterio que la ruta de ingest de ai/knowledge).
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId, role } = await requireRole('agent')
    const limit = checkRateLimit(`inventory:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const parsed = buildVehiclePayload(body, { partial: false })
    if ('error' in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    // `public_ref` no se manda: lo genera el DEFAULT de la migración 508.
    const { data: created, error } = await supabase
      .from('inventory_vehicles')
      .insert({ ...parsed.value, account_id: accountId })
      .select('id')
      .single()
    if (error || !created) {
      console.error('[inventory POST] insert error:', error)
      if (error?.code === '23505') {
        return NextResponse.json(
          { error: 'Ya existe un vehículo con esa placa o VIN' },
          { status: 409 },
        )
      }
      return NextResponse.json(
        { error: 'No se pudo crear el vehículo' },
        { status: 500 },
      )
    }

    // El costo va después del vehículo porque necesita su id. Si falla,
    // se responde el error pero el vehículo ya quedó creado: es
    // preferible a perder la carga entera por un costo mal tecleado.
    const acq = await persistAcquisition(supabase, accountId, created.id, role, body)
    if (acq.error) {
      return NextResponse.json(
        { error: acq.error, id: created.id },
        { status: acq.status ?? 500 },
      )
    }

    let warning: string | undefined
    try {
      await syncVehicleKnowledge(accountId, created.id)
    } catch (err) {
      console.error('[inventory POST] KB sync error:', err)
      warning =
        'Vehículo guardado, pero no se pudo sincronizar con el asistente de IA. Vuelve a guardar para reintentar.'
    }

    return NextResponse.json({
      success: true,
      id: created.id,
      ...(warning ? { warning } : {}),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
