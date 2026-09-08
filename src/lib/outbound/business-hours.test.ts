import { describe, expect, it } from 'vitest';

import {
  HORARIO_VACIO,
  debeEsperar,
  dentroDeHorario,
  parseHorario,
  proximaApertura,
  type HorarioSemanal,
} from './business-hours';

// El horario real de LoraMotors: L-V 8:00-18:00, Sáb 8:00-14:00,
// domingo cerrado.
const LORAMOTORS: HorarioSemanal = {
  sun: null,
  mon: ['08:00', '18:00'],
  tue: ['08:00', '18:00'],
  wed: ['08:00', '18:00'],
  thu: ['08:00', '18:00'],
  fri: ['08:00', '18:00'],
  sat: ['08:00', '14:00'],
};

/** Un momento concreto en el reloj local del proceso. */
const cuando = (iso: string) => new Date(iso);

describe('parseHorario', () => {
  it('lee un horario bien formado', () => {
    expect(parseHorario({ mon: ['08:00', '18:00'] }).mon).toEqual([
      '08:00',
      '18:00',
    ]);
  });

  it('un día ausente queda cerrado', () => {
    expect(parseHorario({ mon: ['08:00', '18:00'] }).sun).toBeNull();
  });

  it('no lanza con basura, deja el día cerrado', () => {
    // Un horario corrupto NO puede convertirse en una excepción en el
    // camino de un mensaje: se degrada a "cerrado", que es lo seguro.
    expect(parseHorario(null)).toEqual(HORARIO_VACIO);
    expect(parseHorario('lunes a viernes')).toEqual(HORARIO_VACIO);
    expect(parseHorario({ mon: 'todo el día' }).mon).toBeNull();
    expect(parseHorario({ mon: ['25:00', '30:00'] }).mon).toBeNull();
    expect(parseHorario({ mon: ['08:00'] }).mon).toBeNull();
  });

  it('una franja que no avanza es un día cerrado', () => {
    expect(parseHorario({ mon: ['18:00', '08:00'] }).mon).toBeNull();
    expect(parseHorario({ mon: ['08:00', '08:00'] }).mon).toBeNull();
  });
});

describe('dentroDeHorario', () => {
  // 2026-09-08 es martes.
  it('dentro de la franja de un día hábil', () => {
    expect(dentroDeHorario(LORAMOTORS, cuando('2026-09-08T10:00:00'))).toBe(
      true
    );
  });

  it('antes de abrir', () => {
    expect(dentroDeHorario(LORAMOTORS, cuando('2026-09-08T07:59:00'))).toBe(
      false
    );
  });

  it('la hora de cierre ya está afuera', () => {
    expect(dentroDeHorario(LORAMOTORS, cuando('2026-09-08T18:00:00'))).toBe(
      false
    );
    expect(dentroDeHorario(LORAMOTORS, cuando('2026-09-08T17:59:00'))).toBe(
      true
    );
  });

  it('la madrugada, que es el caso que motivó todo esto', () => {
    expect(dentroDeHorario(LORAMOTORS, cuando('2026-09-09T03:00:00'))).toBe(
      false
    );
  });

  it('el sábado cierra más temprano', () => {
    // 2026-09-12 es sábado.
    expect(dentroDeHorario(LORAMOTORS, cuando('2026-09-12T13:00:00'))).toBe(
      true
    );
    expect(dentroDeHorario(LORAMOTORS, cuando('2026-09-12T15:00:00'))).toBe(
      false
    );
  });

  it('el domingo está cerrado todo el día', () => {
    // 2026-09-13 es domingo. Un horario de una sola franja diaria
    // habría dejado pasar esto a mediodía.
    expect(dentroDeHorario(LORAMOTORS, cuando('2026-09-13T12:00:00'))).toBe(
      false
    );
  });
});

describe('proximaApertura', () => {
  it('estando abierto devuelve el momento mismo', () => {
    const ahora = cuando('2026-09-08T10:00:00');
    expect(proximaApertura(LORAMOTORS, ahora)).toEqual(ahora);
  });

  it('de madrugada abre esa misma mañana', () => {
    const abre = proximaApertura(LORAMOTORS, cuando('2026-09-09T03:00:00'));
    expect(abre?.toISOString()).toBe(cuando('2026-09-09T08:00:00').toISOString());
  });

  it('después del cierre abre al día siguiente', () => {
    const abre = proximaApertura(LORAMOTORS, cuando('2026-09-08T20:00:00'));
    expect(abre?.toISOString()).toBe(cuando('2026-09-09T08:00:00').toISOString());
  });

  it('el sábado por la tarde salta el domingo y abre el lunes', () => {
    // Lo que un "silencio de 19:00 a 7:00" no habría podido hacer.
    const abre = proximaApertura(LORAMOTORS, cuando('2026-09-12T16:00:00'));
    expect(abre?.toISOString()).toBe(cuando('2026-09-14T08:00:00').toISOString());
  });

  it('el domingo abre el lunes', () => {
    const abre = proximaApertura(LORAMOTORS, cuando('2026-09-13T12:00:00'));
    expect(abre?.toISOString()).toBe(cuando('2026-09-14T08:00:00').toISOString());
  });

  it('sin ningún día abierto no hay apertura que devolver', () => {
    // Quien aplaza tiene que decidir qué hacer con un mensaje que nunca
    // tendría cuándo salir; por eso esto es null y no una fecha lejana.
    expect(proximaApertura(HORARIO_VACIO, cuando('2026-09-08T10:00:00'))).toBeNull();
  });
});

describe('debeEsperar', () => {
  it('con el horario apagado nunca frena', () => {
    // Lo que mantiene intacta a cualquier instalación que no lo use.
    expect(
      debeEsperar(
        { enabled: false, hours: LORAMOTORS },
        cuando('2026-09-09T03:00:00')
      )
    ).toBe(false);
  });

  it('encendido y de madrugada, frena', () => {
    expect(
      debeEsperar(
        { enabled: true, hours: LORAMOTORS },
        cuando('2026-09-09T03:00:00')
      )
    ).toBe(true);
  });

  it('encendido y en horario, deja pasar', () => {
    expect(
      debeEsperar(
        { enabled: true, hours: LORAMOTORS },
        cuando('2026-09-08T10:00:00')
      )
    ).toBe(false);
  });
});
