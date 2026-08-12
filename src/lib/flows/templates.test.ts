import { describe, expect, it } from "vitest";
import { listFlowTemplates, getFlowTemplate } from "./templates";
import { validateFlowForActivation, reachableFromEntry } from "./validate";
import { INTERACTIVE_LIMITS } from "@/lib/whatsapp/meta-api";

// ============================================================
// The shipped templates must survive their own validator.
//
// A template that cannot be activated without edits is worse than no
// template: the operator clones it, hits a wall of errors, and has to
// reverse-engineer what the author meant. The previous English set was
// never checked this way.
//
// One gap is deliberate and pinned below: `set_tag.tag_id` is empty
// because tag ids are per-account. That is the ONLY thing a clone
// should have to fill in.
// ============================================================

/** Templates carry no name — the clone assigns one. */
function asFlowInput(t: ReturnType<typeof getFlowTemplate>) {
  return {
    name: "Plantilla clonada",
    trigger_type: t!.trigger_type,
    trigger_config: t!.trigger_config as Record<string, unknown>,
    entry_node_id: t!.entry_node_id,
  };
}

function nodesOf(t: ReturnType<typeof getFlowTemplate>) {
  return t!.nodes.map((n) => ({
    node_key: n.node_key,
    node_type: n.node_type,
    config: n.config as Record<string, unknown>,
  }));
}

const SLUGS = ["welcome_menu", "faq_bot", "lead_capture"];

describe("shipped flow templates", () => {
  it("exposes exactly the three expected slugs", () => {
    expect(listFlowTemplates().map((t) => t.slug).sort()).toEqual(
      [...SLUGS].sort(),
    );
  });

  it.each(SLUGS)("%s activates cleanly except for the tag picker", (slug) => {
    const t = getFlowTemplate(slug);
    const issues = validateFlowForActivation(asFlowInput(t), nodesOf(t));

    const errors = issues.filter((i) => i.severity === "error");
    // Every remaining error must be the intentional empty tag id.
    expect(errors.map((e) => e.code)).toEqual(
      errors.map(() => "setTagNoTag"),
    );
  });

  it.each(SLUGS)("%s has no unreachable nodes", (slug) => {
    const t = getFlowTemplate(slug);
    const issues = validateFlowForActivation(asFlowInput(t), nodesOf(t));
    expect(issues.filter((i) => i.code === "nodeUnreachable")).toEqual([]);
  });

  it.each(SLUGS)("%s reaches every node from its entry", (slug) => {
    const t = getFlowTemplate(slug);
    const reached = reachableFromEntry(t!.entry_node_id, nodesOf(t));
    expect(reached.size).toBe(t!.nodes.length);
  });

  it.each(SLUGS)("%s keeps every keyword in Spanish-friendly form", (slug) => {
    const t = getFlowTemplate(slug);
    if (t!.trigger_type !== "keyword") return;
    const keywords = (t!.trigger_config as { keywords?: string[] }).keywords ?? [];
    expect(keywords.length).toBeGreaterThan(0);
    // English keywords never match what a Spanish-speaking customer
    // types — the exact defect this replaced ("pricing", "quote", "buy").
    for (const k of keywords) {
      expect(k).toBe(k.toLowerCase());
      expect(k.trim()).not.toBe("");
    }
  });
});

describe("template interpolation uses the syntax its engine understands", () => {
  it.each(SLUGS)("%s only references resolvable variables", (slug) => {
    const t = getFlowTemplate(slug);
    // Keys the flow engine can actually resolve: a collect_input
    // var_key, or the node_key of a buttons/list node (where the
    // tapped option is stored).
    const resolvable = new Set<string>();
    for (const n of t!.nodes) {
      if (n.node_type === "collect_input") {
        resolvable.add((n.config as { var_key: string }).var_key);
      }
      if (n.node_type === "send_buttons" || n.node_type === "send_list") {
        resolvable.add(n.node_key);
      }
    }

    const blob = JSON.stringify(t!.nodes);
    // The engine's own pattern. A `{{ vars.x }}` with spaces is fine
    // now, but anything outside `vars.` renders empty — which is how
    // a note becomes dead text without anything failing.
    for (const [, key] of blob.matchAll(/\{\{\s*vars\.([a-zA-Z0-9_]+)\s*\}\}/g)) {
      expect(resolvable).toContain(key);
    }
    // Nothing may reference a namespace the flow engine does not have.
    expect(blob).not.toMatch(/\{\{\s*(?!vars\.)[a-zA-Z]/);
  });
});

describe("WhatsApp interactive limits", () => {
  it.each(SLUGS)("%s stays inside every Meta cap", (slug) => {
    const t = getFlowTemplate(slug);
    for (const n of t!.nodes) {
      if (n.node_type === "send_buttons") {
        const cfg = n.config as {
          buttons: { title: string }[];
          footer_text?: string;
        };
        expect(cfg.buttons.length).toBeLessThanOrEqual(
          INTERACTIVE_LIMITS.maxButtons,
        );
        for (const b of cfg.buttons) {
          expect(b.title.length).toBeLessThanOrEqual(
            INTERACTIVE_LIMITS.buttonTitleMaxLength,
          );
        }
        if (cfg.footer_text) {
          expect(cfg.footer_text.length).toBeLessThanOrEqual(60);
        }
      }
      if (n.node_type === "send_list") {
        const cfg = n.config as {
          button_label: string;
          sections: { rows: { title: string }[] }[];
        };
        const rows = cfg.sections.flatMap((s) => s.rows);
        expect(rows.length).toBeLessThanOrEqual(
          INTERACTIVE_LIMITS.maxListRowsTotal,
        );
        for (const r of rows) {
          expect(r.title.length).toBeLessThanOrEqual(
            INTERACTIVE_LIMITS.listRowTitleMaxLength,
          );
        }
        expect(cfg.button_label.length).toBeLessThanOrEqual(
          INTERACTIVE_LIMITS.buttonTitleMaxLength,
        );
      }
    }
  });
});

describe("lead_capture: the qualification script", () => {
  const t = getFlowTemplate("lead_capture")!;
  const byKey = new Map(t.nodes.map((n) => [n.node_key, n]));

  it("greets on the customer's first-ever message", () => {
    expect(t.trigger_type).toBe("first_inbound_message");
  });

  it("asks budget and payment with taps, not free text", () => {
    expect(byKey.get("compra_presupuesto")!.node_type).toBe("send_list");
    expect(byKey.get("compra_pago")!.node_type).toBe("send_buttons");
  });

  it("leaves free text only for what the customer must phrase", () => {
    const freeText = t.nodes
      .filter((n) => n.node_type === "collect_input")
      .map((n) => (n.config as { var_key: string }).var_key);
    expect(freeText.sort()).toEqual([
      "vehiculo_interes",
      "vehiculo_ofrecido",
      "vehiculo_permuta",
    ]);
  });

  it("never asks for a work email or a company", () => {
    const blob = JSON.stringify(t.nodes).toLowerCase();
    for (const word of ["email", "correo", "empresa", "company"]) {
      expect(blob).not.toContain(word);
    }
  });

  it("only asks about a trade-in when the customer offers one", () => {
    const pago = byKey.get("compra_pago")!.config as {
      buttons: { reply_id: string; next_node_key: string }[];
    };
    const permuta = pago.buttons.find((b) => b.reply_id === "permuta");
    expect(permuta!.next_node_key).toBe("permuta_vehiculo");
    for (const b of pago.buttons.filter((x) => x.reply_id !== "permuta")) {
      expect(b.next_node_key).toBe("compra_calificado");
    }
  });

  it("tags the contact before handing off, on both branches", () => {
    for (const key of ["compra_calificado", "venta_calificado"]) {
      const cfg = byKey.get(key)!.config as { mode: string };
      expect(byKey.get(key)!.node_type).toBe("set_tag");
      expect(cfg.mode).toBe("add");
    }
  });

  it("gives each branch its own handoff note", () => {
    const compra = byKey.get("compra_handoff")!.config as { note: string };
    const venta = byKey.get("venta_handoff")!.config as { note: string };
    // A shared handoff would leave the agent reading empty fields from
    // the branch the customer never walked.
    expect(compra.note).toContain("{{vars.vehiculo_interes}}");
    expect(compra.note).not.toContain("vehiculo_ofrecido");
    expect(venta.note).toContain("{{vars.vehiculo_ofrecido}}");
    expect(venta.note).not.toContain("vehiculo_interes");
  });

  it("reports the tapped budget and payment to the agent", () => {
    const note = (byKey.get("compra_handoff")!.config as { note: string }).note;
    // These resolve only because the engine stores a tap under the
    // asking node's key.
    expect(note).toContain("{{vars.compra_presupuesto}}");
    expect(note).toContain("{{vars.compra_pago}}");
  });

  it("offers a budget range for every band of the catalogue", () => {
    const cfg = byKey.get("compra_presupuesto")!.config as {
      sections: { rows: { reply_id: string }[] }[];
    };
    const ids = cfg.sections.flatMap((s) => s.rows).map((r) => r.reply_id);
    // Four priced bands plus an explicit "not decided" escape, so a
    // customer without a figure is not forced to invent one.
    expect(ids).toEqual([
      "presup_1",
      "presup_2",
      "presup_3",
      "presup_4",
      "presup_0",
    ]);
  });
});
