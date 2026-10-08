import { describe, expect, it } from 'vitest';
import type { MessageTemplate } from '@/types';
import { checkAppointmentTemplate } from './templates';

type T = Parameters<typeof checkAppointmentTemplate>[0];

const base: T = {
  status: 'APPROVED',
  header_type: undefined,
  header_content: undefined,
  body_text: 'Hola {{1}}, tu visita es el {{2}} con {{3}}.',
  buttons: [],
};

const reminderButtons: MessageTemplate['buttons'] = [
  { type: 'QUICK_REPLY', text: 'Confirmo' },
  { type: 'QUICK_REPLY', text: 'Necesito cambiar la hora' },
];

describe('checkAppointmentTemplate', () => {
  it('confirmación válida con tres variables', () => {
    expect(checkAppointmentTemplate(base, 'confirmation')).toEqual({ ok: true, variableCount: 3 });
  });

  it('sin variables también sirve', () => {
    expect(
      checkAppointmentTemplate({ ...base, body_text: 'Tu visita quedó agendada.' }, 'confirmation')
    ).toEqual({ ok: true, variableCount: 0 });
  });

  it('rechaza una plantilla no aprobada', () => {
    expect(checkAppointmentTemplate({ ...base, status: 'PENDING' }, 'confirmation')).toEqual({
      ok: false,
      problem: 'not_approved',
    });
  });

  it('rechaza encabezado multimedia', () => {
    expect(checkAppointmentTemplate({ ...base, header_type: 'image' }, 'confirmation')).toEqual({
      ok: false,
      problem: 'media_header',
    });
  });

  it('rechaza encabezado de texto con variable', () => {
    expect(
      checkAppointmentTemplate(
        { ...base, header_type: 'text', header_content: 'Hola {{1}}' },
        'confirmation'
      )
    ).toEqual({ ok: false, problem: 'header_variable' });
  });

  it('rechaza más de cuatro variables', () => {
    expect(
      checkAppointmentTemplate(
        { ...base, body_text: '{{1}} {{2}} {{3}} {{4}} {{5}}' },
        'confirmation'
      )
    ).toEqual({ ok: false, problem: 'too_many_variables' });
  });

  it('rechaza variables salteadas', () => {
    expect(
      checkAppointmentTemplate({ ...base, body_text: 'Hola {{1}}, con {{3}}' }, 'confirmation')
    ).toEqual({ ok: false, problem: 'variables_not_consecutive' });
  });

  it('rechaza un botón URL con variable en la confirmación', () => {
    expect(
      checkAppointmentTemplate(
        { ...base, buttons: [{ type: 'URL', text: 'Ver', url: 'https://x.co/{{1}}' }] },
        'confirmation'
      )
    ).toEqual({ ok: false, problem: 'button_needs_value' });
  });

  it('recordatorio válido con los dos botones', () => {
    expect(checkAppointmentTemplate({ ...base, buttons: reminderButtons }, 'reminder')).toEqual({
      ok: true,
      variableCount: 3,
    });
  });

  it('recordatorio sin botones o con otros botones', () => {
    expect(checkAppointmentTemplate(base, 'reminder')).toEqual({
      ok: false,
      problem: 'reminder_buttons',
    });
    expect(
      checkAppointmentTemplate(
        {
          ...base,
          buttons: [
            { type: 'QUICK_REPLY', text: 'Confirmo' },
            { type: 'URL', text: 'Ver', url: 'https://x.co' },
          ],
        },
        'reminder'
      )
    ).toEqual({ ok: false, problem: 'reminder_buttons' });
  });
});
