import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENDA_HOURS, freeSlots, resolveAgendaHours, type AgendaHours } from './slots';

// Fechas construidas en hora local: las pruebas no dependen de la TZ.
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m);
const hhmm = (dates: Date[]) =>
  dates.map((d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);

const LORA: AgendaHours = {
  hours: {
    sun: null,
    mon: ['08:00', '18:00'],
    tue: ['08:00', '18:00'],
    wed: ['08:00', '18:00'],
    thu: ['08:00', '18:00'],
    fri: ['08:00', '18:00'],
    sat: ['08:00', '14:00'],
  },
  holidayCalendar: 'CO',
};

describe('freeSlots', () => {
  it('quita las horas ocupadas y deja las vecinas', () => {
    // Martes 6 de octubre de 2026 no; el 6 es martes en 2026.
    const day = at(6, 0);
    const slots = hhmm(
      freeSlots({
        day,
        agenda: LORA,
        durationMinutes: 30,
        busy: [
          { starts_at: at(6, 9), ends_at: at(6, 9, 30) },
          { starts_at: at(6, 12), ends_at: at(6, 12, 30) },
        ],
      })
    );
    expect(slots).not.toContain('09:00');
    expect(slots).not.toContain('12:00');
    expect(slots).toContain('09:30');
    expect(slots).toContain('17:30');
    expect(slots[0]).toBe('08:00');
    expect(slots).toHaveLength(20 - 2);
  });

  it('no ofrece una cita que no cabe antes del cierre', () => {
    const slots = hhmm(freeSlots({ day: at(6, 0), agenda: LORA, durationMinutes: 60, busy: [] }));
    expect(slots.at(-1)).toBe('17:00');
  });

  it('una cita larga bloquea todas las franjas que pisa', () => {
    const slots = hhmm(
      freeSlots({
        day: at(6, 0),
        agenda: LORA,
        durationMinutes: 60,
        busy: [{ starts_at: at(6, 10), ends_at: at(6, 11) }],
      })
    );
    // 9:30–10:30 y 10:00–11:00 y 10:30–11:30 chocan; 9:00 y 11:00 no.
    expect(slots).toContain('09:00');
    expect(slots).not.toContain('09:30');
    expect(slots).not.toContain('10:30');
    expect(slots).toContain('11:00');
  });

  it('domingo cerrado: nada', () => {
    // 4 de octubre de 2026 es domingo.
    expect(freeSlots({ day: at(4, 0), agenda: LORA, durationMinutes: 30, busy: [] })).toEqual([]);
  });

  it('festivo colombiano: nada', () => {
    // 12 de octubre de 2026 (Día de la Raza) cae lunes.
    expect(freeSlots({ day: at(12, 0), agenda: LORA, durationMinutes: 30, busy: [] })).toEqual([]);
  });

  it('el sábado corto cierra a las 14:00', () => {
    const slots = hhmm(freeSlots({ day: at(10, 0), agenda: LORA, durationMinutes: 30, busy: [] }));
    expect(slots.at(-1)).toBe('13:30');
  });

  it('la cita que se edita no se estorba a sí misma', () => {
    const slots = hhmm(
      freeSlots({
        day: at(6, 0),
        agenda: LORA,
        durationMinutes: 30,
        busy: [{ id: 'a', starts_at: at(6, 9), ends_at: at(6, 9, 30) }],
        ignoreId: 'a',
      })
    );
    expect(slots).toContain('09:00');
  });

  it('con `now` no ofrece horas pasadas', () => {
    const slots = hhmm(
      freeSlots({ day: at(6, 0), agenda: LORA, durationMinutes: 30, busy: [], now: at(6, 15, 10) })
    );
    expect(slots[0]).toBe('15:30');
  });
});

describe('resolveAgendaHours', () => {
  it('sin horario configurado usa L–S 8:00–18:00', () => {
    expect(resolveAgendaHours({ business_hours: {}, holiday_calendar: null })).toEqual({
      hours: DEFAULT_AGENDA_HOURS,
      holidayCalendar: null,
    });
    expect(resolveAgendaHours(null).hours).toEqual(DEFAULT_AGENDA_HOURS);
  });

  it('con horario configurado lo respeta', () => {
    const r = resolveAgendaHours({
      business_hours: { mon: ['09:00', '17:00'] },
      holiday_calendar: 'CO',
    });
    expect(r.hours.mon).toEqual(['09:00', '17:00']);
    expect(r.hours.tue).toBeNull();
    expect(r.holidayCalendar).toBe('CO');
  });
});
