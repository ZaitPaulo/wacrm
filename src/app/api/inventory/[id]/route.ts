import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { buildVehiclePayload } from '@/lib/inventory/payload'
import {
  syncVehicleKnowledge,
  deleteVehicleKnowledge,
} from '@/lib/inventory/knowledge-sync'

type Params = { params: Promise<{ id: string }> }

/**
 * PATCH /api/inventory/[id]  (agent+)
 *
 * Actualiza los campos enviados y re-sincroniza con el knowledge base
 * (el cambio de estado a/desde 'available' agrega o quita el vehículo
 * del KB). El sync es best-effort: si falla, la edición persiste y se
 * devuelve un warning.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    const limit = checkRateLimit(`inventory:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { id } = await params
    const body = await request.json().catch(() => null)
    const parsed = buildVehiclePayload(body, { partial: true })
    if ('error' in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }
    if (Object.keys(parsed.value).length === 0) {
      return NextResponse.json({ error: 'Nada que actualizar' }, { status: 400 })
    }

    const { data: updated, error } = await supabase
      .from('inventory_vehicles')
      .update(parsed.value)
      .eq('account_id', accountId)
      .eq('id', id)
      .select('id')
      .maybeSingle()
    if (error) {
      console.error('[inventory PATCH] error:', error)
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Ya existe un vehículo con esa placa o VIN' },
          { status: 409 },
        )
      }
      return NextResponse.json(
        { error: 'No se pudo actualizar el vehículo' },
        { status: 500 },
      )
    }
    if (!updated) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

    let warning: string | undefined
    try {
      await syncVehicleKnowledge(accountId, id)
    } catch (err) {
      console.error('[inventory PATCH] KB sync error:', err)
      warning =
        'Cambios guardados, pero no se pudo sincronizar con el asistente de IA. Vuelve a guardar para reintentar.'
    }

    return NextResponse.json({ success: true, ...(warning ? { warning } : {}) })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/inventory/[id]  (agent+)
 *
 * Elimina el vehículo y su documento del KB (si tenía uno).
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { id } = await params

    const { data: existing } = await supabase
      .from('inventory_vehicles')
      .select('kb_document_id')
      .eq('account_id', accountId)
      .eq('id', id)
      .maybeSingle()

    const { error } = await supabase
      .from('inventory_vehicles')
      .delete()
      .eq('account_id', accountId)
      .eq('id', id)
    if (error) {
      console.error('[inventory DELETE] error:', error)
      return NextResponse.json(
        { error: 'No se pudo eliminar el vehículo' },
        { status: 500 },
      )
    }

    try {
      await deleteVehicleKnowledge(accountId, existing?.kb_document_id ?? null)
    } catch (err) {
      console.error('[inventory DELETE] KB cleanup error:', err)
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
