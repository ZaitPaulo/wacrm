/** Lo que hace falta de una conversación para saber quién atiende al contacto. */
export interface ConversationAssignment {
  contact_id: string
  assigned_agent_id: string | null
  last_message_at: string | null
}

export interface ContactAssignees {
  /** El contacto tiene al menos una conversación. */
  hasConversation: boolean
  /** Asesores de sus conversaciones, sin repetir; primero el de la más
   *  reciente. Vacío cuando ninguna tiene asesor. */
  agentIds: string[]
}

/**
 * Quién atiende a cada contacto, para la columna "Asesor" de Contactos.
 *
 * La asignación vive en la conversación, no en el contacto, y un contacto
 * puede tener una por canal: por eso se juntan. Un contacto sin
 * conversaciones no trae entrada.
 */
export function assigneesByContact(
  conversations: readonly ConversationAssignment[],
): Map<string, ContactAssignees> {
  const sorted = [...conversations].sort((a, b) =>
    (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''),
  )

  const out = new Map<string, ContactAssignees>()
  for (const c of sorted) {
    const entry = out.get(c.contact_id) ?? { hasConversation: true, agentIds: [] }
    if (c.assigned_agent_id && !entry.agentIds.includes(c.assigned_agent_id)) {
      entry.agentIds.push(c.assigned_agent_id)
    }
    out.set(c.contact_id, entry)
  }
  return out
}
