import type { MetadataRoute } from 'next'
import { getBaseUrl } from '@/lib/showcase/site-url'

// Permite indexar la vitrina pública (/) y bloquea las rutas del CRM /
// administración (privadas). Apunta al sitemap.
export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = await getBaseUrl()
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/dashboard',
        '/inbox',
        '/contacts',
        '/pipelines',
        '/inventory',
        '/documents',
        '/broadcasts',
        '/automations',
        '/agents',
        '/notifications',
        '/settings',
        '/login',
        '/signup',
        '/forgot-password',
        '/join',
        '/api/',
      ],
    },
    sitemap: `${base}/sitemap.xml`,
  }
}
