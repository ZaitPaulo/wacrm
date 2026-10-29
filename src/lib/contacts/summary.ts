// ============================================================
// Resumen de la hoja de vida — lo que devuelve
// `GET /api/contacts/[id]/summary` (`get_contact_summary`, 555 y 558).
// ============================================================

import type { MessageChannel } from '@/lib/contacts/channel-identity'
import type { InteractionKind, InteractionOutcome } from '@/lib/contacts/interactions'
import type { VehicleRef } from '@/lib/contacts/timeline'

export interface ContactSummary {
  client_since: string | null
  agents: {
    conversation_id: string
    channel: MessageChannel
    agent_id: string | null
    agent_name: string | null
  }[]
  appointments_total: number
  appointments_attended: number
  vehicles_bought: number
  vehicles_purchased: number
  vehicles_traded_in: number
  consignments: number
  open_deals: number
  /** Quien mira puede editar el contacto (agent+ y `contact_visible`). */
  can_edit: boolean

  // "Cómo va" (558). Cada una es null cuando no aplica.
  /** La conversación que espera respuesta hace más tiempo. */
  awaiting_reply: { conversation_id: string; channel: MessageChannel; since: string } | null
  /** La próxima cita agendada o confirmada que todavía no termina. */
  next_appointment: {
    id: string
    starts_at: string
    purpose: string
    status: 'scheduled' | 'confirmed'
    assigned_agent_id: string
    vehicle: VehicleRef | null
  } | null
  /** El negocio abierto más reciente; `stage_index` va de 1 a `stage_count`. */
  open_deal: {
    id: string
    title: string
    value: number | string
    currency: string | null
    stage_name: string
    stage_index: number
    stage_count: number
  } | null
  /** Lo más reciente entre la última interacción y el último mensaje. */
  last_contact:
    | {
        source: 'interaction'
        occurred_at: string
        interaction_kind: InteractionKind
        outcome: InteractionOutcome | null
      }
    | { source: 'message'; occurred_at: string; interaction_kind?: undefined; outcome?: undefined }
    | null
}
