import { describe, it, expect } from "vitest";
import {
  compareByAwaitingReply,
  isAwaitingReply,
  matchesAssigneeFilter,
  matchesContactFilters,
  normalizeConversation,
  waitTone,
} from "./conversations";
import type { Conversation } from "@/types";

function makeConversation(
  contact: Partial<Conversation["contact"]> | null,
): Conversation {
  return {
    id: "c1",
    user_id: "u1",
    contact_id: "ct1",
    status: "open",
    unread_count: 0,
    created_at: "",
    updated_at: "",
    contact: contact
      ? {
          id: "ct1",
          user_id: "u1",
          account_id: "a1",
          phone: "123",
          created_at: "",
          updated_at: "",
          ...contact,
        }
      : undefined,
  };
}

const tag = (id: string, name = id) => ({
  id,
  user_id: "u1",
  name,
  color: "#fff",
  created_at: "",
});

describe("matchesContactFilters", () => {
  it("matches everything when no filters are set", () => {
    const conv = makeConversation({ company: "Acme", tags: [tag("t1")] });
    expect(matchesContactFilters(conv, { tagIds: [], company: null })).toBe(
      true,
    );
    expect(makeConversation(null)).toBeDefined();
    expect(
      matchesContactFilters(makeConversation(null), {
        tagIds: [],
        company: null,
      }),
    ).toBe(true);
  });

  it("uses OR logic across tags", () => {
    const conv = makeConversation({ tags: [tag("t1"), tag("t2")] });
    expect(
      matchesContactFilters(conv, { tagIds: ["t2", "t9"], company: null }),
    ).toBe(true);
    expect(
      matchesContactFilters(conv, { tagIds: ["t9"], company: null }),
    ).toBe(false);
  });

  it("excludes conversations whose contact has no tags when a tag filter is active", () => {
    const conv = makeConversation({ tags: [] });
    expect(
      matchesContactFilters(conv, { tagIds: ["t1"], company: null }),
    ).toBe(false);
    expect(
      matchesContactFilters(makeConversation(null), {
        tagIds: ["t1"],
        company: null,
      }),
    ).toBe(false);
  });

  it("matches company exactly, trimming whitespace", () => {
    const conv = makeConversation({ company: "  Acme  " });
    expect(
      matchesContactFilters(conv, { tagIds: [], company: "Acme" }),
    ).toBe(true);
    expect(
      matchesContactFilters(conv, { tagIds: [], company: "Other" }),
    ).toBe(false);
  });

  it("requires both tag and company to match when both are set (AND across facets)", () => {
    const conv = makeConversation({ company: "Acme", tags: [tag("t1")] });
    expect(
      matchesContactFilters(conv, { tagIds: ["t1"], company: "Acme" }),
    ).toBe(true);
    expect(
      matchesContactFilters(conv, { tagIds: ["t1"], company: "Other" }),
    ).toBe(false);
    expect(
      matchesContactFilters(conv, { tagIds: ["tX"], company: "Acme" }),
    ).toBe(false);
  });
});

describe("normalizeConversation", () => {
  it("flattens embedded contact_tags into contact.tags", () => {
    const raw = {
      id: "c1",
      user_id: "u1",
      contact_id: "ct1",
      status: "open" as const,
      unread_count: 0,
      created_at: "",
      updated_at: "",
      contact: {
        id: "ct1",
        user_id: "u1",
        account_id: "a1",
        phone: "123",
        created_at: "",
        updated_at: "",
        contact_tags: [{ tags: tag("t1", "VIP") }, { tags: null }],
      },
    };
    const normalized = normalizeConversation(raw);
    expect(normalized.contact?.tags).toEqual([tag("t1", "VIP")]);
    // The raw join key is dropped from the flattened contact.
    expect(
      (normalized.contact as unknown as Record<string, unknown>).contact_tags,
    ).toBeUndefined();
  });

  it("passes through a conversation with no contact", () => {
    const raw = {
      id: "c1",
      user_id: "u1",
      contact_id: "ct1",
      status: "open" as const,
      unread_count: 0,
      created_at: "",
      updated_at: "",
      contact: null,
    };
    // A contactless row passes through untouched (consumers use `?.`).
    expect(normalizeConversation(raw).contact).toBeNull();
  });
});

// El dueño no tenía cómo ver qué conversaciones tiene cada asesor
// (2026-09-18): el filtro de la bandeja se decide con esta regla.
describe("matchesAssigneeFilter", () => {
  const deBrayan = { ...makeConversation(null), assigned_agent_id: "u-brayan" };
  const sinAsesor = makeConversation(null);

  it("con 'all' deja pasar todo", () => {
    expect(matchesAssigneeFilter(deBrayan, "all")).toBe(true);
    expect(matchesAssigneeFilter(sinAsesor, "all")).toBe(true);
  });

  it("con 'unassigned' solo deja pasar las que no tienen asesor", () => {
    expect(matchesAssigneeFilter(sinAsesor, "unassigned")).toBe(true);
    expect(matchesAssigneeFilter({ ...sinAsesor, assigned_agent_id: null as unknown as undefined }, "unassigned")).toBe(true);
    expect(matchesAssigneeFilter(deBrayan, "unassigned")).toBe(false);
  });

  it("con un id solo deja pasar las de ese asesor", () => {
    expect(matchesAssigneeFilter(deBrayan, "u-brayan")).toBe(true);
    expect(matchesAssigneeFilter(deBrayan, "u-juan")).toBe(false);
    expect(matchesAssigneeFilter(sinAsesor, "u-juan")).toBe(false);
  });
});

describe("awaiting reply", () => {
  const now = new Date("2026-10-17T15:00:00.000Z");
  const minutesAgo = (m: number) =>
    new Date(now.getTime() - m * 60_000).toISOString();
  const withWait = (since: string | null, id = "c1"): Conversation => ({
    ...makeConversation(null),
    id,
    awaiting_reply_since: since,
  });

  it("isAwaitingReply depende solo de awaiting_reply_since", () => {
    expect(isAwaitingReply(withWait(minutesAgo(5)))).toBe(true);
    expect(isAwaitingReply(withWait(null))).toBe(false);
    expect(isAwaitingReply(makeConversation(null))).toBe(false);
  });

  it("waitTone respeta los límites de 15 min y 1 h", () => {
    expect(waitTone(minutesAgo(0), now)).toBe("fresh");
    expect(waitTone(minutesAgo(14.99), now)).toBe("fresh");
    expect(waitTone(minutesAgo(15), now)).toBe("warning");
    expect(waitTone(minutesAgo(59.99), now)).toBe("warning");
    expect(waitTone(minutesAgo(60), now)).toBe("overdue");
    expect(waitTone(minutesAgo(600), now)).toBe("overdue");
  });

  it("ordena de la espera más antigua a la más reciente, sin espera al final", () => {
    const list = [
      withWait(minutesAgo(5), "nuevo"),
      withWait(null, "sin"),
      withWait(minutesAgo(90), "viejo"),
      withWait(minutesAgo(30), "medio"),
    ];
    expect([...list].sort(compareByAwaitingReply).map((c) => c.id)).toEqual([
      "viejo",
      "medio",
      "nuevo",
      "sin",
    ]);
  });
});
