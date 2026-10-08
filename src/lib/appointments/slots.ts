// ============================================================
// Franjas libres de un asesor en un día.
//
// Solo GUÍA al formulario: el árbitro de verdad es la restricción
// `appointments_no_overlap` de la base, que rechaza una cita cruzada
// aunque dos personas hayan visto la misma franja libre a la vez.
// ============================================================

import {
  franjaDelDia,
  parseHorario,
  type HorarioSemanal,
} from '@/lib/outbound/business-hours';

/** Las franjas empiezan cada media hora. */
export const SLOT_STEP_MINUTES = 30;

/**
 * Horario que usa la Agenda cuando la cuenta no configuró el suyo:
 * lunes a sábado de 8:00 a 18:00. Sin esto, una cuenta nueva no podría
 * agendar nada.
 */
export const DEFAULT_AGENDA_HOURS: HorarioSemanal = {
  sun: null,
  mon: ['08:00', '18:00'],
  tue: ['08:00', '18:00'],
  wed: ['08:00', '18:00'],
  thu: ['08:00', '18:00'],
  fri: ['08:00', '18:00'],
  sat: ['08:00', '18:00'],
};

export interface AgendaHours {
  hours: HorarioSemanal;
  holidayCalendar: 'CO' | null;
}

/**
 * El horario de la Agenda a partir de las columnas de `accounts`.
 *
 * Se usa `business_hours` aunque el silencio fuera de horario
 * (`quiet_hours_enabled`) esté apagado: son las horas en que el
 * concesionario atiende, que es lo que importa para recibir visitas. Si
 * no hay ningún día configurado, vale `DEFAULT_AGENDA_HOURS`.
 */
export function resolveAgendaHours(account: {
  business_hours?: unknown;
  holiday_calendar?: string | null;
} | null): AgendaHours {
  const parsed = parseHorario(account?.business_hours);
  const hasAny = Object.values(parsed).some((f) => f !== null);
  return {
    hours: hasAny ? parsed : DEFAULT_AGENDA_HOURS,
    holidayCalendar: account?.holiday_calendar === 'CO' ? 'CO' : null,
  };
}

/** Apertura y cierre del día, o null si está cerrado. */
export function openingOf(day: Date, agenda: AgendaHours): { start: Date; end: Date } | null {
  const franja = franjaDelDia(agenda.hours, day, agenda.holidayCalendar);
  if (!franja) return null;
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, franja.desde);
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, franja.hasta);
  return { start, end };
}

export interface BusyInterval {
  id?: string;
  starts_at: string | Date;
  ends_at: string | Date;
}

export interface FreeSlotsArgs {
  day: Date;
  agenda: AgendaHours;
  durationMinutes: number;
  /** Citas ACTIVAS del asesor ese día. */
  busy: BusyInterval[];
  /** La cita que se está editando: no se estorba a sí misma. */
  ignoreId?: string;
  /** Si se pasa, no se ofrecen horas que ya pasaron. */
  now?: Date;
}

/**
 * Inicios posibles, cada 30 minutos, en que la cita completa cabe dentro
 * del horario del día y no se cruza con otra cita del asesor.
 */
export function freeSlots(args: FreeSlotsArgs): Date[] {
  const { day, agenda, durationMinutes, busy, ignoreId, now } = args;
  const opening = openingOf(day, agenda);
  if (!opening || durationMinutes <= 0) return [];

  const taken = busy
    .filter((b) => !ignoreId || b.id !== ignoreId)
    .map((b) => ({
      start: new Date(b.starts_at).getTime(),
      end: new Date(b.ends_at).getTime(),
    }));

  const durationMs = durationMinutes * 60_000;
  const stepMs = SLOT_STEP_MINUTES * 60_000;
  const out: Date[] = [];

  for (
    let t = opening.start.getTime();
    t + durationMs <= opening.end.getTime();
    t += stepMs
  ) {
    if (now && t < now.getTime()) continue;
    const end = t + durationMs;
    // Intervalos semiabiertos [inicio, fin): una cita que termina a las
    // 9:30 no estorba a la que empieza a las 9:30, igual que en la base.
    const clash = taken.some((b) => t < b.end && b.start < end);
    if (!clash) out.push(new Date(t));
  }
  return out;
}
