/**
 * ¿Sirve esta plantilla como recordatorio de esta otra?
 *
 * El recordatorio lo manda el cron, sin nadie delante que pueda aportar
 * un dato. Solo tiene lo que la difusión dejó congelado por destinatario
 * (`broadcast_recipients.template_params`, migración 038), así que la
 * plantilla tiene que poder enviarse con eso o con nada:
 *
 *   - Cuerpo: sin variables, o con las MISMAS que el original — entonces
 *     se reutilizan sus valores. Otro número no tendría de dónde salir.
 *   - Encabezado: ni multimedia (pide el enlace del archivo) ni de texto
 *     con variable (pide su valor).
 *   - Botones: ninguno que pida un valor, o sea un URL con variable.
 *
 * Se valida en el asistente, antes de crear la difusión: un recordatorio
 * que no se puede enviar fallaría días después, para todos a la vez.
 */

import type { MessageTemplate } from '@/types';
import { extractVariableIndices } from './template-validators';
import { buttonRequiresCallerValue } from './template-send-builder';

export type FollowUpTemplateProblem =
  | 'variable_mismatch'
  | 'media_header'
  | 'header_variable'
  | 'button_needs_value';

export type FollowUpTemplateCheck =
  /** `sendsParams`: el recordatorio lleva los valores del original. */
  | { ok: true; sendsParams: boolean }
  | { ok: false; problem: FollowUpTemplateProblem };

export function checkFollowUpTemplate(
  original: MessageTemplate,
  followUp: MessageTemplate
): FollowUpTemplateCheck {
  const header = followUp.header_type;
  if (header === 'image' || header === 'video' || header === 'document') {
    return { ok: false, problem: 'media_header' };
  }
  if (
    header === 'text' &&
    extractVariableIndices(followUp.header_content ?? '').length > 0
  ) {
    return { ok: false, problem: 'header_variable' };
  }

  if ((followUp.buttons ?? []).some(buttonRequiresCallerValue)) {
    return { ok: false, problem: 'button_needs_value' };
  }

  const followUpVars = extractVariableIndices(followUp.body_text).length;
  if (followUpVars === 0) return { ok: true, sendsParams: false };

  const originalVars = extractVariableIndices(original.body_text).length;
  if (followUpVars !== originalVars) {
    return { ok: false, problem: 'variable_mismatch' };
  }
  return { ok: true, sendsParams: true };
}
