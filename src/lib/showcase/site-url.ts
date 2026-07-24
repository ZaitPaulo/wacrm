import { headers } from 'next/headers'

// ============================================================
// URL base pública del sitio (server-only). Prioriza la config
// explícita NEXT_PUBLIC_SITE_URL; si no está, la deriva del request
// (útil para sitemap.ts, robots.ts y metadataBase de la vitrina).
// ============================================================

export async function getBaseUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, '')
  if (configured) return configured

  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}
