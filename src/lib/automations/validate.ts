import type { AutomationTriggerType } from '@/types'
import { validateInteractivePayload } from '@/lib/whatsapp/interactive'

// ------------------------------------------------------------
// Pre-flight config validation for automations about to be activated.
//
// Activating a broken automation (e.g. an add_tag step with tag_id="")
// used to succeed silently — every trigger then produced a failed log
// row with a cryptic "add_tag needs contact + tag_id" message, and
// users often didn't notice until reviewing logs. This module lets
// the API refuse activation with a useful 400 response instead.
//
// The rules here mirror the runtime checks in engine.ts's runStep;
// they're the same invariants, enforced one step earlier so failures
// surface at save time.
// ------------------------------------------------------------

/**
 * Every problem this module can report.
 *
 * Codes, not sentences: this runs on the server during activation,
 * where there is no user locale to write in. The wording lives in the
 * catalogue under `Automations.validation.issues.<code>`.
 */
export type AutomationValidationCode =
  | 'stepsRequired'
  | 'messageTextRequired'
  | 'interactiveInvalid'
  | 'templateNameRequired'
  | 'tagRequired'
  | 'agentRequiredForSpecific'
  | 'fieldNameRequired'
  | 'fieldValueRequired'
  | 'pipelineRequired'
  | 'stageRequired'
  | 'titleRequired'
  | 'waitAmountPositive'
  | 'waitUnitInvalid'
  | 'conditionSubjectRequired'
  | 'conditionOperandRequired'
  | 'webhookUrlRequired'
  | 'webhookUrlScheme'
  | 'webhookUrlInvalid'
  | 'unknownStepType'
  | 'triggerKeywordsRequired'
  | 'triggerKeywordsEmpty'
  | 'triggerMatchTypeInvalid'
  | 'triggerScheduleRequired'
  | 'triggerTagRequired'
  | 'triggerReplyIdsRequired'
  | 'triggerReplyIdsEmpty'

export interface ValidationIssue {
  /** Dot-path for the UI to highlight; stable enough to build a table. */
  path: string
  /** What went wrong. Resolved to a sentence by the renderer. */
  code: AutomationValidationCode
  /** Values the sentence interpolates. */
  params?: Record<string, string | number>
}

interface StepLike {
  step_type: string
  step_config: Record<string, unknown>
  branches?: { yes?: StepLike[]; no?: StepLike[] }
}

export function validateStepsForActivation(steps: StepLike[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!Array.isArray(steps) || steps.length === 0) {
    issues.push({
      path: 'steps',
      code: 'stepsRequired',
    })
    return issues
  }
  walk(steps, '', issues)
  return issues
}

function walk(steps: StepLike[], prefix: string, issues: ValidationIssue[]): void {
  steps.forEach((s, i) => {
    const path = `${prefix}steps[${i}]`
    validateOne(s, path, issues)
    if (s.step_type === 'condition' && s.branches) {
      if (s.branches.yes) walk(s.branches.yes, `${path}.yes.`, issues)
      if (s.branches.no) walk(s.branches.no, `${path}.no.`, issues)
    }
  })
}

function validateOne(step: StepLike, path: string, issues: ValidationIssue[]): void {
  const c = step.step_config ?? {}
  switch (step.step_type) {
    case 'send_message':
      if (!nonEmpty(c.text)) {
        issues.push({ path: `${path}.text`, code: 'messageTextRequired' })
      }
      break
    case 'send_buttons':
    case 'send_list': {
      // The whole step_config IS the interactive payload; validate it
      // against Meta's limits (same check the engine runs before send).
      const result = validateInteractivePayload(c)
      if (!result.ok) {
        // `validateInteractivePayload` is shared with quick replies, the
        // composer and the interactive builder, and still returns English
        // prose. Translating it is a wider change than this one; until
        // then its text rides along as a detail so the operator at least
        // sees what Meta objected to.
        issues.push({
          path: `${path}.interactive`,
          code: 'interactiveInvalid',
          params: { detail: result.error },
        })
      }
      break
    }
    case 'send_template':
      if (!nonEmpty(c.template_name)) {
        issues.push({ path: `${path}.template_name`, code: 'templateNameRequired' })
      }
      break
    case 'add_tag':
    case 'remove_tag':
      if (!nonEmpty(c.tag_id)) {
        issues.push({ path: `${path}.tag_id`, code: 'tagRequired' })
      }
      break
    case 'assign_conversation':
      if (c.mode === 'specific' && !nonEmpty(c.agent_id)) {
        issues.push({
          path: `${path}.agent_id`,
          code: 'agentRequiredForSpecific',
        })
      }
      break
    case 'update_contact_field':
      if (!nonEmpty(c.field)) {
        issues.push({ path: `${path}.field`, code: 'fieldNameRequired' })
      }
      if (c.value === undefined || c.value === null || c.value === '') {
        issues.push({ path: `${path}.value`, code: 'fieldValueRequired' })
      }
      break
    case 'create_deal':
      if (!nonEmpty(c.pipeline_id)) {
        issues.push({ path: `${path}.pipeline_id`, code: 'pipelineRequired' })
      }
      if (!nonEmpty(c.stage_id)) {
        issues.push({ path: `${path}.stage_id`, code: 'stageRequired' })
      }
      if (!nonEmpty(c.title)) {
        issues.push({ path: `${path}.title`, code: 'titleRequired' })
      }
      break
    case 'move_deal_stage':
      // Sin titulo ni valor: el paso mueve un negocio que ya existe.
      if (!nonEmpty(c.pipeline_id)) {
        issues.push({ path: `${path}.pipeline_id`, code: 'pipelineRequired' })
      }
      if (!nonEmpty(c.stage_id)) {
        issues.push({ path: `${path}.stage_id`, code: 'stageRequired' })
      }
      break
    case 'wait':
      if (typeof c.amount !== 'number' || !Number.isFinite(c.amount) || c.amount <= 0) {
        issues.push({ path: `${path}.amount`, code: 'waitAmountPositive' })
      }
      if (!['minutes', 'hours', 'days'].includes(String(c.unit))) {
        issues.push({
          path: `${path}.unit`,
          code: 'waitUnitInvalid',
        })
      }
      break
    case 'condition':
      if (!nonEmpty(c.subject)) {
        issues.push({ path: `${path}.subject`, code: 'conditionSubjectRequired' })
      }
      if (!nonEmpty(c.operand)) {
        issues.push({ path: `${path}.operand`, code: 'conditionOperandRequired' })
      }
      break
    case 'send_webhook':
      if (!nonEmpty(c.url)) {
        issues.push({ path: `${path}.url`, code: 'webhookUrlRequired' })
        break
      }
      try {
        const u = new URL(String(c.url))
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          issues.push({
            path: `${path}.url`,
            code: 'webhookUrlScheme',
          })
        }
      } catch {
        issues.push({ path: `${path}.url`, code: 'webhookUrlInvalid' })
      }
      break
    case 'close_conversation':
      // No config required.
      break
    default:
      issues.push({ path, code: 'unknownStepType', params: { stepType: step.step_type } })
  }
}

export function validateTriggerForActivation(
  triggerType: AutomationTriggerType | string,
  triggerConfig: unknown,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const cfg = (triggerConfig ?? {}) as Record<string, unknown>

  if (triggerType === 'keyword_match') {
    const k = cfg.keywords
    if (!Array.isArray(k) || k.length === 0) {
      issues.push({ path: 'trigger.keywords', code: 'triggerKeywordsRequired' })
    } else if (k.some((v) => typeof v !== 'string' || v.trim() === '')) {
      issues.push({ path: 'trigger.keywords', code: 'triggerKeywordsEmpty' })
    }
    // A missing match_type defaults to "contains" at runtime (see
    // automations/engine.ts and flows/engine.ts, which both read
    // `match_type ?? "contains"`), so only an explicit, unrecognised
    // value is invalid here. This keeps activation validation in step
    // with the engine and with the builder's "Contains" default — an
    // automation that shows the default in the UI must not be rejected.
    if (
      cfg.match_type != null &&
      cfg.match_type !== 'exact' &&
      cfg.match_type !== 'contains' &&
      cfg.match_type !== 'word'
    ) {
      issues.push({
        path: 'trigger.match_type',
        code: 'triggerMatchTypeInvalid',
      })
    }
  } else if (triggerType === 'time_based') {
    if (!nonEmpty(cfg.schedule)) {
      issues.push({ path: 'trigger.schedule', code: 'triggerScheduleRequired' })
    }
  } else if (triggerType === 'tag_added') {
    if (!nonEmpty(cfg.tag_id)) {
      issues.push({ path: 'trigger.tag_id', code: 'triggerTagRequired' })
    }
  } else if (triggerType === 'interactive_reply') {
    const ids = cfg.reply_ids
    if (!Array.isArray(ids) || ids.length === 0) {
      issues.push({
        path: 'trigger.reply_ids',
        code: 'triggerReplyIdsRequired',
      })
    } else if (ids.some((v) => typeof v !== 'string' || v.trim() === '')) {
      issues.push({
        path: 'trigger.reply_ids',
        code: 'triggerReplyIdsEmpty',
      })
    }
  }

  return issues
}

function nonEmpty(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0
}
