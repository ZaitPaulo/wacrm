'use client'

import type { PushEnvironment } from './client'
import { sameApplicationServerKey, urlBase64ToUint8Array } from './client'

// ============================================================
// Todo lo que toca las APIs de avisos del navegador. Solo se llama desde
// efectos o manejadores de clic, nunca durante el render.
// ============================================================

export const SW_URL = '/sw.js'
export const SW_SCOPE = '/'

export function readPushEnvironment(): PushEnvironment {
  const nav = navigator as Navigator & { standalone?: boolean }
  return {
    hasServiceWorker: 'serviceWorker' in navigator,
    hasPushManager: typeof window !== 'undefined' && 'PushManager' in window,
    hasNotification: typeof window !== 'undefined' && 'Notification' in window,
    userAgent: navigator.userAgent,
    standalone:
      nav.standalone === true ||
      (typeof window.matchMedia === 'function' &&
        window.matchMedia('(display-mode: standalone)').matches),
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
  }
}

export function currentPermission(): NotificationPermission {
  return typeof Notification === 'undefined' ? 'default' : Notification.permission
}

/** La registración del service worker de avisos, si existe. No registra. */
export async function getPushRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  return (await navigator.serviceWorker.getRegistration(SW_SCOPE)) ?? null
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  const reg = await getPushRegistration()
  return reg ? reg.pushManager.getSubscription() : null
}

export async function fetchPushConfig(): Promise<{ enabled: boolean; publicKey: string | null }> {
  const res = await fetch('/api/push/config', { cache: 'no-store' })
  if (!res.ok) return { enabled: false, publicKey: null }
  return res.json()
}

async function saveSubscription(sub: PushSubscription): Promise<void> {
  const res = await fetch('/api/push/subscriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub.toJSON()),
  })
  if (!res.ok) throw new Error(`save subscription: ${res.status}`)
}

/**
 * Suscribe ESTE dispositivo. Debe llamarse desde un clic: pide el
 * permiso de notificaciones si todavía no se decidió.
 * Devuelve el permiso resultante; la suscripción solo existe si es
 * `granted`.
 */
export async function subscribeThisDevice(publicKey: string): Promise<NotificationPermission> {
  const permission =
    Notification.permission === 'default'
      ? await Notification.requestPermission()
      : Notification.permission
  if (permission !== 'granted') return permission

  await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE })
  const reg = await navigator.serviceWorker.ready

  let sub = await reg.pushManager.getSubscription()
  // Tras rotar las claves VAPID la suscripción vieja no sirve: se rehace.
  if (sub && !sameApplicationServerKey(sub.options.applicationServerKey, publicKey)) {
    await sub.unsubscribe()
    sub = null
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    })
  }
  await saveSubscription(sub)
  return permission
}

/** Vuelve a registrar en el servidor una suscripción que ya existe (p. ej.
 *  otro usuario inició sesión en este navegador). No pide permiso. */
export async function resyncSubscription(): Promise<boolean> {
  const sub = await getCurrentSubscription()
  if (!sub) return false
  await saveSubscription(sub)
  return true
}

/** Olvida este dispositivo: en el servidor y en el navegador. Se usa al
 *  desactivar y al cerrar sesión. Nunca lanza. */
export async function forgetThisDevice(): Promise<void> {
  try {
    const sub = await getCurrentSubscription()
    if (!sub) return
    await fetch('/api/push/subscriptions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => undefined)
    await sub.unsubscribe()
  } catch {
    // Sin service worker o sin red: no hay nada más que hacer.
  }
}

export type TestPushResult = 'sent' | 'expired' | 'failed'

export async function sendTestPush(title: string, body: string): Promise<TestPushResult> {
  const sub = await getCurrentSubscription()
  if (!sub) return 'expired'
  const res = await fetch('/api/push/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint, title, body }),
  })
  if (res.ok) return 'sent'
  if (res.status === 404 || res.status === 410) {
    // El servidor ya no la tiene: que el estado de la tarjeta lo refleje.
    await sub.unsubscribe().catch(() => undefined)
    return 'expired'
  }
  return 'failed'
}

/** Cierra el aviso del sistema de una conversación en este dispositivo. */
export async function closeConversationSystemNotifications(conversationId: string): Promise<void> {
  try {
    const reg = await getPushRegistration()
    if (!reg) return
    const list = await reg.getNotifications({ tag: `conversation-${conversationId}` })
    list.forEach((n) => n.close())
  } catch {
    // Navegador sin getNotifications: el aviso se queda, no es grave.
  }
}

let audioCtx: AudioContext | null = null

/**
 * Sonido corto de dos tonos, generado con Web Audio (sin archivo). Si el
 * navegador bloquea el audio porque no hubo un gesto previo en la
 * página, se omite en silencio: el aviso emergente se ve igual.
 */
export function playChime(): void {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    audioCtx ??= new Ctx()
    const ctx = audioCtx
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
    const start = ctx.currentTime
    const tones: [number, number][] = [
      [880, 0],
      [1320, 0.12],
    ]
    for (const [freq, offset] of tones) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, start + offset)
      gain.gain.exponentialRampToValueAtTime(0.25, start + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.22)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start + offset)
      osc.stop(start + offset + 0.25)
    }
  } catch {
    // Sin audio disponible.
  }
}
