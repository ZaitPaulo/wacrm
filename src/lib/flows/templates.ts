/**
 * Starter flow templates.
 *
 * Three pre-canned flows users can clone with one click instead of
 * building from scratch. Each template is a plain JS object describing
 * the same shape `/api/flows` PUT accepts — name, trigger config,
 * entry_node_id, fallback_policy, nodes[] — keyed by a stable
 * `slug`.
 *
 * The clone path (`/api/flows` POST with `template_slug`) creates a
 * NEW flow_row + flow_nodes rows for the user. `node_key`s are kept
 * verbatim (they're stable strings, not UUIDs, so cloning never
 * needs to rewrite edge references).
 *
 * Choosing a single static module over a DB-backed gallery for v1
 * because: (a) the set is small and changes with code releases, not
 * data; (b) keeps templates portable across self-hosted instances
 * without migrations; (c) editing in source is the lowest-friction
 * way to add the next template.
 *
 * ── Content language and audience ────────────────────────────────
 * The scripts are written in neutral Latin American Spanish for a
 * used-vehicle dealership, because that is what this install sells.
 * The gallery's own labels (`name`, `description`) do NOT live here —
 * they are interface text and come from the message catalogue under
 * `Flows.templates.<slug>`. What stays here is the seed content: the
 * moment a template is cloned, those strings become rows the operator
 * owns and edits, so they must not be re-resolved at render time.
 *
 * Two authoring rules the engine enforces, easy to break by hand:
 *
 *   1. Answers the customer picks from a fixed set use buttons or a
 *      list, never free text. Free text is reserved for what only they
 *      can phrase (which car they want). Field evidence: of the five
 *      runs of the previous English script, three captured noise in
 *      free-text fields because nobody understood the question.
 *   2. Interpolation is `{{vars.key}}` — see `interpolateVars` in
 *      engine.ts. A tapped option is stored under the *asking node's*
 *      `node_key`, so `{{vars.compra_pago}}` is the answer given on
 *      the `compra_pago` node. Only `collect_input` uses its own
 *      `var_key`.
 *
 * WhatsApp caps every template here must respect (validate.ts checks
 * them, and `INTERACTIVE_LIMITS` is the source of truth): at most 3
 * buttons per message, button titles ≤20 chars, ≤10 list rows across
 * all sections, row titles ≤24 chars.
 */

import type {
  CollectInputNodeConfig,
  HandoffNodeConfig,
  KeywordTriggerConfig,
  SendButtonsNodeConfig,
  SendListNodeConfig,
  SendMessageNodeConfig,
  SetTagNodeConfig,
  StartNodeConfig,
} from "./types";

export type FlowTemplateNodeType =
  | "start"
  | "send_message"
  | "send_buttons"
  | "send_list"
  | "collect_input"
  | "condition"
  | "set_tag"
  | "handoff"
  | "end";

export interface FlowTemplateNode {
  node_key: string;
  node_type: FlowTemplateNodeType;
  config:
    | StartNodeConfig
    | SendMessageNodeConfig
    | SendButtonsNodeConfig
    | SendListNodeConfig
    | CollectInputNodeConfig
    | SetTagNodeConfig
    | HandoffNodeConfig
    | Record<string, unknown>;
}

export interface FlowTemplate {
  slug: string;
  /** Used by the gallery to surface a relevant icon. lucide-react name. */
  icon: "MessageSquare" | "HelpCircle" | "UserPlus";
  trigger_type: "keyword" | "first_inbound_message" | "manual";
  trigger_config: KeywordTriggerConfig | Record<string, unknown>;
  entry_node_id: string;
  nodes: FlowTemplateNode[];
}

// ============================================================
// 1. Menú de bienvenida — enruta por intención y deriva
// ============================================================
const WELCOME_MENU: FlowTemplate = {
  slug: "welcome_menu",
  icon: "MessageSquare",
  trigger_type: "keyword",
  trigger_config: {
    keywords: ["hola", "buenas", "info", "informacion"],
    match_type: "contains",
  },
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "saludo" },
    },
    {
      node_key: "saludo",
      node_type: "send_buttons",
      config: {
        text: "¡Hola! 👋 Gracias por escribirnos. ¿Con qué te ayudamos hoy?",
        footer_text: "Toca una opción para continuar.",
        buttons: [
          {
            reply_id: "comprar",
            title: "Quiero comprar",
            next_node_key: "handoff_compra",
          },
          {
            reply_id: "vender",
            title: "Vendo mi auto",
            next_node_key: "handoff_venta",
          },
          {
            reply_id: "otro",
            title: "Otra consulta",
            next_node_key: "handoff_otro",
          },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: "handoff_compra",
      node_type: "handoff",
      config: {
        note: "Quiere comprar. Llega desde el menú de bienvenida; todavía no dijo qué vehículo busca.",
      } as HandoffNodeConfig,
    },
    {
      node_key: "handoff_venta",
      node_type: "handoff",
      config: {
        note: "Quiere vender o permutar su vehículo. Pedir marca, modelo, año y kilometraje.",
      } as HandoffNodeConfig,
    },
    {
      node_key: "handoff_otro",
      node_type: "handoff",
      config: {
        note: "Consulta general desde el menú de bienvenida.",
      } as HandoffNodeConfig,
    },
  ],
};

// ============================================================
// 2. Preguntas frecuentes — responde solo y termina
// ============================================================
const FAQ_BOT: FlowTemplate = {
  slug: "faq_bot",
  icon: "HelpCircle",
  trigger_type: "keyword",
  trigger_config: {
    keywords: ["horario", "financiacion", "garantia", "preguntas"],
    match_type: "contains",
  },
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "temas" },
    },
    {
      node_key: "temas",
      node_type: "send_list",
      config: {
        text: "¿Sobre qué te gustaría saber?",
        button_label: "Ver temas",
        sections: [
          {
            title: "Preguntas frecuentes",
            rows: [
              {
                reply_id: "horarios",
                title: "Horarios de atención",
                next_node_key: "resp_horarios",
              },
              {
                reply_id: "financiacion",
                title: "Financiación y cuotas",
                next_node_key: "resp_financiacion",
              },
              {
                reply_id: "garantia",
                title: "Garantía y papeles",
                next_node_key: "resp_garantia",
              },
              {
                reply_id: "permuta",
                title: "¿Reciben mi auto?",
                next_node_key: "resp_permuta",
              },
            ],
          },
          {
            title: "Otro",
            rows: [
              {
                reply_id: "asesor",
                title: "Hablar con un asesor",
                next_node_key: "handoff_asesor",
              },
            ],
          },
        ],
      } as SendListNodeConfig,
    },
    {
      node_key: "resp_horarios",
      node_type: "send_message",
      config: {
        // Los datos concretos los ajusta el operador desde el editor:
        // ninguna plantilla puede conocer el horario del negocio.
        text: "Atendemos de lunes a viernes de 8:00 a 18:00 y los sábados de 9:00 a 13:00.",
        next_node_key: "fin",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "resp_financiacion",
      node_type: "send_message",
      config: {
        text: "Trabajamos con financiación bancaria y crédito directo. La cuota depende de la cuota inicial y del plazo; un asesor te arma la simulación con el vehículo que elijas.",
        next_node_key: "fin",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "resp_garantia",
      node_type: "send_message",
      config: {
        text: "Todos nuestros vehículos se entregan con traspaso incluido y papeles al día. Consulta con el asesor la garantía puntual del que te interese.",
        next_node_key: "fin",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "resp_permuta",
      node_type: "send_message",
      config: {
        text: "Sí, recibimos tu vehículo como parte de pago. Lo valoramos según año, kilometraje y estado.",
        next_node_key: "fin",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "handoff_asesor",
      node_type: "handoff",
      config: {
        note: "Pidió hablar con un asesor desde las preguntas frecuentes.",
      } as HandoffNodeConfig,
    },
    {
      node_key: "fin",
      node_type: "end",
      config: {},
    },
  ],
};

// ============================================================
// 3. Calificación de prospecto — el guion principal
//
// No lleva mensaje de despedida antes de derivar: `executeHandoff`
// avisa al cliente que se le asignó un asesor, así que un nodo extra
// aquí produciría dos mensajes seguidos diciendo lo mismo.
//
// Dos ramas que no se mezclan: quien compra y quien vende terminan en
// derivaciones distintas, cada una con su propia nota. Compartir un
// solo nodo de derivación ahorraría cuatro nodos, pero dejaría al
// agente leyendo campos vacíos de la rama que el cliente no recorrió.
// ============================================================
const LEAD_CAPTURE: FlowTemplate = {
  slug: "lead_capture",
  icon: "UserPlus",
  trigger_type: "first_inbound_message",
  trigger_config: {},
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "saludo" },
    },
    {
      node_key: "saludo",
      node_type: "send_buttons",
      config: {
        text: "¡Hola! 👋 Gracias por escribirnos. ¿Con qué te ayudamos hoy?",
        footer_text: "Toca una opción para continuar.",
        buttons: [
          {
            reply_id: "comprar",
            title: "Quiero comprar",
            next_node_key: "compra_vehiculo",
          },
          {
            reply_id: "vender",
            title: "Vendo mi auto",
            next_node_key: "venta_vehiculo",
          },
          {
            reply_id: "otro",
            title: "Otra consulta",
            next_node_key: "otro_handoff",
          },
        ],
      } as SendButtonsNodeConfig,
    },

    // ---- Rama de compra ----
    {
      node_key: "compra_vehiculo",
      node_type: "collect_input",
      config: {
        prompt_text:
          "¿Qué vehículo te interesa? Dime marca, modelo y año, o el código del aviso.",
        var_key: "vehiculo_interes",
        next_node_key: "compra_presupuesto",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "compra_presupuesto",
      node_type: "send_list",
      config: {
        text: "¿En qué rango de presupuesto te mueves?",
        button_label: "Ver rangos",
        sections: [
          {
            title: "Presupuesto",
            // Los cortes salen del inventario real, no de una
            // estimación: cada rango tiene stock que ofrecer. Revísalos
            // cuando el stock se corra de forma sostenida.
            rows: [
              {
                reply_id: "presup_1",
                title: "Hasta $60 millones",
                next_node_key: "compra_pago",
              },
              {
                reply_id: "presup_2",
                title: "$60 a $90 millones",
                next_node_key: "compra_pago",
              },
              {
                reply_id: "presup_3",
                title: "$90 a $130 millones",
                next_node_key: "compra_pago",
              },
              {
                reply_id: "presup_4",
                title: "Más de $130 millones",
                next_node_key: "compra_pago",
              },
              {
                reply_id: "presup_0",
                title: "Aún no lo defino",
                next_node_key: "compra_pago",
              },
            ],
          },
        ],
      } as SendListNodeConfig,
    },
    {
      node_key: "compra_pago",
      node_type: "send_buttons",
      config: {
        text: "¿Cómo piensas pagarlo?",
        buttons: [
          {
            reply_id: "contado",
            title: "De contado",
            next_node_key: "compra_calificado",
          },
          {
            reply_id: "credito",
            title: "Con financiación",
            next_node_key: "compra_calificado",
          },
          {
            reply_id: "permuta",
            title: "Entrego mi auto",
            next_node_key: "permuta_vehiculo",
          },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: "permuta_vehiculo",
      node_type: "collect_input",
      config: {
        prompt_text:
          "¿Qué vehículo entregarías? Marca, modelo, año y kilometraje aproximado.",
        var_key: "vehiculo_permuta",
        next_node_key: "compra_calificado",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "compra_calificado",
      node_type: "set_tag",
      config: {
        mode: "add",
        // Vacío a propósito: el id de la etiqueta es de cada cuenta.
        // Elígela en el editor antes de activar; la validación lo exige.
        tag_id: "",
        next_node_key: "compra_handoff",
      } as SetTagNodeConfig,
    },
    {
      node_key: "compra_handoff",
      node_type: "handoff",
      config: {
        note: "COMPRA · Busca: {{vars.vehiculo_interes}} · Presupuesto: {{vars.compra_presupuesto}} · Pago: {{vars.compra_pago}} · Entrega en parte de pago: {{vars.vehiculo_permuta}}",
      } as HandoffNodeConfig,
    },

    // ---- Rama de venta / permuta ----
    {
      node_key: "venta_vehiculo",
      node_type: "collect_input",
      config: {
        prompt_text:
          "Cuéntame qué vehículo vendes: marca, modelo, año y kilometraje.",
        var_key: "vehiculo_ofrecido",
        next_node_key: "venta_calificado",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "venta_calificado",
      node_type: "set_tag",
      config: {
        mode: "add",
        tag_id: "",
        next_node_key: "venta_handoff",
      } as SetTagNodeConfig,
    },
    {
      node_key: "venta_handoff",
      node_type: "handoff",
      config: {
        note: "VENTA · Ofrece: {{vars.vehiculo_ofrecido}} · Coordinar valoración.",
      } as HandoffNodeConfig,
    },

    // ---- Fuera de guion ----
    {
      node_key: "otro_handoff",
      node_type: "handoff",
      config: {
        note: "Consulta general. No entró a la calificación.",
      } as HandoffNodeConfig,
    },
  ],
};

// ============================================================
// Registry
// ============================================================

const TEMPLATES: Record<string, FlowTemplate> = {
  welcome_menu: WELCOME_MENU,
  faq_bot: FAQ_BOT,
  lead_capture: LEAD_CAPTURE,
};

export function getFlowTemplate(slug: string): FlowTemplate | null {
  return TEMPLATES[slug] ?? null;
}

export function listFlowTemplates(): FlowTemplate[] {
  return Object.values(TEMPLATES);
}
