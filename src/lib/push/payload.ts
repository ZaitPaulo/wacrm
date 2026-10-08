import type { NotificationType } from '@/types'

// ============================================================
// Qué lleva un aviso push y cómo se le pide al servicio de push.
//
// Lo lee `public/sw.js`, así que los nombres de los campos son un
// contrato con el service worker: cambiarlos aquí exige cambiarlos allá.
// ============================================================

/** Largo máximo del cuerpo. El resumen de un traspaso del bot trae
 *  varias líneas; el sistema operativo corta igual, pero mandarlo
 *  entero solo engorda el payload (límite práctico ~4 KB cifrado). */
export const PUSH_BODY_MAX = 180

/** Un aviso con más de una hora de retraso ya no sirve como alarma:
 *  el servicio de push lo descarta si no pudo entregarlo antes. */
export const PUSH_TTL_SECONDS = 60 * 60

export interface PushPayload {
  title: string
  body: string
  /** Una notificación por conversación: la siguiente reemplaza a la
   *  anterior en vez de apilarse. */
  tag: string
  /** Con `tag`, hace que el reemplazo vuelva a sonar/vibrar. */
  renotify: true
  /** A dónde lleva tocar el aviso. Siempre una ruta relativa propia. */
  url: string
  notificationId: string | null
  type: NotificationType | 'test'
  /** El aviso de prueba se muestra aunque el CRM esté visible. */
  test: boolean
}

export interface PushSendOptions {
  TTL: number
  urgency: 'high'
  topic?: string
}

export interface PushableNotification {
  id: string
  type: NotificationType
  title: string
  body?: string | null
  conversation_id?: string | null
  /** Avisos de la Agenda (migración 548): la cita a la que llevan. */
  appointment_id?: string | null
  /** Destino explícito (549): p. ej. la vista Día de una fecha. */
  link_path?: string | null
}

/** Ruta propia: empieza con una barra y no con dos (igual que el CHECK de la 549). */
const OWN_PATH_RE = /^\/[^/]/

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isAppointmentNotice(n: Pick<PushableNotification, 'type'>): boolean {
  return n.type.startsWith('appointment_')
}

/** La conversación del aviso, salvo en los de la Agenda, que van a la cita. */
function conversationOf(n: PushableNotification): string | null {
  if (isAppointmentNotice(n)) return null
  return n.conversation_id && UUID_RE.test(n.conversation_id) ? n.conversation_id : null
}

/**
 * A dónde lleva tocar un aviso. Una sola regla para el push, la campana
 * y el aviso emergente: una conversación abre la bandeja; una cita, la
 * Agenda en esa cita; el resumen diario, la vista Día de hoy.
 */
export function notificationHref(n: PushableNotification): string {
  if (n.link_path && OWN_PATH_RE.test(n.link_path)) return n.link_path
  if (n.type === 'appointment_digest') return '/agenda?vista=dia'
  if (isAppointmentNotice(n)) {
    return n.appointment_id && UUID_RE.test(n.appointment_id)
      ? `/agenda?cita=${n.appointment_id}`
      : '/agenda'
  }
  const conversationId = conversationOf(n)
  return conversationId ? `/inbox?c=${conversationId}` : '/notifications'
}

function truncate(text: string, max: number): string {
  const t = text.trim()
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t
}

export function buildPushPayload(n: PushableNotification): PushPayload {
  const conversationId = conversationOf(n)
  return {
    title: n.title,
    body: truncate(n.body ?? '', PUSH_BODY_MAX),
    tag: conversationId ? `conversation-${conversationId}` : `notification-${n.id}`,
    renotify: true,
    url: notificationHref(n),
    notificationId: n.id,
    type: n.type,
    test: false,
  }
}

export function buildTestPushPayload(title: string, body: string): PushPayload {
  return {
    title,
    body,
    tag: 'push-test',
    renotify: true,
    url: '/notifications',
    notificationId: null,
    type: 'test',
    test: true,
  }
}

/**
 * Cabecera `Topic` (RFC 8030 §5.4): el servicio de push reemplaza un
 * aviso aún no entregado por el siguiente con el mismo topic. Con el
 * celular apagado, al encenderlo llega el último de cada conversación y
 * no toda la cola. Máximo 32 caracteres del alfabeto base64url: un UUID
 * sin guiones mide exactamente 32.
 */
export function pushTopic(n: PushableNotification): string | undefined {
  const conversationId = conversationOf(n)
  return conversationId ? conversationId.replace(/-/g, '') : undefined
}

export function pushSendOptions(n: PushableNotification): PushSendOptions {
  const topic = pushTopic(n)
  return {
    TTL: PUSH_TTL_SECONDS,
    urgency: 'high',
    ...(topic ? { topic } : {}),
  }
}
