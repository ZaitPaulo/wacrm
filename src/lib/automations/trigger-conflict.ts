/**
 * "Will this automation make the customer hear us twice?"
 *
 * The webhook suppresses an automation's *content* triggers
 * (`new_message_received`, `keyword_match`, `interactive_reply`) when a
 * flow already consumed the inbound message, but deliberately lets the
 * *relationship* triggers through — `first_inbound_message` and
 * `new_contact_created` are about WHO wrote, not what they wrote, so a
 * tagging automation must still run even when a flow answers.
 *
 * The cost of that correct decision: an automation that SENDS on a
 * relationship trigger shared with a live flow greets the same customer
 * twice. Nothing in the data model prevents it and nothing warned.
 *
 * So the rule is a content contract — a flow talks, an automation acts
 * — and this module is what makes breaking it visible. It warns; it
 * does not block. An operator may legitimately want a flow that covers
 * one branch and an automation that covers the rest, and the system
 * cannot tell that apart from a mistake. It can only say what will
 * happen, and name the flow responsible.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** Step types that put a message in front of the customer. */
const MESSAGING_STEPS = new Set([
  'send_message',
  'send_buttons',
  'send_list',
  'send_template',
])

/**
 * Automation triggers that survive a flow consuming the message.
 *
 * Only `first_inbound_message` can actually collide today, because
 * flows trigger on `keyword` / `first_inbound_message` / `manual` and
 * nothing else. `new_contact_created` is listed because it is the other
 * relationship trigger, and would collide the day flows gain it.
 */
const RELATIONSHIP_TRIGGERS = new Set([
  'first_inbound_message',
  'new_contact_created',
])

interface StepLike {
  step_type: string
  branches?: { yes?: StepLike[]; no?: StepLike[] }
}

/** Does any step — including inside condition branches — send something? */
export function hasMessagingStep(steps: StepLike[] | null | undefined): boolean {
  if (!Array.isArray(steps)) return false
  for (const s of steps) {
    if (MESSAGING_STEPS.has(s.step_type)) return true
    if (s.branches) {
      if (hasMessagingStep(s.branches.yes)) return true
      if (hasMessagingStep(s.branches.no)) return true
    }
  }
  return false
}

export function isRelationshipTrigger(triggerType: string): boolean {
  return RELATIONSHIP_TRIGGERS.has(triggerType)
}

/**
 * Decide whether a warning is warranted, given what's already known.
 *
 * Split from the query so the rule itself is testable without a
 * database, and so callers that already know there is no live flow can
 * skip the round trip.
 */
export function conflictApplies(args: {
  triggerType: string
  steps: StepLike[] | null | undefined
  willBeActive: boolean
}): boolean {
  return (
    args.willBeActive &&
    isRelationshipTrigger(args.triggerType) &&
    hasMessagingStep(args.steps)
  )
}

/**
 * Name of an active flow that fires on the same trigger, if any.
 *
 * Returns the name rather than a boolean because a warning that cannot
 * say WHICH flow leaves the operator hunting through the list.
 */
export async function findConflictingFlowName(
  db: SupabaseClient,
  accountId: string,
  triggerType: string,
): Promise<string | null> {
  const { data, error } = await db
    .from('flows')
    .select('name')
    .eq('account_id', accountId)
    .eq('status', 'active')
    .eq('trigger_type', triggerType)
    .limit(1)
  if (error) {
    // A warning is a courtesy; failing the operator's save because we
    // could not look one up would be worse than staying quiet.
    console.error('[automations] conflict lookup failed:', error.message)
    return null
  }
  const rows = (data as { name: string }[] | null) ?? []
  return rows[0]?.name ?? null
}

/**
 * Full check. Returns the conflicting flow's name, or null when there
 * is nothing worth saying.
 */
export async function detectTriggerConflict(args: {
  db: SupabaseClient
  accountId: string
  triggerType: string
  steps: StepLike[] | null | undefined
  willBeActive: boolean
}): Promise<string | null> {
  if (!conflictApplies(args)) return null
  return findConflictingFlowName(args.db, args.accountId, args.triggerType)
}
