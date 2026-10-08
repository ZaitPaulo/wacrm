// ============================================================
// ¿Sirve esta plantilla para la Agenda?
//
// La confirmación y el recordatorio los manda el cron, sin nadie
// delante que aporte un dato. Por eso el contrato es fijo y se valida
// en Ajustes, al elegirla, y no días después cuando el envío falle:
//
//   - Aprobada por Meta.
//   - Sin encabezado multimedia (pediría el archivo) ni de texto con
//     variable (pediría su valor).
//   - Cuerpo con 0 a 4 variables, siempre las primeras N, en este orden:
//       {{1}} nombre del cliente
//       {{2}} fecha y hora de la cita
//       {{3}} nombre completo del asesor
//       {{4}} vehículo(s)
//   - Recordatorio: exactamente dos botones de respuesta rápida. El
//     primero confirma y el segundo pide cambiar la hora; su payload lo
//     fija el cron en cada envío (`messages.ts`).
// ============================================================

import type { MessageTemplate } from '@/types';
import { extractVariableIndices } from '@/lib/whatsapp/template-validators';

export const APPOINTMENT_TEMPLATE_MAX_VARIABLES = 4;

export type AppointmentTemplateKind = 'confirmation' | 'reminder';

export type AppointmentTemplateProblem =
  | 'not_approved'
  | 'media_header'
  | 'header_variable'
  | 'too_many_variables'
  | 'variables_not_consecutive'
  | 'reminder_buttons'
  | 'button_needs_value';

export type AppointmentTemplateCheck =
  | { ok: true; variableCount: number }
  | { ok: false; problem: AppointmentTemplateProblem };

export function checkAppointmentTemplate(
  template: Pick<
    MessageTemplate,
    'status' | 'header_type' | 'header_content' | 'body_text' | 'buttons'
  >,
  kind: AppointmentTemplateKind
): AppointmentTemplateCheck {
  if (template.status !== 'APPROVED') return { ok: false, problem: 'not_approved' };

  const header = template.header_type;
  if (header === 'image' || header === 'video' || header === 'document') {
    return { ok: false, problem: 'media_header' };
  }
  if (header === 'text' && extractVariableIndices(template.header_content ?? '').length > 0) {
    return { ok: false, problem: 'header_variable' };
  }

  const indices = [...new Set(extractVariableIndices(template.body_text))].sort((a, b) => a - b);
  if (indices.length > APPOINTMENT_TEMPLATE_MAX_VARIABLES) {
    return { ok: false, problem: 'too_many_variables' };
  }
  if (indices.some((n, i) => n !== i + 1)) {
    return { ok: false, problem: 'variables_not_consecutive' };
  }

  const buttons = template.buttons ?? [];
  if (kind === 'reminder') {
    if (buttons.length !== 2 || buttons.some((b) => b.type !== 'QUICK_REPLY')) {
      return { ok: false, problem: 'reminder_buttons' };
    }
  } else if (
    buttons.some(
      (b) =>
        b.type === 'URL' && extractVariableIndices(b.url ?? '').length > 0
    )
  ) {
    // Un botón URL con variable pediría un valor que el cron no tiene.
    return { ok: false, problem: 'button_needs_value' };
  }

  return { ok: true, variableCount: indices.length };
}
