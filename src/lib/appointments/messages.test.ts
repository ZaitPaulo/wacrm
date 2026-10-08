import { describe, expect, it } from 'vitest';
import {
  buildConfirmationText,
  buildReminderPayload,
  buildTemplateVariables,
  changeRequestedReplyText,
  confirmedReplyText,
  isAppointmentPayload,
  parseReminderPayload,
  reminderButtonParams,
  startsAtEpoch,
  vehiclesLabel,
} from './messages';
import { formatAppointmentWhen, fromDayKey, toDayKey } from './format';

const ID = '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90';
// Martes 7 de octubre de 2026, 2:00 p. m. hora local.
const STARTS = new Date(2026, 9, 7, 14, 0);

const ctx = {
  contactName: 'Jorge Castro',
  startsAt: STARTS,
  agentName: 'Angélica Rodríguez',
  vehicles: ['Chevrolet Tracker 2021'],
  address: 'Calle 80 # 20-10',
  businessName: 'Lora Motors',
};

describe('format', () => {
  it('fecha en español como la escribe la base', () => {
    expect(formatAppointmentWhen(STARTS)).toBe('miércoles 7 de octubre, 2:00 p. m.');
    expect(formatAppointmentWhen(new Date(2026, 9, 6, 9, 30))).toBe('martes 6 de octubre, 9:30 a. m.');
    expect(formatAppointmentWhen(new Date(2026, 9, 6, 12, 0))).toBe('martes 6 de octubre, 12:00 p. m.');
    expect(formatAppointmentWhen(new Date(2026, 9, 6, 0, 15))).toBe('martes 6 de octubre, 12:15 a. m.');
  });

  it('clave de día ida y vuelta', () => {
    expect(toDayKey(STARTS)).toBe('2026-10-07');
    expect(fromDayKey('2026-10-07')?.getTime()).toBe(new Date(2026, 9, 7).getTime());
    expect(fromDayKey('2026-02-31')).toBeNull();
    expect(fromDayKey('ayer')).toBeNull();
  });
});

describe('buildConfirmationText', () => {
  it('lleva fecha, vehículo, lugar y asesor', () => {
    expect(buildConfirmationText(ctx)).toBe(
      [
        '✅ *Tu visita quedó agendada*',
        '📅 miércoles 7 de octubre, 2:00 p. m.',
        '🚗 Chevrolet Tracker 2021',
        '📍 Lora Motors, Calle 80 # 20-10',
        'Pregunta por tu asesor Angélica Rodríguez.',
      ].join('\n')
    );
  });

  it('omite lo que falta', () => {
    expect(
      buildConfirmationText({ ...ctx, vehicles: [], address: null, businessName: null, agentName: null })
    ).toBe('✅ *Tu visita quedó agendada*\n📅 miércoles 7 de octubre, 2:00 p. m.');
  });
});

describe('vehiclesLabel', () => {
  it('une con comas y "y"', () => {
    expect(vehiclesLabel([])).toBe('');
    expect(vehiclesLabel(['A'])).toBe('A');
    expect(vehiclesLabel(['A', 'B', 'C'])).toBe('A, B y C');
  });
});

describe('buildTemplateVariables', () => {
  it('respeta el orden fijo y recorta', () => {
    expect(buildTemplateVariables(ctx, 4)).toEqual([
      'Jorge',
      'miércoles 7 de octubre, 2:00 p. m.',
      'Angélica Rodríguez',
      'Chevrolet Tracker 2021',
    ]);
    expect(buildTemplateVariables(ctx, 2)).toHaveLength(2);
    expect(buildTemplateVariables(ctx, 0)).toEqual([]);
  });

  it('nunca manda un parámetro vacío', () => {
    const vars = buildTemplateVariables(
      { ...ctx, contactName: null, agentName: '  ', vehicles: [] },
      4
    );
    expect(vars.every((v) => v.trim().length > 0)).toBe(true);
  });
});

describe('payload del recordatorio', () => {
  it('ida y vuelta', () => {
    const payload = buildReminderPayload(ID, 'confirmar', STARTS);
    expect(payload).toBe(`cita:${ID}:confirmar:${startsAtEpoch(STARTS)}`);
    expect(parseReminderPayload(payload)).toEqual({
      appointmentId: ID,
      action: 'confirmar',
      epoch: startsAtEpoch(STARTS),
    });
  });

  it('un botón por índice', () => {
    const params = reminderButtonParams(ID, STARTS);
    expect(parseReminderPayload(params[0])?.action).toBe('confirmar');
    expect(parseReminderPayload(params[1])?.action).toBe('cambiar');
  });

  it('rechaza payloads ajenos o mal formados', () => {
    expect(parseReminderPayload('Confirmo')).toBeNull();
    expect(parseReminderPayload(`cita:${ID}:borrar:1`)).toBeNull();
    expect(parseReminderPayload('cita:no-es-uuid:confirmar:1')).toBeNull();
    expect(parseReminderPayload(null)).toBeNull();
    expect(isAppointmentPayload('flow:menu')).toBe(false);
    expect(isAppointmentPayload(`cita:${ID}:confirmar:1`)).toBe(true);
  });
});

describe('acuses', () => {
  it('confirmó', () => {
    expect(confirmedReplyText(STARTS)).toBe(
      '¡Listo! Te esperamos el miércoles 7 de octubre a las 2:00 p. m. 🙌'
    );
  });

  it('pidió cambio', () => {
    expect(changeRequestedReplyText('Angélica Rodríguez')).toBe(
      'Entendido. Tu asesor Angélica Rodríguez te escribirá para buscar otra hora. 👍'
    );
    expect(changeRequestedReplyText(null)).toBe(
      'Entendido. Tu asesor te escribirá para buscar otra hora. 👍'
    );
  });
});
