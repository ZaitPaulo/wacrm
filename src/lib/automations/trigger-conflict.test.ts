import { describe, expect, it } from "vitest";
import {
  conflictApplies,
  detectTriggerConflict,
  findConflictingFlowName,
  hasMessagingStep,
  isRelationshipTrigger,
} from "./trigger-conflict";

// ============================================================
// The double-greeting guard.
//
// The webhook fires relationship triggers even when a flow consumed the
// message — correct, and the reason this warning has to exist. What
// follows pins both halves of the rule: WHEN it fires, and that it
// never turns into a blocker.
// ============================================================

/** Minimal stand-in for the flows lookup. */
function fakeDb(rows: { name: string }[], error?: { message: string }) {
  const calls: [string, unknown][] = [];
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (c: string, v: unknown) => {
      calls.push([c, v]);
      return chain;
    },
    limit: () => Promise.resolve({ data: error ? null : rows, error: error ?? null }),
  };
  return { db: { from: () => chain }, calls };
}

const SEND = { step_type: "send_message" };
const TAG = { step_type: "add_tag" };

describe("hasMessagingStep", () => {
  it("spots a top-level send", () => {
    expect(hasMessagingStep([TAG, SEND])).toBe(true);
  });

  it("spots every messaging step type", () => {
    for (const step_type of [
      "send_message",
      "send_buttons",
      "send_list",
      "send_template",
    ]) {
      expect(hasMessagingStep([{ step_type }])).toBe(true);
    }
  });

  it("is false for an automation that only acts", () => {
    expect(
      hasMessagingStep([
        TAG,
        { step_type: "create_deal" },
        { step_type: "assign_conversation" },
      ]),
    ).toBe(false);
  });

  it("looks inside condition branches", () => {
    // A send buried in a branch reaches the customer just the same.
    expect(
      hasMessagingStep([
        { step_type: "condition", branches: { yes: [SEND], no: [TAG] } },
      ]),
    ).toBe(true);
    expect(
      hasMessagingStep([
        { step_type: "condition", branches: { no: [{ step_type: "wait" }] } },
      ]),
    ).toBe(false);
  });

  it("tolerates a missing or malformed step list", () => {
    expect(hasMessagingStep(null)).toBe(false);
    expect(hasMessagingStep(undefined)).toBe(false);
    expect(hasMessagingStep([])).toBe(false);
  });
});

describe("isRelationshipTrigger", () => {
  it("covers the triggers the webhook does not suppress", () => {
    expect(isRelationshipTrigger("first_inbound_message")).toBe(true);
    expect(isRelationshipTrigger("new_contact_created")).toBe(true);
  });

  it("excludes content triggers, which the webhook already suppresses", () => {
    for (const t of [
      "new_message_received",
      "keyword_match",
      "interactive_reply",
      "time_based",
    ]) {
      expect(isRelationshipTrigger(t)).toBe(false);
    }
  });
});

describe("conflictApplies", () => {
  const base = {
    triggerType: "first_inbound_message",
    steps: [SEND],
    willBeActive: true,
  };

  it("fires for an active, sending, relationship-triggered automation", () => {
    expect(conflictApplies(base)).toBe(true);
  });

  it("stays quiet for a silent automation", () => {
    expect(conflictApplies({ ...base, steps: [TAG] })).toBe(false);
  });

  it("stays quiet for a draft", () => {
    expect(conflictApplies({ ...base, willBeActive: false })).toBe(false);
  });

  it("stays quiet for a content trigger", () => {
    expect(conflictApplies({ ...base, triggerType: "keyword_match" })).toBe(
      false,
    );
  });
});

describe("findConflictingFlowName", () => {
  it("only considers active flows on the same trigger, in this account", async () => {
    const { db, calls } = fakeDb([{ name: "Calificación de prospecto" }]);
    const name = await findConflictingFlowName(
      db as never,
      "acct-1",
      "first_inbound_message",
    );
    expect(name).toBe("Calificación de prospecto");
    expect(calls).toEqual([
      ["account_id", "acct-1"],
      ["status", "active"],
      ["trigger_type", "first_inbound_message"],
    ]);
  });

  it("returns null when no flow matches", async () => {
    const { db } = fakeDb([]);
    expect(
      await findConflictingFlowName(db as never, "acct-1", "first_inbound_message"),
    ).toBeNull();
  });

  it("stays silent rather than failing when the lookup errors", async () => {
    const { db } = fakeDb([], { message: "boom" });
    expect(
      await findConflictingFlowName(db as never, "acct-1", "first_inbound_message"),
    ).toBeNull();
  });
});

describe("detectTriggerConflict", () => {
  it("names the flow the customer would hear twice", async () => {
    const { db } = fakeDb([{ name: "Calificación de prospecto" }]);
    expect(
      await detectTriggerConflict({
        db: db as never,
        accountId: "acct-1",
        triggerType: "first_inbound_message",
        steps: [SEND],
        willBeActive: true,
      }),
    ).toBe("Calificación de prospecto");
  });

  it("does not even query when the automation is silent", async () => {
    const { db, calls } = fakeDb([{ name: "Calificación de prospecto" }]);
    expect(
      await detectTriggerConflict({
        db: db as never,
        accountId: "acct-1",
        triggerType: "first_inbound_message",
        steps: [TAG],
        willBeActive: true,
      }),
    ).toBeNull();
    expect(calls).toEqual([]);
  });

  it("says nothing when the rival flow is only a draft", async () => {
    // The query filters on status='active', so a draft yields no rows.
    const { db } = fakeDb([]);
    expect(
      await detectTriggerConflict({
        db: db as never,
        accountId: "acct-1",
        triggerType: "first_inbound_message",
        steps: [SEND],
        willBeActive: true,
      }),
    ).toBeNull();
  });
});
