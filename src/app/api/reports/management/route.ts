import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  MANAGEMENT_REPORT_MAX_ROWS,
  managementReportFilename,
  parseManagementFilters,
  UNASSIGNED_LABEL,
  type ManagementReportRow,
} from '@/lib/reports/management'
import { buildManagementWorkbook } from '@/lib/reports/management-workbook'

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * GET /api/reports/management?from=AAAA-MM-DD&to=AAAA-MM-DD&agent=…  (admin+)
 *
 * Informe de gestión de asesores en Excel: una fila por cliente que llegó
 * en el rango, con su asesor, su negocio, sus etiquetas y el resumen de
 * gestión (cambio informe-gestion-asesores). `agent` vacío = todos,
 * `unassigned` = sin asesor, o el user_id de un miembro.
 *
 * La consulta es `management_report` (migración 552), SECURITY INVOKER:
 * corre con la sesión de quien pide, así que la RLS también limita.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const now = new Date()
    const parsed = parseManagementFilters(new URL(request.url).searchParams, now)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }
    const { filters } = parsed

    // Un solo viaje para el nombre de quien genera y, si se filtra por
    // asesor, para comprobar que sea miembro de esta cuenta.
    const ids = filters.agent && filters.agent !== 'unassigned'
      ? [userId, filters.agent]
      : [userId]
    const { data: people, error: peopleError } = await supabase
      .from('profiles')
      .select('user_id, full_name')
      .eq('account_id', accountId)
      .in('user_id', ids)
    if (peopleError) {
      console.error('[reports/management] profiles:', peopleError.message)
      return NextResponse.json(
        { error: 'No se pudo generar el informe.' },
        { status: 500 },
      )
    }
    const nameOf = (id: string) =>
      people?.find((p) => p.user_id === id)?.full_name as string | undefined

    let agentLabel = 'Todos'
    if (filters.agent === 'unassigned') {
      agentLabel = UNASSIGNED_LABEL
    } else if (filters.agent) {
      const name = nameOf(filters.agent)
      if (name === undefined) {
        return NextResponse.json(
          { error: 'El asesor elegido no es miembro de esta cuenta.' },
          { status: 400 },
        )
      }
      agentLabel = name
    }

    // Se pide una fila más que el máximo para saber si hay que avisar.
    const { data, error } = await supabase.rpc('management_report', {
      p_account_id: accountId,
      p_from: filters.from.toISOString(),
      p_to: filters.toExclusive.toISOString(),
      p_agent: filters.agent,
      p_limit: MANAGEMENT_REPORT_MAX_ROWS + 1,
    })
    if (error) {
      console.error('[reports/management] rpc:', error.message)
      return NextResponse.json(
        { error: 'No se pudo generar el informe.' },
        { status: 500 },
      )
    }

    const rows = (data ?? []) as ManagementReportRow[]
    const buffer = await buildManagementWorkbook(rows, {
      generatedAt: now,
      generatedBy: nameOf(userId) ?? '—',
      fromKey: filters.fromKey,
      toKey: filters.toKey,
      agentLabel,
      truncated: rows.length > MANAGEMENT_REPORT_MAX_ROWS,
    })

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': XLSX_MIME,
        'Content-Disposition': `attachment; filename="${managementReportFilename(now)}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
