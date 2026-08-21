import { headers } from 'next/headers'

// ============================================================
// URL base pública del sitio (server-only). Prioriza la config
// explícita NEXT_PUBLIC_SITE_URL; si no está, la deriva del request
// (útil para sitemap.ts, robots.ts y metadataBase de la vitrina).
// ============================================================

/**
 * Variante sin request: solo la configuración explícita, ya validada.
 *
 * La usa el layout raíz para `metadataBase`, donde llamar a `headers()`
 * arrastraría a *toda* la app a renderizado dinámico. Devuelve `null` si
 * la variable no está puesta o si su valor no es una URL absoluta, para
 * que un typo en el .env no tumbe cada página con el `TypeError` de
 * `new URL()`.
 */
export function configuredBaseUrl(): URL | null {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '')
  if (!raw) return null
  try {
    return new URL(raw)
  } catch {
    console.warn('[site-url] NEXT_PUBLIC_SITE_URL no es una URL absoluta válida:', raw)
    return null
  }
}

export async function getBaseUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, '')
  if (configured) return configured

  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}
