/**
 * Una pasada del job de traspasos sin atender (bot-fase-2-traspaso-sin-perdidas).
 *
 * Lee las conversaciones en espera del asesor, decide con `dueActions`
 * qué toca y deja las notificaciones; el push sale solo (trigger de la
 * 542). Cada aviso se reclama antes con un UPDATE condicional
 * (`... WHERE handoff_reminded_at IS NULL`): si dos pasadas se cruzan,
 * solo la que se quedó con la fila avisa.
 *
 * No reasigna nunca (decisión del Director, 2026-09-29).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { primerNombre } from '@/lib/ai/pick-agent'
import { loadCatalogSection } from '@/lib/i18n/server-catalog'
import { leerHorarioCuenta } from '@/lib/outbound/gate'
import type { ConfiguracionHorario } from '@/lib/outbound/business-hours'
import { dueActions } from './sla'

/** Tope por pasada: hay pocas conversaciones en espera a la vez. */
const LOTE = 200

/** Los plazos por defecto, si la cuenta no tiene fila de ajustes. */
const DEFAULT_REMIND_MINUTES = 15
const DEFAULT_ESCALATE_MINUTES = 45

interface WaitingRow {
  id: string
  account_id: string
  contact_id: string | null
  assigned_agent_id: string | null
  ai_waiting_agent_since: string
  handoff_reminded_at: string | null
  handoff_escalated_at: string | null
  contact: { name: string | null } | null
}

interface AccountRules {
  config: ConfiguracionHorario | null
  remindMinutes: number | null
  escalateMinutes: number | null
}

export interface SlaJobResult {
  checked: number
  reminded: number
  escalated: number
}

type Texts = Record<string, string>

const FALLBACK_TEXTS: Texts = {
  reminderTitle: 'Cliente esperando: {client}',
  reminderBody: 'Lleva {minutes} min esperando tu primer mensaje desde el traspaso del bot.',
  unattendedTitle: '{agent} no ha atendido a {client}',
  unattendedTitleNoAgent: 'Traspaso sin asesor: {client}',
  unattendedBody: 'Lleva {minutes} min esperando desde el traspaso del bot.',
  unknownClient: 'un cliente',
}

async function loadTexts(): Promise<Texts> {
  const section = await loadCatalogSection('HandoffSla')
  const texts: Texts = { ...FALLBACK_TEXTS }
  for (const key of Object.keys(FALLBACK_TEXTS)) {
    const value = section?.[key]
    if (typeof value === 'string' && value.trim()) texts[key] = value
  }
  return texts
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m)
}

async function loadRules(db: SupabaseClient, accountId: string): Promise<AccountRules> {
  const [{ data }, config] = await Promise.all([
    db
      .from('assignment_settings')
      .select('handoff_remind_after_minutes, handoff_escalate_after_minutes')
      .eq('account_id', accountId)
      .maybeSingle<{
        handoff_remind_after_minutes: number | null
        handoff_escalate_after_minutes: number | null
      }>(),
    leerHorarioCuenta(db, accountId),
  ])
  return {
    config,
    // Sin fila de ajustes valen los plazos por defecto; con fila, lo que
    // diga (NULL apaga).
    remindMinutes: data ? data.handoff_remind_after_minutes : DEFAULT_REMIND_MINUTES,
    escalateMinutes: data ? data.handoff_escalate_after_minutes : DEFAULT_ESCALATE_MINUTES,
  }
}

/** Reclama el aviso: true si esta pasada se quedó con la fila. */
async function claim(
  db: SupabaseClient,
  conversationId: string,
  column: 'handoff_reminded_at' | 'handoff_escalated_at',
  now: Date,
): Promise<boolean> {
  const { data, error } = await db
    .from('conversations')
    .update({ [column]: now.toISOString() })
    .eq('id', conversationId)
    .is(column, null)
    .select('id')
  if (error) {
    console.error(`[handoff/sla] no se pudo reclamar ${column} de ${conversationId}:`, error)
    return false
  }
  return Array.isArray(data) && data.length > 0
}

export async function runHandoffSlaJob(
  db: SupabaseClient,
  now: Date = new Date(),
): Promise<SlaJobResult> {
  const { data, error } = await db
    .from('conversations')
    .select(
      'id, account_id, contact_id, assigned_agent_id, ai_waiting_agent_since, handoff_reminded_at, handoff_escalated_at, contact:contacts(name)',
    )
    .eq('ai_autoreply_disabled', true)
    .not('ai_waiting_agent_since', 'is', null)
    .is('handoff_escalated_at', null)
    .limit(LOTE)
  if (error) throw new Error(`no se pudieron leer las conversaciones en espera: ${error.message}`)

  const rows = (data ?? []) as unknown as WaitingRow[]
  const result: SlaJobResult = { checked: rows.length, reminded: 0, escalated: 0 }
  if (rows.length === 0) return result

  const texts = await loadTexts()
  const rulesByAccount = new Map<string, AccountRules>()
  const agentNames = new Map<string, string | null>()

  for (const row of rows) {
    let rules = rulesByAccount.get(row.account_id)
    if (!rules) {
      rules = await loadRules(db, row.account_id)
      rulesByAccount.set(row.account_id, rules)
    }

    const due = dueActions({
      since: new Date(row.ai_waiting_agent_since),
      now,
      config: rules.config,
      remindMinutes: rules.remindMinutes,
      escalateMinutes: rules.escalateMinutes,
      remindedAt: row.handoff_reminded_at ? new Date(row.handoff_reminded_at) : null,
      escalatedAt: null,
      hasAgent: !!row.assigned_agent_id,
    })
    if (!due.remind && !due.escalate) continue

    const client = row.contact?.name?.trim() || texts.unknownClient
    const minutes = String(due.waitedMinutes)

    if (due.remind && row.assigned_agent_id && (await claim(db, row.id, 'handoff_reminded_at', now))) {
      const { error: insErr } = await db.from('notifications').insert({
        account_id: row.account_id,
        user_id: row.assigned_agent_id,
        type: 'handoff_reminder',
        conversation_id: row.id,
        contact_id: row.contact_id,
        title: fill(texts.reminderTitle, { client }),
        body: fill(texts.reminderBody, { minutes }),
      })
      if (insErr) console.error('[handoff/sla] recordatorio no creado:', insErr)
      else result.reminded++
    }

    if (due.escalate && (await claim(db, row.id, 'handoff_escalated_at', now))) {
      let agent: string | null = null
      if (row.assigned_agent_id) {
        if (!agentNames.has(row.assigned_agent_id)) {
          const { data: p } = await db
            .from('profiles')
            .select('full_name')
            .eq('user_id', row.assigned_agent_id)
            .maybeSingle<{ full_name: string | null }>()
          agentNames.set(row.assigned_agent_id, primerNombre(p?.full_name ?? null))
        }
        agent = agentNames.get(row.assigned_agent_id) ?? null
      }

      const { data: admins } = await db
        .from('profiles')
        .select('user_id')
        .eq('account_id', row.account_id)
        .in('account_role', ['owner', 'admin'])
      const recipients = ((admins ?? []) as { user_id: string }[])
        .map((a) => a.user_id)
        .filter((id) => id !== row.assigned_agent_id)

      if (recipients.length > 0) {
        const title = agent
          ? fill(texts.unattendedTitle, { agent, client })
          : fill(texts.unattendedTitleNoAgent, { client })
        const body = fill(texts.unattendedBody, { minutes })
        const { error: insErr } = await db.from('notifications').insert(
          recipients.map((user_id) => ({
            account_id: row.account_id,
            user_id,
            type: 'handoff_unattended',
            conversation_id: row.id,
            contact_id: row.contact_id,
            title,
            body,
          })),
        )
        if (insErr) console.error('[handoff/sla] aviso a administradores no creado:', insErr)
        else result.escalated++
      }
    }
  }

  return result
}
