// ============================================================
// Informe de gestión de asesores (cambio informe-gestion-asesores).
//
// Lógica pura: los filtros de la descarga, el resumen de gestión y el
// mapeo de cada fila a las columnas del Excel. La consulta vive en la
// función SQL `management_report` (migración 552) y el libro en
// `management-workbook.ts`.
//
// Las fechas se interpretan con el reloj DEL PROCESO, igual que el
// horario de atención (`lib/outbound/business-hours.ts`): el contenedor
// corre con `TZ=America/Bogota`.
// ============================================================

import { differenceInCalendarDays, format } from 'date-fns';

/** Una fila de `management_report`, tal como la devuelve PostgREST. */
export interface ManagementReportRow {
  contact_id: string;
  contact_name: string | null;
  phone: string | null;
  channel: string | null;
  arrived_at: string;
  agent_id: string | null;
  agent_name: string | null;
  pipeline_name: string | null;
  stage_name: string | null;
  deal_status: string | null;
  tags: string | null;
  last_customer_message_at: string | null;
  last_agent_message_at: string | null;
  customer_messages: number;
  agent_messages: number;
  automated_messages: number;
  appointments_total: number;
  appointments_attended: number;
  appointments_no_show: number;
  appointments_cancelled: number;
  next_appointment_at: string | null;
  last_note_at: string | null;
  last_note_author: string | null;
  last_note_text: string | null;
  handoff_summary: string | null;
}

/** Máximo de filas del informe; la función se pide con una más para saber si se pasó. */
export const MANAGEMENT_REPORT_MAX_ROWS = 10_000;

/** Rango por defecto cuando no llega `from`/`to`: los últimos 30 días hasta hoy. */
export const DEFAULT_RANGE_DAYS = 30;

/** Largo máximo de la nota y del traspaso dentro del resumen. */
export const SUMMARY_TEXT_MAX = 200;

/** Filtro de asesor: `null` = todos, `unassigned` = sin asesor, o el `user_id` de un miembro. */
export type AgentFilter = null | 'unassigned' | (string & {});

/** Filtros ya validados con los que la ruta llama a `management_report`. */
export interface ManagementFilters {
  /** Inicio del primer día, hora local. */
  from: Date;
  /** Inicio del día SIGUIENTE a "hasta": el rango es [from, toExclusive). */
  toExclusive: Date;
  /** Las fechas tal como se pidieron (AAAA-MM-DD), para la hoja de parámetros. */
  fromKey: string;
  toKey: string;
  agent: AgentFilter;
}

export type ParseFiltersResult =
  | { ok: true; filters: ManagementFilters }
  | { ok: false; error: string };

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `AAAA-MM-DD` → medianoche local de ese día, o null si no es una fecha real. */
function parseDateKey(key: string): Date | null {
  const m = DATE_KEY.exec(key);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  // `new Date(2026, 1, 31)` se corre a marzo: así se detecta el 31 de febrero.
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== mo - 1 ||
    date.getDate() !== d
  ) {
    return null;
  }
  return date;
}

function addDays(date: Date, days: number): Date {
  const out = new Date(date);
  out.setDate(out.getDate() + days);
  return out;
}

/**
 * Filtros de la descarga: `from` y `to` (AAAA-MM-DD, inclusive) y `agent`
 * (vacío = todos, `unassigned` o el user_id de un asesor). Sin rango, los
 * últimos 30 días hasta hoy. Que el asesor sea miembro de la cuenta lo
 * valida la ruta contra la base.
 */
export function parseManagementFilters(
  params: URLSearchParams,
  today: Date,
): ParseFiltersResult {
  const todayStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );

  const rawFrom = params.get('from')?.trim() || '';
  const rawTo = params.get('to')?.trim() || '';

  const to = rawTo ? parseDateKey(rawTo) : todayStart;
  if (!to) return { ok: false, error: 'La fecha "hasta" no es válida.' };

  const from = rawFrom
    ? parseDateKey(rawFrom)
    : addDays(to, -(DEFAULT_RANGE_DAYS - 1));
  if (!from) return { ok: false, error: 'La fecha "desde" no es válida.' };

  if (from.getTime() > to.getTime()) {
    return {
      ok: false,
      error: 'La fecha "desde" no puede ser posterior a la fecha "hasta".',
    };
  }

  const rawAgent = params.get('agent')?.trim() || '';
  let agent: AgentFilter = null;
  if (rawAgent === 'unassigned') {
    agent = 'unassigned';
  } else if (rawAgent) {
    if (!UUID.test(rawAgent)) {
      return { ok: false, error: 'El asesor elegido no es válido.' };
    }
    agent = rawAgent.toLowerCase();
  }

  return {
    ok: true,
    filters: {
      from,
      toExclusive: addDays(to, 1),
      fromKey: format(from, 'yyyy-MM-dd'),
      toKey: format(to, 'yyyy-MM-dd'),
      agent,
    },
  };
}

/** Fecha corta `dd/MM/yyyy` en la hora local del proceso. */
export function formatDay(value: string | Date): string {
  return format(typeof value === 'string' ? new Date(value) : value, 'dd/MM/yyyy');
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function daysAgo(value: string, now: Date): string {
  const days = differenceInCalendarDays(now, new Date(value));
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  return `hace ${days} días`;
}

/**
 * Resumen de gestión, sin IA: lo que hizo el asesor, si el cliente espera
 * respuesta, las citas y, al final, la última nota o, si no hay, el
 * traspaso del bot. Cada parte se omite si no tiene datos. La primera
 * línea junta lo medible; la segunda, el texto libre.
 */
export function buildManagementSummary(
  row: ManagementReportRow,
  now: Date,
): string {
  const facts: string[] = [];

  facts.push(
    row.last_agent_message_at
      ? `Último mensaje del asesor ${daysAgo(row.last_agent_message_at, now)}`
      : 'El asesor no le ha escrito',
  );

  if (
    row.last_customer_message_at &&
    (!row.last_agent_message_at ||
      new Date(row.last_customer_message_at).getTime() >
        new Date(row.last_agent_message_at).getTime())
  ) {
    facts.push(
      `Cliente sin respuesta desde ${formatDay(row.last_customer_message_at)}`,
    );
  }

  if (row.appointments_total > 0 || row.next_appointment_at) {
    let citas = `Citas: ${row.appointments_total} (asistió ${row.appointments_attended}, no asistió ${row.appointments_no_show})`;
    if (row.next_appointment_at) {
      citas += `, próxima ${formatDay(row.next_appointment_at)}`;
    }
    facts.push(citas);
  }

  const lines = [facts.join(' · ')];

  const note = row.last_note_text?.trim();
  const handoff = row.handoff_summary?.trim();
  if (note) {
    lines.push(`Nota: ${truncate(note, SUMMARY_TEXT_MAX)}`);
  } else if (handoff) {
    lines.push(`Traspaso del bot: ${truncate(handoff, SUMMARY_TEXT_MAX)}`);
  }

  return lines.join('\n');
}

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  facebook: 'Facebook',
  messenger: 'Messenger',
};

const DEAL_STATUS_LABELS: Record<string, string> = {
  open: 'Abierto',
  won: 'Ganado',
  lost: 'Perdido',
};

/** Texto de la columna Asesor cuando el cliente no tiene ninguno. */
export const UNASSIGNED_LABEL = 'Sin asignar';

/** Columnas de la hoja "Clientes", en orden. `date` = celda de fecha de Excel. */
export const MANAGEMENT_COLUMNS = [
  { key: 'client', header: 'Cliente', width: 26 },
  { key: 'phone', header: 'Teléfono', width: 16 },
  { key: 'channel', header: 'Canal', width: 11 },
  { key: 'arrivedAt', header: 'Fecha de llegada', width: 14, date: true },
  { key: 'agent', header: 'Asesor', width: 24 },
  { key: 'pipeline', header: 'Embudo', width: 16 },
  { key: 'stage', header: 'Etapa', width: 18 },
  { key: 'dealStatus', header: 'Estado del negocio', width: 12 },
  { key: 'tags', header: 'Etiquetas', width: 24 },
  { key: 'summary', header: 'Resumen de gestión', width: 70 },
  { key: 'lastCustomerAt', header: 'Último mensaje del cliente', width: 14, date: true },
  { key: 'lastAgentAt', header: 'Último mensaje del asesor', width: 14, date: true },
  { key: 'customerMessages', header: 'Mensajes del cliente', width: 10 },
  { key: 'agentMessages', header: 'Mensajes del asesor', width: 10 },
  { key: 'automatedMessages', header: 'Mensajes automáticos', width: 11 },
  { key: 'appointments', header: 'Citas', width: 8 },
  { key: 'attended', header: 'Asistió', width: 8 },
  { key: 'noShow', header: 'No asistió', width: 9 },
  { key: 'cancelled', header: 'Canceladas', width: 10 },
  { key: 'nextAppointmentAt', header: 'Próxima cita', width: 14, date: true },
  { key: 'lastNoteAt', header: 'Fecha de la última nota', width: 14, date: true },
  { key: 'lastNoteAuthor', header: 'Autor de la nota', width: 20 },
  { key: 'lastNote', header: 'Última nota', width: 50 },
  { key: 'handoffSummary', header: 'Resumen del traspaso del bot', width: 50 },
] as const;

export type ManagementColumnKey = (typeof MANAGEMENT_COLUMNS)[number]['key'];
export type ManagementSheetRow = Record<
  ManagementColumnKey,
  string | number | Date | null
>;

const toDate = (v: string | null): Date | null => (v ? new Date(v) : null);

/** Una fila de la función → los valores de cada columna de la hoja. */
export function toSheetRow(
  row: ManagementReportRow,
  now: Date,
): ManagementSheetRow {
  return {
    client: row.contact_name?.trim() || row.phone || '',
    phone: row.phone,
    channel: row.channel ? (CHANNEL_LABELS[row.channel] ?? row.channel) : null,
    arrivedAt: toDate(row.arrived_at),
    agent: row.agent_id ? (row.agent_name ?? 'Asesor desconocido') : UNASSIGNED_LABEL,
    pipeline: row.pipeline_name,
    stage: row.stage_name,
    dealStatus: row.deal_status
      ? (DEAL_STATUS_LABELS[row.deal_status] ?? row.deal_status)
      : null,
    tags: row.tags,
    summary: buildManagementSummary(row, now),
    lastCustomerAt: toDate(row.last_customer_message_at),
    lastAgentAt: toDate(row.last_agent_message_at),
    customerMessages: row.customer_messages ?? 0,
    agentMessages: row.agent_messages ?? 0,
    automatedMessages: row.automated_messages ?? 0,
    appointments: row.appointments_total ?? 0,
    attended: row.appointments_attended ?? 0,
    noShow: row.appointments_no_show ?? 0,
    cancelled: row.appointments_cancelled ?? 0,
    nextAppointmentAt: toDate(row.next_appointment_at),
    lastNoteAt: toDate(row.last_note_at),
    lastNoteAuthor: row.last_note_author,
    lastNote: row.last_note_text,
    handoffSummary: row.handoff_summary,
  };
}

/** `informe-gestion-AAAA-MM-DD.xlsx`, con la fecha de generación. */
export function managementReportFilename(now: Date): string {
  return `informe-gestion-${format(now, 'yyyy-MM-dd')}.xlsx`;
}
