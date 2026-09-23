import { timingSafeEqual } from 'node:crypto'

// ============================================================
// Configuración y guardas del envío de avisos push.
// ============================================================

export interface VapidConfig {
  publicKey: string
  privateKey: string
  /** Contacto que los servicios de push usan si algo va mal. */
  subject: string
}

type Env = Record<string, string | undefined>

/**
 * Claves VAPID leídas EN EJECUCIÓN. La pública le llega al navegador por
 * `GET /api/push/config` y no por una `NEXT_PUBLIC_*`: esas se hornean
 * en la imagen al compilar, y rotar las claves obligaría a reconstruir.
 */
export function getVapidConfig(env: Env = process.env): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim()
  const privateKey = env.VAPID_PRIVATE_KEY?.trim()
  if (!publicKey || !privateKey) return null
  const subject = env.VAPID_SUBJECT?.trim() || 'mailto:admin@localhost'
  return { publicKey, privateKey, subject }
}

/** Comparación en tiempo constante de un secreto compartido. */
export function secretMatches(
  supplied: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!supplied || !expected) return false
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Servicios de push conocidos. El servidor hace un POST al endpoint que
 * manda el navegador; sin esta lista, cualquiera con sesión podría
 * registrar `http://api-gw:8000/...` y usar el servidor para golpear la
 * red interna (SSRF). Los navegadores reales solo entregan endpoints de
 * estos servicios:
 *   - Chrome, Edge en Android, Opera, Samsung: FCM
 *   - Firefox: Mozilla autopush
 *   - Safari (macOS e iOS 16.4+): Apple
 *   - Edge en Windows: WNS
 */
const PUSH_HOSTS_EXACT = new Set(['fcm.googleapis.com', 'android.googleapis.com'])
const PUSH_HOST_SUFFIXES = ['.push.services.mozilla.com', '.push.apple.com', '.notify.windows.com']

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  if (url.port !== '') return false
  const host = url.hostname.toLowerCase()
  return PUSH_HOSTS_EXACT.has(host) || PUSH_HOST_SUFFIXES.some((s) => host.endsWith(s))
}
