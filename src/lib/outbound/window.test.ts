import { describe, expect, it } from 'vitest';

import { CHANNEL_WINDOW_RULES, evaluateWindow } from './window';

const AHORA = new Date('2026-08-12T12:00:00Z');

/** Un momento `horas` antes de `AHORA`. */
function haceHoras(horas: number): Date {
  return new Date(AHORA.getTime() - horas * 60 * 60 * 1000);
}

describe('dentro de la ventana ordinaria', () => {
  it('deja responder a cualquiera, en los tres canales', () => {
    for (const channel of ['whatsapp', 'instagram', 'messenger'] as const) {
      for (const senderKind of ['human', 'automated'] as const) {
        const v = evaluateWindow({
          channel,
          senderKind,
          lastInboundAt: haceHoras(3),
          now: AHORA,
        });
        expect(v.allowed, `${channel}/${senderKind}`).toBe(true);
        if (v.allowed) expect(v.humanAgentTag).toBe(false);
      }
    }
  });

  it('el borde exacto de 24 h todavía está adentro', () => {
    const v = evaluateWindow({
      channel: 'whatsapp',
      senderKind: 'human',
      lastInboundAt: haceHoras(24),
      now: AHORA,
    });
    expect(v.allowed).toBe(true);
  });
});

describe('la ventana depende de QUIÉN responde', () => {
  // Este es el caso que motivó toda la decisión 8: mismo hilo, mismo
  // momento, distinto autor, distinto resultado.
  const alQuintoDia = {
    channel: 'instagram' as const,
    lastInboundAt: haceHoras(24 * 5),
    now: AHORA,
  };

  it('un asesor puede responder por Instagram al quinto día', () => {
    const v = evaluateWindow({ ...alQuintoDia, senderKind: 'human' });

    expect(v.allowed).toBe(true);
    if (!v.allowed) return;
    // Y sale marcado: Meta exige la etiqueta para ese envío.
    expect(v.humanAgentTag).toBe(true);
  });

  it('el asistente con IA NO puede, en ese mismo momento', () => {
    const v = evaluateWindow({ ...alQuintoDia, senderKind: 'automated' });

    expect(v.allowed).toBe(false);
    if (v.allowed) return;
    expect(v.reason).toBe('outside_window');
  });

  it('lo mismo vale para Messenger', () => {
    const humano = evaluateWindow({
      channel: 'messenger',
      senderKind: 'human',
      lastInboundAt: haceHoras(24 * 5),
      now: AHORA,
    });
    const bot = evaluateWindow({
      channel: 'messenger',
      senderKind: 'automated',
      lastInboundAt: haceHoras(24 * 5),
      now: AHORA,
    });

    expect(humano.allowed).toBe(true);
    expect(bot.allowed).toBe(false);
  });
});

describe('WhatsApp no tiene extensión por atención humana', () => {
  it('un asesor tampoco puede responder libremente al día 2', () => {
    // WhatsApp no ofrece `human_agent`: fuera de ventana exige
    // plantilla, y eso vale igual para una persona que para un bot.
    const v = evaluateWindow({
      channel: 'whatsapp',
      senderKind: 'human',
      lastInboundAt: haceHoras(30),
      now: AHORA,
    });

    expect(v.allowed).toBe(false);
    if (v.allowed) return;
    expect(v.alternative).toBe('template');
  });

  it('pero una plantilla aprobada sí sale', () => {
    const v = evaluateWindow({
      channel: 'whatsapp',
      senderKind: 'human',
      lastInboundAt: haceHoras(24 * 200),
      isTemplate: true,
      now: AHORA,
    });

    expect(v.allowed).toBe(true);
    if (!v.allowed) return;
    expect(v.humanAgentTag).toBe(false);
  });

  it('una plantilla no habilita nada en Instagram', () => {
    // Instagram no tiene plantillas: marcar el envío como tal no puede
    // servir de atajo para saltarse la ventana.
    const v = evaluateWindow({
      channel: 'instagram',
      senderKind: 'automated',
      lastInboundAt: haceHoras(24 * 5),
      isTemplate: true,
      now: AHORA,
    });

    expect(v.allowed).toBe(false);
  });
});

describe('los bordes de los 7 días', () => {
  it('al filo de los 7 días todavía se puede', () => {
    const v = evaluateWindow({
      channel: 'instagram',
      senderKind: 'human',
      lastInboundAt: haceHoras(24 * 7),
      now: AHORA,
    });
    expect(v.allowed).toBe(true);
  });

  it('pasados los 7 días ya no hay nada que hacer', () => {
    const v = evaluateWindow({
      channel: 'instagram',
      senderKind: 'human',
      lastInboundAt: haceHoras(24 * 7 + 1),
      now: AHORA,
    });

    expect(v.allowed).toBe(false);
    if (v.allowed) return;
    expect(v.reason).toBe('expired');
    expect(v.alternative).toBe('none');
  });
});

describe('sin mensaje del cliente no hay ventana', () => {
  it('no se puede iniciar una conversación por Instagram', () => {
    const v = evaluateWindow({
      channel: 'instagram',
      senderKind: 'human',
      lastInboundAt: null,
      now: AHORA,
    });

    expect(v.allowed).toBe(false);
    if (v.allowed) return;
    expect(v.alternative).toBe('human_agent');
  });

  it('en WhatsApp se puede, pero solo con plantilla', () => {
    const sinPlantilla = evaluateWindow({
      channel: 'whatsapp',
      senderKind: 'human',
      lastInboundAt: null,
      now: AHORA,
    });
    const conPlantilla = evaluateWindow({
      channel: 'whatsapp',
      senderKind: 'human',
      lastInboundAt: null,
      isTemplate: true,
      now: AHORA,
    });

    expect(sinPlantilla.allowed).toBe(false);
    expect(conPlantilla.allowed).toBe(true);
  });
});

describe('las reglas están declaradas en un solo lugar', () => {
  it('los tres canales declaran su ventana', () => {
    expect(Object.keys(CHANNEL_WINDOW_RULES).sort()).toEqual([
      'instagram',
      'messenger',
      'whatsapp',
    ]);
  });

  it('solo Instagram y Messenger ofrecen extensión humana', () => {
    expect(CHANNEL_WINDOW_RULES.whatsapp.humanExtensionMs).toBeNull();
    expect(CHANNEL_WINDOW_RULES.instagram.humanExtensionMs).not.toBeNull();
    expect(CHANNEL_WINDOW_RULES.messenger.humanExtensionMs).not.toBeNull();
  });
});
