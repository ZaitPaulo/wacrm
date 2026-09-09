// ============================================================
// Festivos de Colombia.
//
// Se CALCULAN, no se mantienen en una lista. Una lista por año caduca
// cada 31 de diciembre y falla en silencio: nadie nota que faltan los
// festivos hasta que el sistema le escribe a un cliente el 20 de julio.
// Las reglas colombianas son enteramente deterministas, así que el
// cálculo vale para cualquier año sin que nadie lo toque.
//
// Son tres familias:
//
//   1. Fecha fija que NO se mueve — Año Nuevo, Trabajo, Independencia,
//      Boyacá, Inmaculada, Navidad.
//   2. Fecha fija que se corre al lunes siguiente si no cae lunes, por
//      la Ley 51 de 1983 («Ley Emiliani»).
//   3. Relativos a la Pascua. Jueves y Viernes Santo se quedan donde
//      caen; Ascensión, Corpus Christi y Sagrado Corazón se corren al
//      lunes, y su desplazamiento ya viene incorporado al offset.
//
// Las fechas se construyen en la hora LOCAL del proceso, igual que el
// resto del horario de atención. Ver `business-hours.ts`.
// ============================================================

/** Domingo de Pascua del año dado, en hora local. */
export function domingoDePascua(anio: number): Date {
  // Algoritmo gregoriano anónimo (Meeus/Jones/Butcher).
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31); // 3=marzo, 4=abril
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(anio, mes - 1, dia);
}

/** Corre una fecha al lunes siguiente si no cae lunes (Ley Emiliani). */
function alLunes(fecha: Date): Date {
  const dia = fecha.getDay(); // 0 domingo … 6 sábado
  if (dia === 1) return fecha;
  // Desde domingo falta 1 día; desde martes faltan 6.
  const faltan = dia === 0 ? 1 : 8 - dia;
  const movida = new Date(fecha);
  movida.setDate(movida.getDate() + faltan);
  return movida;
}

const sumarDias = (base: Date, dias: number): Date => {
  const d = new Date(base);
  d.setDate(d.getDate() + dias);
  return d;
};

/** Clave `YYYY-MM-DD` en hora local — nunca `toISOString`, que va a UTC. */
function clave(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** Los 18 festivos colombianos del año, como claves `YYYY-MM-DD`. */
export function festivosDe(anio: number): Set<string> {
  const pascua = domingoDePascua(anio);

  const fijos: [number, number][] = [
    [0, 1], // Año Nuevo
    [4, 1], // Día del Trabajo
    [6, 20], // Grito de Independencia
    [7, 7], // Batalla de Boyacá
    [11, 8], // Inmaculada Concepción
    [11, 25], // Navidad
  ];

  const trasladables: [number, number][] = [
    [0, 6], // Reyes Magos
    [2, 19], // San José
    [5, 29], // San Pedro y San Pablo
    [7, 15], // Asunción de la Virgen
    [9, 12], // Día de la Raza
    [10, 1], // Todos los Santos
    [10, 11], // Independencia de Cartagena
  ];

  const fechas: Date[] = [
    ...fijos.map(([m, d]) => new Date(anio, m, d)),
    ...trasladables.map(([m, d]) => alLunes(new Date(anio, m, d))),
    // Jueves y Viernes Santo NO se trasladan.
    sumarDias(pascua, -3),
    sumarDias(pascua, -2),
    // Estos tres caen entre semana y la ley los corre al lunes; el
    // offset ya lo incluye, por eso no pasan por `alLunes`.
    sumarDias(pascua, 43), // Ascensión del Señor
    sumarDias(pascua, 64), // Corpus Christi
    sumarDias(pascua, 71), // Sagrado Corazón de Jesús
  ];

  return new Set(fechas.map(clave));
}

/**
 * Caché por año. `festivosDe` es barato, pero esto se consulta en el
 * camino de cada envío y no tiene sentido recalcular 18 fechas cada vez.
 */
const cache = new Map<number, Set<string>>();

/** ¿Esta fecha es festivo en Colombia? */
export function esFestivoColombiano(fecha: Date): boolean {
  const anio = fecha.getFullYear();
  let festivos = cache.get(anio);
  if (!festivos) {
    festivos = festivosDe(anio);
    cache.set(anio, festivos);
  }
  return festivos.has(clave(fecha));
}
