import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import {
  ASSIGNMENT_SETTINGS_ERROR_CODES as CODES,
  parseAssignmentSettingsInput,
  type AssignmentSettingsErrorCode,
} from '@/lib/assignment/settings'

/**
 * GET / PUT /api/assignment/settings   (owner/admin)
 *
 * La configuración del reparto automático de la cuenta (cambio
 * `sticky-weighted-assignment`):
 *
 *   - `weights`: asesores `agent` con su porcentaje de asignaciones
 *     automáticas de leads nuevos (P3). Suma exactamente 100.
 *   - `stale_assign_after_hours`: X HORAS sin asesor tras las que el job
 *     asigna la conversación (P4), de 1 a 720. `null` = desactivado. Solo
 *     cuentan las que quedaron sin asesor después de activar la regla.
 *   - `bot_reactivate_after_days`: N días de silencio tras los que un
 *     mensaje del cliente reactiva la IA pausada (el lead que vuelve).
 *     7 por defecto, `null` = desactivado.
 *   - `trade_in_agent_id`: quien recibe SIEMPRE los traspasos de la IA por
 *     venta o permuta (cambio `asesor-ventas-y-permutas`, migración 543).
 *     Cualquier miembro vigente —owner, admin o agent—, por eso GET
 *     devuelve también `members`. `null` = desactivado.
 *
 * Contrato completo —formas, validaciones y códigos de error con su clave
 * i18n— en `openspec/changes/sticky-weighted-assignment/design.md` →
 * "API para el frontend".
 *
 * Todo va con la SESIÓN del admin: la RLS de la 534 acota a owner/admin,
 * y los porcentajes se escriben por la RPC `set_assignment_weights`, que
 * vuelve a comprobar el rol adentro y reemplaza la lista en una sola
 * transacción (PostgREST no ofrece transacciones de varias sentencias).
 */

const DEFAULT_REACTIVATE_DAYS = 7

/** Los roles que `is_active_member` (535) considera vigentes. */
const MIEMBROS_VIGENTES = ['owner', 'admin', 'agent']

interface ProfileRow {
  user_id: string
  full_name: string | null
  account_role: string
}

function bad(code: AssignmentSettingsErrorCode, error: string, status = 400) {
  return NextResponse.json({ error, code }, { status })
}

/** La respuesta de GET (y de un PUT correcto). */
async function loadSettings(supabase: SupabaseClient, accountId: string) {
  const [settingsRes, weightsRes, profilesRes] = await Promise.all([
    supabase
      .from('assignment_settings')
      .select(
        'stale_assign_after_hours, stale_assign_enabled_at, bot_reactivate_after_days, weights_updated_at, trade_in_agent_id',
      )
      .eq('account_id', accountId)
      .maybeSingle(),
    supabase.from('assignment_weights').select('user_id, percent').eq('account_id', accountId),
    supabase
      .from('profiles')
      .select('user_id, full_name, account_role')
      .eq('account_id', accountId)
      .order('created_at', { ascending: true }),
  ])
  const error = settingsRes.error ?? weightsRes.error ?? profilesRes.error
  if (error) throw error

  const perfiles = (profilesRes.data ?? []) as ProfileRow[]
  const porUsuario = new Map(perfiles.map((p) => [p.user_id, p]))
  const s = settingsRes.data as {
    stale_assign_after_hours: number | null
    stale_assign_enabled_at: string | null
    bot_reactivate_after_days: number | null
    weights_updated_at: string | null
    trade_in_agent_id: string | null
  } | null

  return {
    stale_assign_after_hours: s?.stale_assign_after_hours ?? null,
    stale_assign_enabled_at: s?.stale_assign_enabled_at ?? null,
    // Sin fila rige el valor por defecto de la base (7), igual que en
    // `reactivate_ai_for_returning_lead`.
    bot_reactivate_after_days: s ? s.bot_reactivate_after_days : DEFAULT_REACTIVATE_DAYS,
    weights_updated_at: s?.weights_updated_at ?? null,
    trade_in_agent_id: s?.trade_in_agent_id ?? null,
    weights: ((weightsRes.data ?? []) as { user_id: string; percent: number }[])
      .map((w) => {
        const p = porUsuario.get(w.user_id)
        return {
          user_id: w.user_id,
          full_name: p?.full_name ?? '',
          percent: w.percent,
          // Quien ya no es agent se ignora al repartir; se muestra para
          // que el admin lo corrija.
          eligible: p?.account_role === 'agent',
        }
      })
      .sort((a, b) => b.percent - a.percent),
    agents: perfiles
      .filter((p) => p.account_role === 'agent')
      .map((p) => ({ user_id: p.user_id, full_name: p.full_name ?? '' })),
    // Los que pueden ser asesor de ventas y permutas: no solo los agent.
    members: perfiles
      .filter((p) => MIEMBROS_VIGENTES.includes(p.account_role))
      .map((p) => ({ user_id: p.user_id, full_name: p.full_name ?? '', role: p.account_role })),
  }
}

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    return NextResponse.json(await loadSettings(supabase, accountId))
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`assignment-settings:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)

    const { data: miembros, error: agentesErr } = await supabase
      .from('profiles')
      .select('user_id, account_role')
      .eq('account_id', accountId)
      .in('account_role', MIEMBROS_VIGENTES)
    if (agentesErr) {
      console.error('[assignment/settings] no se pudieron leer los asesores:', agentesErr)
      return bad(CODES.saveFailed, 'Failed to load agents', 500)
    }

    // Una sola lectura para las dos validaciones: los porcentajes solo
    // admiten `agent`; el asesor de ventas y permutas, cualquier vigente.
    const vigentes = (miembros ?? []) as { user_id: string; account_role: string }[]
    const parsed = parseAssignmentSettingsInput(body, {
      agentIds: vigentes.filter((m) => m.account_role === 'agent').map((m) => m.user_id),
      memberIds: vigentes.map((m) => m.user_id),
    })
    if (!parsed.ok) return bad(parsed.code, `Invalid assignment settings: ${parsed.code}`)
    const input = parsed.value

    // Las columnas de `assignment_settings` primero (plazos y asesor de
    // ventas y permutas): son un upsert simple. `stale_assign_enabled_at`
    // no se manda nunca; lo fija el trigger de la 534 al activar.
    const dias: Record<string, unknown> = {}
    if ('stale_assign_after_hours' in input) {
      dias.stale_assign_after_hours = input.stale_assign_after_hours
    }
    if ('bot_reactivate_after_days' in input) {
      dias.bot_reactivate_after_days = input.bot_reactivate_after_days
    }
    if ('trade_in_agent_id' in input) {
      dias.trade_in_agent_id = input.trade_in_agent_id
    }
    if (Object.keys(dias).length > 0) {
      const { error } = await supabase
        .from('assignment_settings')
        .upsert({ account_id: accountId, ...dias }, { onConflict: 'account_id' })
      if (error) {
        console.error('[assignment/settings] no se pudo guardar la configuración:', error)
        return bad(CODES.saveFailed, 'Failed to save settings', 500)
      }
    }

    if (input.weights) {
      const { error } = await supabase.rpc('set_assignment_weights', {
        p_account_id: accountId,
        p_weights: input.weights,
      })
      if (error) {
        // Carreras que la validación previa no pudo ver: alguien cambió el
        // rol de un asesor entre medio, o la suma se rompió en la base.
        if (error.message?.includes('weights_not_agent')) {
          return bad(CODES.weightsNotAgent, 'An assignee is no longer an agent')
        }
        if (error.code === '23514') return bad(CODES.weightsSum, 'Percentages must add up to 100')
        console.error('[assignment/settings] no se pudieron guardar los porcentajes:', error)
        return bad(CODES.saveFailed, 'Failed to save weights', 500)
      }
    }

    return NextResponse.json(await loadSettings(supabase, accountId))
  } catch (err) {
    return toErrorResponse(err)
  }
}
