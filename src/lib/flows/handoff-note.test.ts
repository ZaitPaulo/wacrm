import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================
// What the handoff hands over.
//
// Two defects lived here together and only show up in combination:
//
//   1. Taps on `send_buttons` / `send_list` routed but were never
//      recorded, so a flow that asked its questions with buttons —
//      the shape that produces clean answers — had nothing to report.
//   2. The handoff note was persisted raw, into the run's event log
//      only. `{{vars.x}}` reached the agent as literal braces, and the
//      agent had to open the runs viewer to see even that.
//
// These drive the real engine against a fake Supabase so the assertion
// is "the agent received the answers", not "a helper formatted a string".
// ============================================================

const h = vi.hoisted(() => ({
  state: {
    activeRuns: [] as Record<string, unknown>[],
    flows: [] as Record<string, unknown>[],
    nodes: [] as Record<string, unknown>[],
    inserted: [] as { table: string; row: Record<string, unknown> }[],
    updated: [] as { table: string; row: Record<string, unknown> }[],
  },
}));

vi.mock("./admin-client", () => {
  function rows(table: string): unknown[] {
    if (table === "flow_runs") return h.state.activeRuns;
    if (table === "flows") return h.state.flows;
    if (table === "flow_nodes") return h.state.nodes;
    return [];
  }

  function builder(table: string) {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      in: () => b,
      filter: () => b,
      order: () => b,
      limit: () => b,
      update: (row: Record<string, unknown>) => {
        h.state.updated.push({ table, row });
        return b;
      },
      insert: (row: Record<string, unknown>) => {
        h.state.inserted.push({ table, row });
        return b;
      },
      maybeSingle: async () => ({ data: rows(table)[0] ?? null, error: null }),
      single: async () => ({ data: rows(table)[0] ?? null, error: null }),
      then: (resolve: (r: { data: unknown[]; error: null }) => unknown) =>
        resolve({ data: rows(table), error: null }),
    };
    return b;
  }

  return {
    supabaseAdmin: () => ({
      from: (t: string) => builder(t),
      rpc: () => Promise.resolve({ error: null }),
    }),
  };
});

vi.mock("./meta-send", () => ({
  engineSendText: vi.fn(async () => ({ whatsapp_message_id: "wamid.1" })),
  engineSendMedia: vi.fn(async () => ({ whatsapp_message_id: "wamid.2" })),
  engineSendInteractiveButtons: vi.fn(async () => ({
    whatsapp_message_id: "wamid.3",
  })),
  engineSendInteractiveList: vi.fn(async () => ({
    whatsapp_message_id: "wamid.4",
  })),
}));

import { dispatchInboundToFlows, matchReplyOption } from "./engine";

const FLOW = {
  id: "flow-1",
  account_id: "acct-1",
  user_id: "u-1",
  status: "active",
  trigger_type: "manual",
  trigger_config: {},
  entry_node_id: "ask_pago",
  fallback_policy: {},
};

/** `ask_pago` (buttons) → `handoff`. The note reports both answers. */
function nodes(note: string) {
  return [
    {
      id: "n1",
      flow_id: "flow-1",
      node_key: "ask_pago",
      node_type: "send_buttons",
      config: {
        text: "¿Cómo piensas pagarlo?",
        buttons: [
          {
            reply_id: "contado",
            title: "De contado",
            next_node_key: "handoff",
          },
          {
            reply_id: "financiado",
            title: "Con financiamiento",
            next_node_key: "handoff",
          },
        ],
      },
    },
    {
      id: "n2",
      flow_id: "flow-1",
      node_key: "handoff",
      node_type: "handoff",
      config: { note, assign_to: "agent-9" },
    },
  ];
}

function runRow(vars: Record<string, unknown>) {
  return {
    id: "run-1",
    flow_id: "flow-1",
    account_id: "acct-1",
    user_id: "u-1",
    contact_id: "ct-1",
    conversation_id: "cv-1",
    status: "active",
    current_node_key: "ask_pago",
    reprompt_count: 0,
    vars,
    started_at: "2026-08-12T00:00:00Z",
  };
}

/** Tap "Con financiamiento" on the active run. */
function tapFinanciado() {
  return dispatchInboundToFlows({
    accountId: "acct-1",
    userId: "u-1",
    contactId: "ct-1",
    conversationId: "cv-1",
    message: {
      kind: "interactive_reply",
      reply_id: "financiado",
      reply_title: "Con financiamiento",
      meta_message_id: "m1",
    },
    isFirstInboundMessage: false,
  });
}

const notesWritten = () =>
  h.state.inserted.filter((i) => i.table === "contact_notes");

const handoffEvents = () =>
  h.state.inserted.filter(
    (i) => i.table === "flow_run_events" && i.row.event_type === "handoff",
  );

beforeEach(() => {
  h.state.flows = [FLOW];
  h.state.inserted = [];
  h.state.updated = [];
});

describe("matchReplyOption", () => {
  it("returns the destination and the label the customer saw", () => {
    expect(matchReplyOption(nodes("")[0], "financiado")).toEqual({
      next_node_key: "handoff",
      title: "Con financiamiento",
    });
  });

  it("reads list rows across sections", () => {
    const list = {
      node_type: "send_list",
      config: {
        sections: [
          { title: "A", rows: [{ reply_id: "r1", title: "Uno", next_node_key: "n1" }] },
          { title: "B", rows: [{ reply_id: "r2", title: "Dos", next_node_key: "n2" }] },
        ],
      },
    };
    expect(matchReplyOption(list, "r2")).toEqual({
      next_node_key: "n2",
      title: "Dos",
    });
  });

  it("returns null for an id that matches nothing", () => {
    expect(matchReplyOption(nodes("")[0], "nope")).toBeNull();
  });
});

describe("a tapped option is recorded under the asking node's key", () => {
  it("stores the visible title so the note can report it", async () => {
    h.state.activeRuns = [runRow({})];
    h.state.nodes = nodes("Pago: {{vars.ask_pago}}");

    await tapFinanciado();

    const varsWrite = h.state.updated.find(
      (u) => u.table === "flow_runs" && u.row.vars,
    );
    expect(varsWrite?.row.vars).toMatchObject({
      ask_pago: "Con financiamiento",
    });
  });
});

describe("the handoff note reaches the agent", () => {
  it("resolves captured variables into a contact note", async () => {
    h.state.activeRuns = [runRow({ vehiculo_interes: "Mazda CX-5" })];
    h.state.nodes = nodes(
      "Prospecto — busca: {{vars.vehiculo_interes}} | pago: {{vars.ask_pago}}",
    );

    await tapFinanciado();

    expect(notesWritten()).toHaveLength(1);
    expect(notesWritten()[0].row).toMatchObject({
      contact_id: "ct-1",
      user_id: "u-1",
      note_text:
        "Prospecto — busca: Mazda CX-5 | pago: Con financiamiento",
    });
  });

  it("tolerates inner spaces in the placeholder", async () => {
    h.state.activeRuns = [runRow({ vehiculo_interes: "Kia Picanto" })];
    h.state.nodes = nodes("Busca: {{ vars.vehiculo_interes }}");

    await tapFinanciado();

    expect(notesWritten()[0].row.note_text).toBe("Busca: Kia Picanto");
  });

  it("renders a never-captured variable as empty without failing", async () => {
    h.state.activeRuns = [runRow({})];
    h.state.nodes = nodes("Vende: {{vars.vehiculo_ofrecido}}|");

    await tapFinanciado();

    // The branch was never walked, so the var does not exist. The note
    // still goes out; the handoff must not depend on it.
    expect(notesWritten()[0].row.note_text).toBe("Vende: |");
    expect(handoffEvents()).toHaveLength(1);
  });

  it("writes no note when the node has none", async () => {
    h.state.activeRuns = [runRow({})];
    h.state.nodes = nodes("");

    await tapFinanciado();

    expect(notesWritten()).toHaveLength(0);
    expect(handoffEvents()).toHaveLength(1);
  });

  it("writes no note when interpolation leaves it blank", async () => {
    h.state.activeRuns = [runRow({})];
    // Every reference is empty, so the note collapses to whitespace —
    // an empty note beside the contact is noise, not context.
    h.state.nodes = nodes("  {{vars.nunca}}  ");

    await tapFinanciado();

    expect(notesWritten()).toHaveLength(0);
  });

  it("still logs the handoff with the resolved note and the assignee", async () => {
    h.state.activeRuns = [runRow({ vehiculo_interes: "Toyota Corolla" })];
    h.state.nodes = nodes("Busca: {{vars.vehiculo_interes}}");

    await tapFinanciado();

    expect(handoffEvents()[0].row).toMatchObject({
      event_type: "handoff",
      payload: {
        note: "Busca: Toyota Corolla",
        assigned_to: "agent-9",
      },
    });
  });
});
