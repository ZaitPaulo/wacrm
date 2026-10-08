// ============================================================
// Lo que se le dice al cliente sobre su cita, y cómo se reconocen los
// botones del recordatorio cuando vuelven por el webhook.
//
// Todo puro: el cron y el manejador de respuestas arman el contexto y
// esto solo devuelve texto. Así cada frase se prueba sin Meta ni base.
// ============================================================

import { formatAppointmentTime, formatAppointmentWhen } from './format';
import type { AppointmentPurpose } from './types';

export interface AppointmentMessageContext {
  /** Nombre del cliente tal como está en el contacto. */
  contactName: string | null;
  startsAt: Date | string;
  /** Nombre completo del asesor. */
  agentName: string | null;
  /** "Chevrolet Tracker 2021", ya formateados. */
  vehicles: string[];
  /** Dirección pública del negocio (`accounts.public_address`). */
  address: string | null;
  /** Nombre público del negocio (`accounts.public_name`). */
  businessName: string | null;
}

function firstName(name: string | null): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}

export function vehiclesLabel(vehicles: string[]): string {
  const clean = vehicles.map((v) => v.trim()).filter(Boolean);
  if (clean.length <= 1) return clean[0] ?? '';
  return `${clean.slice(0, -1).join(', ')} y ${clean.at(-1)}`;
}

/** Texto libre de confirmación, para cuando la ventana de 24 h está abierta. */
export function buildConfirmationText(ctx: AppointmentMessageContext): string {
  const lines = ['✅ *Tu visita quedó agendada*', `📅 ${formatAppointmentWhen(ctx.startsAt)}`];
  const vehicles = vehiclesLabel(ctx.vehicles);
  if (vehicles) lines.push(`🚗 ${vehicles}`);
  const place = [ctx.businessName?.trim(), ctx.address?.trim()].filter(Boolean).join(', ');
  if (place) lines.push(`📍 ${place}`);
  if (ctx.agentName?.trim()) lines.push(`Pregunta por tu asesor ${ctx.agentName.trim()}.`);
  return lines.join('\n');
}

/**
 * Valores de las variables de la plantilla, en el orden fijo del
 * contrato (`templates.ts`), recortados a las que la plantilla usa.
 * Meta rechaza un parámetro vacío: cada uno lleva un respaldo.
 */
export function buildTemplateVariables(
  ctx: AppointmentMessageContext,
  variableCount: number
): string[] {
  const all = [
    firstName(ctx.contactName) ?? 'cliente',
    formatAppointmentWhen(ctx.startsAt),
    ctx.agentName?.trim() || 'nuestro equipo',
    vehiclesLabel(ctx.vehicles) || 'nuestros vehículos',
  ];
  return all.slice(0, Math.max(0, variableCount));
}

// ------------------------------------------------------------
// Botones del recordatorio
// ------------------------------------------------------------

export type ReminderAction = 'confirmar' | 'cambiar';

const PAYLOAD_RE =
  /^cita:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(confirmar|cambiar):(\d+)$/i;

/** Segundos desde epoch del inicio de la cita: identifica la hora vigente. */
export function startsAtEpoch(startsAt: Date | string): number {
  return Math.floor(new Date(startsAt).getTime() / 1000);
}

/**
 * `cita:<id>:<accion>:<epoch>`. El epoch permite reconocer el botón de
 * un recordatorio viejo cuando la cita se movió después de enviarlo.
 */
export function buildReminderPayload(
  appointmentId: string,
  action: ReminderAction,
  startsAt: Date | string
): string {
  return `cita:${appointmentId}:${action}:${startsAtEpoch(startsAt)}`;
}

/** Payloads de los dos botones, por índice del botón en la plantilla. */
export function reminderButtonParams(
  appointmentId: string,
  startsAt: Date | string
): Record<number, string> {
  return {
    0: buildReminderPayload(appointmentId, 'confirmar', startsAt),
    1: buildReminderPayload(appointmentId, 'cambiar', startsAt),
  };
}

export interface ParsedReminderPayload {
  appointmentId: string;
  action: ReminderAction;
  epoch: number;
}

export function isAppointmentPayload(value: string | null | undefined): boolean {
  return !!value && value.startsWith('cita:');
}

export function parseReminderPayload(value: string | null | undefined): ParsedReminderPayload | null {
  const m = PAYLOAD_RE.exec(value?.trim() ?? '');
  if (!m) return null;
  return {
    appointmentId: m[1].toLowerCase(),
    action: m[2].toLowerCase() as ReminderAction,
    epoch: Number(m[3]),
  };
}

// ------------------------------------------------------------
// Acuses a la respuesta del cliente
// ------------------------------------------------------------

export function confirmedReplyText(startsAt: Date | string): string {
  return `¡Listo! Te esperamos el ${formatAppointmentWhen(startsAt).replace(', ', ' a las ')} 🙌`;
}

export function changeRequestedReplyText(agentName: string | null): string {
  const who = agentName?.trim() ? `Tu asesor ${agentName.trim()}` : 'Tu asesor';
  return `Entendido. ${who} te escribirá para buscar otra hora. 👍`;
}

export const STALE_REMINDER_REPLY_TEXT =
  'Esa cita cambió desde que te enviamos el recordatorio; tu asesor te confirmará los detalles.';

// ------------------------------------------------------------
// Avisos al asesor (agenda-citas-avisos)
// ------------------------------------------------------------

/** El motivo como lo lee el asesor en un aviso del sistema. */
export const PURPOSE_LABEL_ES: Record<AppointmentPurpose, string> = {
  view_vehicle: 'Ver un carro',
  test_drive: 'Prueba de manejo',
  appraisal: 'Peritaje de su carro',
  signing: 'Firma',
  delivery: 'Entrega',
};

/** "1 hora", "40 min", "1 h 30 min". Nunca menos de 1 minuto. */
export function minutesLabel(minutes: number): string {
  const m = Math.max(1, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (rest === 0) return h === 1 ? '1 hora' : `${h} horas`;
  return `${h} h ${rest} min`;
}

/** Aviso de visita próxima: "En 1 hora: Jorge Castro" / "Ver un carro · Chevrolet Tracker 2021". */
export function preVisitNotice(args: {
  contactName: string | null;
  startsAt: Date | string;
  now: Date;
  purpose: AppointmentPurpose;
  vehicles: string[];
}): { title: string; body: string } {
  const until = (new Date(args.startsAt).getTime() - args.now.getTime()) / 60_000;
  const who = args.contactName?.trim() || 'Cliente';
  const parts = [PURPOSE_LABEL_ES[args.purpose], vehiclesLabel(args.vehicles)].filter(Boolean);
  return {
    title: `En ${minutesLabel(until)}: ${who}`,
    body: `${formatAppointmentTime(args.startsAt)} · ${parts.join(' · ')}`,
  };
}

/** Aviso de asistencia sin marcar, uno por asesor y día. */
export function attendanceNotice(args: {
  dayLabel: string;
  isToday: boolean;
  items: { startsAt: Date | string; contactName: string | null }[];
}): { title: string; body: string } {
  const n = args.items.length;
  const what = n === 1 ? '1 cita' : `${n} citas`;
  const when = args.isToday ? 'de hoy' : `del ${args.dayLabel}`;
  const body = [...args.items]
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
    .map((i) => `${formatAppointmentTime(i.startsAt)} ${i.contactName?.trim() || 'Cliente'}`)
    .join(' · ');
  return { title: `Tienes ${what} ${when} sin marcar asistencia`, body };
}
