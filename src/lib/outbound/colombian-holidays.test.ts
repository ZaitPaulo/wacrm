import { describe, expect, it } from 'vitest';

import {
  domingoDePascua,
  esFestivoColombiano,
  festivosDe,
} from './colombian-holidays';

const fecha = (a: number, m: number, d: number) => new Date(a, m - 1, d);

describe('domingoDePascua', () => {
  // Contrastadas con el calendario litúrgico. Si el algoritmo se rompe,
  // se rompen los cinco festivos que cuelgan de él.
  it.each([
    [2024, 3, 31],
    [2025, 4, 20],
    [2026, 4, 5],
    [2027, 3, 28],
    [2030, 4, 21],
  ])('Pascua de %i', (anio, mes, dia) => {
    expect(domingoDePascua(anio)).toEqual(fecha(anio, mes, dia));
  });
});

describe('festivosDe', () => {
  it('son 18 fechas, o 17 cuando dos festivos coinciden', () => {
    // Colombia tiene 18 festivos, pero DOS PUEDEN CAER EL MISMO DÍA y
    // entonces hay 17 fechas cerradas. No es un error de traslado: es
    // una propiedad del calendario, y para el horario de atención da
    // igual — el día está cerrado de todos modos.
    for (const anio of [2024, 2025, 2026, 2027]) {
      expect(festivosDe(anio).size).toBeGreaterThanOrEqual(17);
      expect(festivosDe(anio).size).toBeLessThanOrEqual(18);
    }
  });

  it('2025: San Pedro y el Sagrado Corazón caen el mismo lunes', () => {
    // El caso concreto que obligó a aflojar la cuenta de arriba. El 29
    // de junio de 2025 es domingo, así que San Pedro se corre al lunes
    // 30; y el Sagrado Corazón (Pascua + 71) cae ese mismo lunes.
    const festivos = festivosDe(2025);
    expect(festivos.has('2025-06-30')).toBe(true);
    expect(festivos.size).toBe(17);
  });

  it('todos los trasladables caen en lunes', () => {
    const festivos = festivosDe(2026);
    const trasladables = [
      '2026-01-12', // Reyes
      '2026-03-23', // San José
      '2026-06-29', // San Pedro y San Pablo (cae lunes, no se mueve)
      '2026-08-17', // Asunción
      '2026-10-12', // Día de la Raza (cae lunes)
      '2026-11-02', // Todos los Santos
      '2026-11-16', // Independencia de Cartagena
    ];
    for (const f of trasladables) {
      expect(festivos.has(f), `falta ${f}`).toBe(true);
      expect(new Date(`${f}T00:00:00`).getDay(), `${f} no es lunes`).toBe(1);
    }
  });

  it('los relativos a la Pascua de 2026', () => {
    const festivos = festivosDe(2026);
    // Pascua 2026 = 5 de abril.
    expect(festivos.has('2026-04-02')).toBe(true); // Jueves Santo
    expect(festivos.has('2026-04-03')).toBe(true); // Viernes Santo
    expect(festivos.has('2026-05-18')).toBe(true); // Ascensión
    expect(festivos.has('2026-06-08')).toBe(true); // Corpus Christi
    expect(festivos.has('2026-06-15')).toBe(true); // Sagrado Corazón
  });

  it('los fijos no se mueven aunque caigan en domingo', () => {
    // 2026-11-01 es domingo, pero Todos los Santos SÍ se traslada;
    // en cambio el 1 de enero se queda donde cae siempre.
    expect(festivosDe(2027).has('2027-01-01')).toBe(true);
    expect(festivosDe(2026).has('2026-07-20')).toBe(true);
    expect(festivosDe(2026).has('2026-12-25')).toBe(true);
  });
});

describe('esFestivoColombiano', () => {
  it('el 20 de julio es festivo', () => {
    expect(esFestivoColombiano(fecha(2026, 7, 20))).toBe(true);
  });

  it('un martes cualquiera no lo es', () => {
    expect(esFestivoColombiano(fecha(2026, 9, 8))).toBe(false);
  });

  it('el 6 de enero NO es festivo cuando se trasladó', () => {
    // 2026-01-06 es martes; el festivo se corre al lunes 12. Tratar el
    // 6 como cerrado dejaría al negocio mudo un día hábil.
    expect(esFestivoColombiano(fecha(2026, 1, 6))).toBe(false);
    expect(esFestivoColombiano(fecha(2026, 1, 12))).toBe(true);
  });

  it('responde igual la segunda vez (la caché no ensucia)', () => {
    expect(esFestivoColombiano(fecha(2026, 7, 20))).toBe(true);
    expect(esFestivoColombiano(fecha(2026, 7, 21))).toBe(false);
    expect(esFestivoColombiano(fecha(2026, 7, 20))).toBe(true);
  });
});
