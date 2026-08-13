import type { MessageChannel } from '@/lib/contacts/channel-identity';

// ============================================================
// Las reglas de ventana de cada canal, en un solo lugar.
//
// Verificado contra la documentación de Meta el 2026-08-12:
//
//                 DENTRO DE 24 h    24 h – 7 días        > 7 días
//   WhatsApp      cualquiera        plantilla aprobada   plantilla aprobada
//   Instagram     cualquiera        human_agent          nada
//   Messenger     cualquiera        human_agent          nada
//
// LA VENTANA NO DEPENDE SOLO DEL CANAL, DEPENDE DE QUIÉN RESPONDE. Meta
// define la etiqueta `human_agent` para "provide human agent support" —
// el negocio estaba cerrado, el caso necesitaba más de un día. Usarla
// para que un bot conteste al quinto día es exactamente lo que no
// autoriza, y lo que está en juego no es un mensaje sino el permiso de
// la app.
//
// Los plazos son política de Meta y cambian. Se actualizan acá y en
// ningún otro lado.
// ============================================================

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Quién está mandando el mensaje. */
export type SenderKind = 'human' | 'automated';

/** Qué se puede mandar una vez cerrada la ventana ordinaria. */
export type OutsideWindowOption =
  /** WhatsApp: solo una plantilla aprobada. */
  | 'template'
  /** Instagram y Messenger: solo un humano, marcando `human_agent`. */
  | 'human_agent'
  /** Nada. */
  | 'none';

export interface ChannelWindowRules {
  /** Ventana ordinaria desde el último mensaje del cliente. */
  standardMs: number;
  /** Qué se admite pasada esa ventana. */
  outside: OutsideWindowOption;
  /**
   * Hasta cuándo vale la extensión por atención humana. `null` cuando el
   * canal no la ofrece.
   */
  humanExtensionMs: number | null;
}

export const CHANNEL_WINDOW_RULES: Record<MessageChannel, ChannelWindowRules> =
  {
    whatsapp: {
      standardMs: 24 * HOUR_MS,
      // Fuera de ventana WhatsApp no tiene `human_agent`: exige una
      // plantilla aprobada, y eso vale igual al día 2 que al día 200.
      outside: 'template',
      humanExtensionMs: null,
    },
    instagram: {
      standardMs: 24 * HOUR_MS,
      outside: 'human_agent',
      humanExtensionMs: 7 * DAY_MS,
    },
    messenger: {
      standardMs: 24 * HOUR_MS,
      outside: 'human_agent',
      humanExtensionMs: 7 * DAY_MS,
    },
  };

export type WindowVerdict =
  | {
      allowed: true;
      /**
       * True cuando el envío sale pasada la ventana ordinaria y necesita
       * ir marcado como atención humana ante Meta.
       *
       * LO DECIDE ESTA FUNCIÓN, no quien redacta el mensaje.
       */
      humanAgentTag: boolean;
    }
  | {
      allowed: false;
      reason: 'outside_window' | 'expired';
      /** Qué sí se podría mandar, si el canal ofrece algo. */
      alternative: OutsideWindowOption;
    };

export interface EvaluateWindowArgs {
  channel: MessageChannel;
  senderKind: SenderKind;
  /** Último mensaje del cliente en ese hilo. `null` si nunca escribió. */
  lastInboundAt: Date | null;
  /** Si el envío es una plantilla aprobada (solo aplica a WhatsApp). */
  isTemplate?: boolean;
  now?: Date;
}

/**
 * Decide si una respuesta puede salir, y con qué marca.
 *
 * Función PURA: no consulta nada. Quien la llama trae el último mensaje
 * del cliente y ella responde. Así las reglas se pueden testear en sus
 * bordes exactos sin montar base de datos.
 */
export function evaluateWindow(args: EvaluateWindowArgs): WindowVerdict {
  const {
    channel,
    senderKind,
    lastInboundAt,
    isTemplate = false,
    now = new Date(),
  } = args;

  const rules = CHANNEL_WINDOW_RULES[channel];

  // Una plantilla aprobada de WhatsApp vale siempre: es justamente el
  // mecanismo que Meta ofrece para hablar fuera de ventana. Se resuelve
  // antes que nada para no bloquear el único envío que sí procede.
  if (isTemplate && rules.outside === 'template') {
    return { allowed: true, humanAgentTag: false };
  }

  // Sin mensaje del cliente no hay ventana abierta. Es el caso de un
  // negocio que quiere iniciar la conversación.
  if (!lastInboundAt) {
    return {
      allowed: false,
      reason: 'outside_window',
      alternative: rules.outside,
    };
  }

  const elapsed = now.getTime() - lastInboundAt.getTime();

  if (elapsed <= rules.standardMs) {
    return { allowed: true, humanAgentTag: false };
  }

  // Pasada la ventana ordinaria, la extensión por atención humana es
  // SOLO para humanos. Una automatización, un flujo o el asistente con
  // IA se quedan afuera aunque un asesor sí pudiera responder.
  if (
    rules.outside === 'human_agent' &&
    rules.humanExtensionMs !== null &&
    senderKind === 'human'
  ) {
    if (elapsed <= rules.humanExtensionMs) {
      return { allowed: true, humanAgentTag: true };
    }
    return { allowed: false, reason: 'expired', alternative: 'none' };
  }

  return {
    allowed: false,
    reason: 'outside_window',
    alternative: rules.outside,
  };
}
