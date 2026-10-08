// ============================================================
// Fechas de una cita en español, como las lee el cliente:
// "martes 7 de octubre, 2:00 p. m."
//
// Se arma a mano y no con Intl/date-fns a propósito: el mismo texto lo
// produce la base (`appointment_when_es`, migración 548) para los
// avisos, y los dos tienen que coincidir letra por letra. Usa la hora
// local del proceso o del navegador (Bogotá en el despliegue).
// ============================================================

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

function toDate(value: Date | string): Date {
  return typeof value === 'string' ? new Date(value) : value;
}

/** "2:00 p. m." */
export function formatAppointmentTime(value: Date | string): string {
  const d = toDate(value);
  const h = d.getHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${h12}:${mm} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}

/** "martes 7 de octubre" */
export function formatAppointmentDay(value: Date | string): string {
  const d = toDate(value);
  return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`;
}

/** "martes 7 de octubre, 2:00 p. m." */
export function formatAppointmentWhen(value: Date | string): string {
  return `${formatAppointmentDay(value)}, ${formatAppointmentTime(value)}`;
}

/** "2026-10-07", en hora local. Es la forma de la fecha en la URL de la Agenda. */
export function toDayKey(value: Date | string): string {
  const d = toDate(value);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Inverso de `toDayKey`: medianoche local de ese día, o null si no es válida. */
export function fromDayKey(key: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key ?? '');
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) || d.getDate() !== Number(m[3]) ? null : d;
}
