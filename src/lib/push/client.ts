import type { NotificationType } from '@/types'

// ============================================================
// Lógica de navegador de los avisos push, sin tocar el DOM: qué soporta
// este dispositivo, en qué estado está la tarjeta y cuándo avisar dentro
// de la app. Lo que toca APIs del navegador vive en el hook
// `use-push-subscription` y en `in-app-notification-alerts`.
// ============================================================

export type PushSupport =
  | 'supported'
  /** iPhone/iPad sin el CRM agregado a la pantalla de inicio. */
  | 'ios-install-required'
  /** iPhone/iPad instalado, pero con iOS anterior a 16.4. */
  | 'ios-too-old'
  | 'unsupported'

export interface PushEnvironment {
  hasServiceWorker: boolean
  hasPushManager: boolean
  hasNotification: boolean
  userAgent: string
  /** `display-mode: standalone` o `navigator.standalone`. */
  standalone: boolean
  maxTouchPoints: number
}

function isIOS(ua: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/.test(ua)) return true
  // iPadOS 13+ se presenta como Mac; lo delata la pantalla táctil.
  return /Macintosh/.test(ua) && maxTouchPoints > 1
}

export function detectPushSupport(env: PushEnvironment): PushSupport {
  const apis = env.hasServiceWorker && env.hasPushManager && env.hasNotification
  if (isIOS(env.userAgent, env.maxTouchPoints)) {
    // En iOS Safari solo expone Web Push a un sitio abierto desde la
    // pantalla de inicio. En una pestaña (de Safari o de Chrome, que en
    // iOS también es WebKit) `PushManager` directamente no existe.
    if (!env.standalone) return 'ios-install-required'
    return apis ? 'supported' : 'ios-too-old'
  }
  return apis ? 'supported' : 'unsupported'
}

/** Mismo criterio que `public/sw.js`: el servicio de push de Apple exige
 *  mostrar un aviso del sistema por cada push. */
export function isApplePushUserAgent(ua: string): boolean {
  if (/iPhone|iPad|iPod/.test(ua)) return true
  return (
    /Safari/.test(ua) &&
    /AppleWebKit/.test(ua) &&
    !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS|Android/.test(ua)
  )
}

export type PushCardState =
  | 'unsupported'
  | 'ios-install'
  | 'ios-too-old'
  | 'server-disabled'
  | 'blocked'
  | 'enabled'
  | 'disabled'

export function pushCardState(input: {
  support: PushSupport
  serverEnabled: boolean
  permission: NotificationPermission
  subscribed: boolean
}): PushCardState {
  if (input.support === 'ios-install-required') return 'ios-install'
  if (input.support === 'ios-too-old') return 'ios-too-old'
  if (input.support === 'unsupported') return 'unsupported'
  if (!input.serverEnabled) return 'server-disabled'
  if (input.permission === 'denied') return 'blocked'
  if (input.permission === 'granted' && input.subscribed) return 'enabled'
  return 'disabled'
}

export type UnblockHelpKey = 'chromeAndroid' | 'chromeDesktop' | 'firefox' | 'safari' | 'ios' | 'generic'

/** Qué instrucciones de desbloqueo mostrar: cada navegador lo esconde en
 *  un lugar distinto. */
export function unblockHelpKey(ua: string): UnblockHelpKey {
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios'
  if (/Firefox|FxiOS/.test(ua)) return 'firefox'
  if (/Android/.test(ua) && /Chrome/.test(ua)) return 'chromeAndroid'
  if (/Chrome|Chromium|Edg/.test(ua)) return 'chromeDesktop'
  if (isApplePushUserAgent(ua)) return 'safari'
  return 'generic'
}

export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** ¿La suscripción existente se hizo con esta clave? Tras rotar las
 *  claves VAPID hay que re-suscribir: la vieja ya no se puede usar. */
export function sameApplicationServerKey(
  existing: ArrayBuffer | null | undefined,
  publicKey: string,
): boolean {
  if (!existing) return false
  const a = new Uint8Array(existing)
  const b = urlBase64ToUint8Array(publicKey)
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** La conversación que el usuario tiene abierta, según la URL. */
export function viewedConversationId(pathname: string, search: string): string | null {
  if (pathname !== '/inbox') return null
  return new URLSearchParams(search).get('c')
}

/** Un evento de Realtime más viejo que esto no suena: es una reconexión
 *  que reenvía cambios pasados, no algo que acaba de ocurrir. */
const MAX_ALERT_AGE_MS = 2 * 60 * 1000

export interface AlertableRow {
  id: string
  type: NotificationType
  conversation_id?: string | null
  read_at?: string | null
  created_at: string
}

export type InAppDecision = 'alert' | 'mark-read' | 'ignore'

/**
 * Qué hacer dentro de la app cuando Realtime trae un cambio de
 * `notifications` del usuario.
 *
 *   alert     — aviso emergente + sonido
 *   mark-read — ya está mirando esa conversación: el aviso sobra
 *   ignore    — nada
 */
export function shouldAlertInApp(input: {
  eventType: 'INSERT' | 'UPDATE'
  row: AlertableRow
  /** `created_at` anterior (UPDATE; REPLICA IDENTITY FULL desde la 027). */
  oldCreatedAt: string | undefined
  visible: boolean
  viewingConversationId: string | null
  /** Safari/iOS con avisos activos en este dispositivo: el del sistema
   *  sale siempre, así que la app no duplica. */
  suppressForSystemAlert: boolean
  now: number
}): InAppDecision {
  const { row } = input
  if (row.read_at) return 'ignore'
  // Un UPDATE solo es "aviso nuevo" si movió created_at (otro mensaje).
  if (input.eventType === 'UPDATE' && input.oldCreatedAt === row.created_at) return 'ignore'
  if (!input.visible) return 'ignore'
  if (input.now - Date.parse(row.created_at) > MAX_ALERT_AGE_MS) return 'ignore'
  if (row.conversation_id && row.conversation_id === input.viewingConversationId) {
    return row.type === 'new_message' ? 'mark-read' : 'ignore'
  }
  if (input.suppressForSystemAlert) return 'ignore'
  return 'alert'
}
