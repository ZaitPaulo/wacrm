import type {
  AutomationStepConfig,
  AutomationStepType,
  AutomationTriggerConfig,
  AutomationTriggerType,
} from '@/types'

// ------------------------------------------------------------
// Starter automations.
//
// Seed content for a used-vehicle dealership, in neutral Latin
// American Spanish. The gallery's labels are NOT here: `name` and
// `description` are interface text and live in the catalogue under
// `Automations.templates.<slug>`. What stays here is what gets copied
// into the operator's own rows on clone.
//
// ── The one rule that keeps these coherent ───────────────────
// A flow talks; an automation acts. The webhook fires relationship
// triggers (`first_inbound_message`, `new_contact_created`) even when a
// flow already consumed the message — deliberately, since those are
// about WHO wrote, not WHAT they wrote. So an automation that sends on
// the same trigger as a live flow greets the customer twice.
//
// These templates are safe on their own; the conflict is a
// configuration state, and the activation check warns about it by name
// rather than forbidding it.
// ------------------------------------------------------------

export type TemplateSlug =
  | 'welcome_message'
  | 'out_of_office'
  | 'lead_qualifier'
  | 'follow_up_reminder'
  | 'deal_on_qualified'

export interface TemplateStepSeed {
  step_type: AutomationStepType
  step_config: AutomationStepConfig
  branch?: 'yes' | 'no' | null
  /** Index (within this seed list) of the Condition parent, if nested. */
  parent_index?: number | null
}

export interface AutomationTemplateDefinition {
  slug: TemplateSlug
  trigger_type: AutomationTriggerType
  trigger_config: AutomationTriggerConfig
  steps: TemplateStepSeed[]
}

export const AUTOMATION_TEMPLATES: Record<TemplateSlug, AutomationTemplateDefinition> = {
  welcome_message: {
    slug: 'welcome_message',
    // first_inbound_message (added in PR #33) catches both brand-new
    // contacts AND manually-added/imported contacts on their first-ever
    // reply, which is what a user setting up a "welcome" automation
    // almost always wants. new_contact_created would miss the
    // manually-imported case.
    trigger_type: 'first_inbound_message',
    trigger_config: {},
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text: '¡Hola! 👋 Gracias por escribirnos. En un momento te atiende un asesor.',
        },
      },
      {
        // Vacío a propósito: el id de la etiqueta es de cada cuenta.
        step_type: 'add_tag',
        step_config: { tag_id: '' },
      },
    ],
  },
  out_of_office: {
    slug: 'out_of_office',
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'condition',
        step_config: {
          subject: 'time_of_day',
          operand: '18:00-08:00',
        },
      },
      {
        step_type: 'send_message',
        step_config: {
          text: '¡Gracias por escribirnos! Ahora estamos fuera de horario. Atendemos de lunes a viernes de 8:00 a 18:00 y te respondemos apenas abramos.',
        },
        parent_index: 0,
        branch: 'yes',
      },
    ],
  },
  lead_qualifier: {
    slug: 'lead_qualifier',
    trigger_type: 'keyword_match',
    trigger_config: {
      // En español, que es lo que escribe el cliente. Las palabras en
      // inglés que traía esta plantilla ("pricing", "quote", "buy") no
      // coincidían nunca.
      keywords: ['precio', 'cuanto', 'cotizacion', 'financiacion', 'cuota'],
      match_type: 'contains',
    },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text: '¡Con gusto te ayudamos! ¿Qué vehículo te interesa? Dime marca, modelo y año, o el código del aviso.',
        },
      },
      // Sin espera previa: asignar diez minutos después llegaba tarde,
      // cuando alguien ya había tomado la conversación a mano. Se asigna
      // en el momento en que entra la consulta.
      {
        step_type: 'assign_conversation',
        step_config: { mode: 'round_robin' },
      },
    ],
  },
  follow_up_reminder: {
    slug: 'follow_up_reminder',
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'wait',
        step_config: { amount: 1, unit: 'days' },
      },
      {
        step_type: 'send_message',
        step_config: {
          text: '¡Hola! Te escribo para saber si sigues interesado o si te quedó alguna duda. Quedo atento.',
        },
      },
    ],
  },
  deal_on_qualified: {
    slug: 'deal_on_qualified',
    // El negocio se registra cuando el prospecto queda calificado, no
    // cuando alguien saluda. La versión anterior creaba un negocio con
    // cada primer mensaje entrante, antes de saber siquiera qué auto
    // buscaba la persona.
    trigger_type: 'tag_added',
    // El id de la etiqueta de calificación es de cada cuenta; se elige
    // en el editor antes de activar.
    trigger_config: { tag_id: '' },
    steps: [
      {
        step_type: 'create_deal',
        step_config: {
          pipeline_id: '',
          stage_id: '',
          title: 'Prospecto calificado',
          // Sin valorar. El presupuesto que declara el cliente es un
          // rango elegido de una lista, no un precio, y `create_deal`
          // tampoco interpola `value`. El asesor pone la cifra cuando
          // toma la conversación, que es cuando tiene delante la nota
          // con el rango declarado. Inventar un importe fijo fue el
          // defecto que esto corrige.
          value: 0,
        },
      },
    ],
  },
}

export function getTemplate(slug: string): AutomationTemplateDefinition | null {
  return AUTOMATION_TEMPLATES[slug as TemplateSlug] ?? null
}
