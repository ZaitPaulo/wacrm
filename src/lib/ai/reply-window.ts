import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Time-window queries for auto-reply.
//
// Both answer the same shape of question — "did anything happen in this
// conversation after the message that triggered us?" — which is what
// decides whether the LLM should still speak.
// ============================================================

/** The inbound message a dispatch is reacting to. */
export interface InboundRef {
  id: string
  /** ISO timestamp of the row, as persisted. */
  createdAt: string
}

/** Promise-based sleep. Its own export so tests can stub the wait. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * PostgREST filter for "strictly after `inbound`".
 *
 * WhatsApp timestamps carry second precision, so two messages from the
 * same burst routinely share `created_at`. Comparing on the timestamp
 * alone would let both dispatches consider themselves the newest — or
 * neither — so ties break on the id. That gives a total order, and
 * exactly one winner.
 */
function afterFilter(inbound: InboundRef): string {
  return `created_at.gt.${inbound.createdAt},and(created_at.eq.${inbound.createdAt},id.gt.${inbound.id})`
}

/**
 * True when the customer sent another message after this one. That
 * later message has its own dispatch, which will answer with more
 * context — so this one should stand down.
 *
 * A query error resolves to `false`: risking a duplicate reply beats
 * leaving the customer unanswered.
 */
export async function hasNewerCustomerMessage(
  db: SupabaseClient,
  conversationId: string,
  inbound: InboundRef,
): Promise<boolean> {
  const { data, error } = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
    .or(afterFilter(inbound))
    .limit(1)

  if (error) {
    console.error('[ai auto-reply] newer-message check failed:', error)
    return false
  }
  return (data?.length ?? 0) > 0
}

/**
 * True when *something* already replied to the customer after this
 * inbound — an automation, a Flow, or a human agent.
 *
 * Deliberately doesn't ask who: the guarantee is that the customer gets
 * exactly one answer, so one query covers every sender, and it keeps
 * working if another responder is added later. A `failed` send doesn't
 * count — a message that never reached the customer must not silence
 * the LLM.
 */
export async function hasOutboundSince(
  db: SupabaseClient,
  conversationId: string,
  inbound: InboundRef,
): Promise<boolean> {
  const { data, error } = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .in('sender_type', ['agent', 'bot'])
    .neq('status', 'failed')
    .or(afterFilter(inbound))
    .limit(1)

  if (error) {
    console.error('[ai auto-reply] outbound check failed:', error)
    return false
  }
  return (data?.length ?? 0) > 0
}
