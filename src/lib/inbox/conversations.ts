import type { Conversation, Contact, Tag } from "@/types";

/**
 * Conversation select that embeds the contact plus its tags, so the Inbox
 * can filter conversations by contact tag without a second round-trip.
 * `contact_tags(tags(*))` returns the join rows; {@link normalizeConversation}
 * flattens them onto `contact.tags`.
 */
export const CONVERSATION_SELECT =
  "*, contact:contacts(*, contact_tags(tags(*)))";

/** Raw shape returned by {@link CONVERSATION_SELECT} before flattening. */
type RawContact = Contact & { contact_tags?: { tags: Tag | null }[] };
type RawConversation = Omit<Conversation, "contact"> & {
  contact?: RawContact | null;
};

/**
 * Flatten the embedded `contact_tags(tags(*))` join into `contact.tags`.
 * Safe to call on rows fetched with {@link CONVERSATION_SELECT}; a row with
 * no contact (e.g. a freshly-inserted conversation) passes through untouched.
 */
export function normalizeConversation(raw: RawConversation): Conversation {
  const rawContact = raw.contact;
  if (!rawContact) return raw as Conversation;

  const { contact_tags, ...contact } = rawContact;
  return {
    ...raw,
    contact: {
      ...contact,
      tags: (contact_tags ?? [])
        .map((ct) => ct.tags)
        .filter((t): t is Tag => t != null),
    },
  };
}

export function normalizeConversations(
  rows: RawConversation[],
): Conversation[] {
  return rows.map(normalizeConversation);
}

export interface ContactFilters {
  /** Tag ids; a conversation matches if its contact has ANY of them (OR). */
  tagIds: string[];
  /** Exact company match, or null for no company filter. */
  company: string | null;
}

/**
 * Whether a conversation passes the contact-based Inbox filters (issue #272).
 * Empty `tagIds` and null `company` are no-ops, so the default (no filters)
 * always matches. Tags use OR logic, consistent with Broadcast audiences.
 */
export function matchesContactFilters(
  conversation: Conversation,
  { tagIds, company }: ContactFilters,
): boolean {
  if (tagIds.length > 0) {
    const contactTagIds = conversation.contact?.tags ?? [];
    if (!contactTagIds.some((t) => tagIds.includes(t.id))) return false;
  }

  if (company !== null && conversation.contact?.company?.trim() !== company) {
    return false;
  }

  return true;
}

/**
 * Filtro de la bandeja por asesor: `'all'`, `'unassigned'` o el
 * `user_id` de un integrante de la cuenta.
 */
export type AssigneeFilter = "all" | "unassigned" | (string & {});

/**
 * Si una conversación pasa el filtro por asesor. Solo filtra lo que la
 * RLS ya dejó ver: no cambia quién ve qué (migración 520).
 */
export function matchesAssigneeFilter(
  conversation: Conversation,
  filter: AssigneeFilter,
): boolean {
  if (filter === "all") return true;
  const assignee = conversation.assigned_agent_id ?? null;
  if (filter === "unassigned") return assignee === null;
  return assignee === filter;
}

/**
 * Si la conversación espera respuesta de un asesor humano (migración
 * 551). Leer el chat no la cambia: solo responder, "Marcar como
 * atendido" o cerrarla (migración 559).
 */
export function isAwaitingReply(conversation: Conversation): boolean {
  return conversation.awaiting_reply_since != null;
}

/** Color de la espera: verde < 15 min, ámbar < 1 h, rojo desde 1 h. */
export type WaitTone = "fresh" | "warning" | "overdue";

const WARNING_AFTER_MS = 15 * 60_000;
const OVERDUE_AFTER_MS = 60 * 60_000;

/** Clasifica cuánto lleva esperando el cliente desde `since` hasta `now`. */
export function waitTone(since: string, now: Date): WaitTone {
  const waited = now.getTime() - new Date(since).getTime();
  if (waited >= OVERDUE_AFTER_MS) return "overdue";
  if (waited >= WARNING_AFTER_MS) return "warning";
  return "fresh";
}

/**
 * Orden del filtro "Por responder": la que más lleva esperando primero.
 * Las que no esperan van al final, por si llega alguna mezclada.
 */
export function compareByAwaitingReply(
  a: Conversation,
  b: Conversation,
): number {
  const sa = a.awaiting_reply_since;
  const sb = b.awaiting_reply_since;
  if (sa == null && sb == null) return 0;
  if (sa == null) return 1;
  if (sb == null) return -1;
  return new Date(sa).getTime() - new Date(sb).getTime();
}
