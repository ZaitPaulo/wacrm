import type { SupabaseClient } from '@supabase/supabase-js'
import webpush from 'web-push'

import type { VapidConfig } from './config'
import {
  buildPushPayload,
  pushSendOptions,
  type PushPayload,
  type PushSendOptions,
  type PushableNotification,
} from './payload'

// ============================================================
// Envío de avisos push a los dispositivos de un usuario.
//
// Las dependencias (dónde están las suscripciones y cómo se manda) se
// inyectan, así la lógica —a quién, qué se borra— se prueba sin red.
// ============================================================

export interface StoredSubscription {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

export interface SubscriptionStore {
  listForUser(userId: string): Promise<StoredSubscription[]>
  remove(id: string): Promise<void>
  markSuccess(ids: string[]): Promise<void>
}

export interface WebPushSubscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export interface PushSender {
  /** Lanza un error con `statusCode` si el servicio de push lo rechaza. */
  send(sub: WebPushSubscription, payload: string, options: PushSendOptions): Promise<void>
}

export interface DeliveryResult {
  sent: number
  removed: number
  failed: number
}

/** 404/410: el navegador ya no tiene esa suscripción (permiso quitado,
 *  datos borrados, app desinstalada). No volverá: se borra. */
function isGone(err: unknown): boolean {
  const code = (err as { statusCode?: number } | null)?.statusCode
  return code === 404 || code === 410
}

export async function deliverToSubscriptions(
  store: SubscriptionStore,
  sender: PushSender,
  subs: StoredSubscription[],
  payload: PushPayload,
  options: PushSendOptions,
): Promise<DeliveryResult> {
  const body = JSON.stringify(payload)
  const results = await Promise.allSettled(
    subs.map((s) =>
      sender.send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, options),
    ),
  )

  const ok: string[] = []
  const result: DeliveryResult = { sent: 0, removed: 0, failed: 0 }
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    const sub = subs[i]
    if (r.status === 'fulfilled') {
      ok.push(sub.id)
      result.sent++
    } else if (isGone(r.reason)) {
      await store.remove(sub.id)
      result.removed++
    } else {
      result.failed++
      const code = (r.reason as { statusCode?: number } | null)?.statusCode
      // Solo el host: la ruta del endpoint identifica al dispositivo.
      console.error(
        `[push] envío fallido a ${new URL(sub.endpoint).host} (status ${code ?? 'n/a'}):`,
        (r.reason as Error)?.message,
      )
    }
  }
  if (ok.length > 0) await store.markSuccess(ok)
  return result
}

export async function deliverNotification(
  store: SubscriptionStore,
  sender: PushSender,
  notification: PushableNotification & { user_id: string },
): Promise<DeliveryResult> {
  const subs = await store.listForUser(notification.user_id)
  if (subs.length === 0) return { sent: 0, removed: 0, failed: 0 }
  return deliverToSubscriptions(
    store,
    sender,
    subs,
    buildPushPayload(notification),
    pushSendOptions(notification),
  )
}

/** Almacén real: `push_subscriptions` con el cliente de service-role. */
export function supabaseSubscriptionStore(admin: SupabaseClient): SubscriptionStore {
  return {
    async listForUser(userId) {
      const { data, error } = await admin
        .from('push_subscriptions')
        .select('id, endpoint, p256dh, auth')
        .eq('user_id', userId)
      if (error) throw new Error(`push_subscriptions: ${error.message}`)
      return (data ?? []) as StoredSubscription[]
    },
    async remove(id) {
      const { error } = await admin.from('push_subscriptions').delete().eq('id', id)
      if (error) console.error('[push] no se pudo borrar la suscripción:', error.message)
    },
    async markSuccess(ids) {
      const { error } = await admin
        .from('push_subscriptions')
        .update({ last_success_at: new Date().toISOString() })
        .in('id', ids)
      if (error) console.error('[push] no se pudo marcar el envío:', error.message)
    },
  }
}

/** Emisor real: cifra (RFC 8291) y firma (VAPID, RFC 8292) con `web-push`. */
export function webPushSender(vapid: VapidConfig): PushSender {
  return {
    async send(sub, payload, options) {
      await webpush.sendNotification(sub, payload, {
        TTL: options.TTL,
        urgency: options.urgency,
        ...(options.topic ? { topic: options.topic } : {}),
        vapidDetails: {
          subject: vapid.subject,
          publicKey: vapid.publicKey,
          privateKey: vapid.privateKey,
        },
        timeout: 10_000,
      })
    },
  }
}
