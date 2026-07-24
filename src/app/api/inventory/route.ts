import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { buildVehiclePayload } from '@/lib/inventory/payload'
import { syncVehicleKnowledge } from '@/lib/inventory/knowledge-sync'

const VEHICLE_COLUMNS =
  'id, brand, model, year, license_plate, vin, price, mileage, status, features, images, internal_notes, kb_document_id, created_at, updated_at'

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
      .select(VEHICLE_COLUMNS)
      .eq('account_id', accountId)
      .order('updated_at', { ascending: false })
    if (error) {
      console.error('[inventory GET] error:', error)
      return NextResponse.json(
        { error: 'No se pudo cargar el inventario' },
        { status: 500 },
      )
    }
    return NextResponse.json({ vehicles: data ?? [] })
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
    const { supabase, accountId, userId } = await requireRole('agent')
    const limit = checkRateLimit(`inventory:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const parsed = buildVehiclePayload(body, { partial: false })
    if ('error' in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

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
