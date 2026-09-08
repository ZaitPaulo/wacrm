// ============================================================
// Horario de atención: cuándo el sistema puede escribir por su cuenta.
//
// La regla es una sola y conviene decirla antes que nada:
//
//   RESPONDER a quien escribió se puede SIEMPRE.
//   ESCRIBIR por iniciativa propia, solo en horario.
//
// Un cliente que manda un mensaje a las 11 de la noche espera respuesta
// —por eso escribió— y callarse sería peor que contestar. Lo que no
// puede pasar es que un seguimiento programado despierte a alguien a las
// 3 de la mañana. Esa distinción no se infiere acá: la declara quien
// envía, con `initiative` (ver `gate.ts`).
//
// ## La zona horaria
//
// Se usa el reloj DEL PROCESO, igual que la condición `time_of_day` de
// las automatizaciones. En el despliegue autoalojado el contenedor
// corre con `TZ=America/Bogota` (ver `deploy/docker-compose.app.yml`),
// que es lo que hace que estas horas signifiquen lo que el negocio
// cree que significan.
//
// Es deuda consciente y tiene un límite claro: una instalación con
// cuentas en husos distintos necesitaría guardar la zona junto al
// horario. Hoy no existe ese caso, y meter una zona por cuenta sin
// necesidad traería sus propios errores de conversión.
// ============================================================

/** Días como los numera `Date.getDay()`: 0 domingo … 6 sábado. */
const DIAS = [
  'sun',
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
] as const;

export type DiaSemana = (typeof DIAS)[number];

/**
 * Franja de atención de un día: `["08:00", "18:00"]`.
 * `null` es día cerrado — que es distinto de no estar configurado.
 */
export type FranjaDiaria = [string, string] | null;

export type HorarioSemanal = Record<DiaSemana, FranjaDiaria>;

export interface ConfiguracionHorario {
  /** Sin esto, nada se bloquea ni se aplaza. */
  enabled: boolean;
  hours: HorarioSemanal;
}

/** Todo cerrado: el valor por defecto más seguro es NO tener horario. */
export const HORARIO_VACIO: HorarioSemanal = {
  sun: null,
  mon: null,
  tue: null,
  wed: null,
  thu: null,
  fri: null,
  sat: null,
};

/** "08:30" → 510. Devuelve null si no es una hora válida. */
function aMinutos(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Normaliza lo que venga de la base a un horario utilizable.
 *
 * Tolerante a propósito: un JSON a medias o con una hora mal escrita
 * deja ESE día cerrado en lugar de tumbar el envío entero. Un horario
 * corrupto no puede convertirse en una excepción en el camino de un
 * mensaje.
 */
export function parseHorario(raw: unknown): HorarioSemanal {
  const out: HorarioSemanal = { ...HORARIO_VACIO };
  if (!raw || typeof raw !== 'object') return out;
  const obj = raw as Record<string, unknown>;

  for (const dia of DIAS) {
    const v = obj[dia];
    if (!Array.isArray(v) || v.length !== 2) continue;
    const [desde, hasta] = v;
    if (typeof desde !== 'string' || typeof hasta !== 'string') continue;
    const d = aMinutos(desde);
    const h = aMinutos(hasta);
    // Una franja que no avanza (o retrocede) no describe ningún día
    // real de atención; se trata como cerrado.
    if (d === null || h === null || h <= d) continue;
    out[dia] = [desde.trim(), hasta.trim()];
  }
  return out;
}

/** ¿`now` cae dentro del horario de atención? */
export function dentroDeHorario(
  hours: HorarioSemanal,
  now: Date = new Date()
): boolean {
  const franja = hours[DIAS[now.getDay()]];
  if (!franja) return false;
  const desde = aMinutos(franja[0]);
  const hasta = aMinutos(franja[1]);
  if (desde === null || hasta === null) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  return mins >= desde && mins < hasta;
}

/**
 * Cuándo vuelve a abrir, a partir de `now`.
 *
 * Devuelve `now` mismo si ya está abierto, así que quien aplaza puede
 * llamarla sin preguntar primero. Busca hasta OCHO días —una semana
 * completa más el día en curso— y devuelve `null` si no encuentra
 * ninguna apertura: eso solo pasa con un horario enteramente cerrado, y
 * quien aplaza tiene que decidir qué hacer con un mensaje que nunca
 * tendría cuándo salir.
 */
export function proximaApertura(
  hours: HorarioSemanal,
  now: Date = new Date()
): Date | null {
  if (dentroDeHorario(hours, now)) return now;

  for (let salto = 0; salto <= 7; salto++) {
    const dia = new Date(now);
    dia.setDate(dia.getDate() + salto);
    const franja = hours[DIAS[dia.getDay()]];
    if (!franja) continue;

    const desde = aMinutos(franja[0]);
    if (desde === null) continue;

    const apertura = new Date(dia);
    apertura.setHours(Math.floor(desde / 60), desde % 60, 0, 0);
    // Hoy ya pasó la hora de abrir (estamos después del cierre, o
    // dentro del día pero fuera de la franja): sirve el siguiente.
    if (apertura.getTime() <= now.getTime()) continue;
    return apertura;
  }
  return null;
}

/**
 * ¿Hay que frenar este envío?
 *
 * Con el horario apagado nunca frena, que es lo que mantiene intacta a
 * cualquier instalación que no lo configure.
 */
export function debeEsperar(
  config: ConfiguracionHorario,
  now: Date = new Date()
): boolean {
  if (!config.enabled) return false;
  return !dentroDeHorario(config.hours, now);
}
