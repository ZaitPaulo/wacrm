import { getTranslations } from 'next-intl/server'

import { APP_NAME } from '@/lib/brand'
import { buildCrmManifest } from '@/lib/pwa/manifest'

/**
 * GET /app.webmanifest — manifest del CRM instalable.
 *
 * Ver `src/lib/pwa/manifest.ts` para por qué no es la convención
 * `manifest.ts` de Next.
 */
export async function GET() {
  const t = await getTranslations('Pwa')
  const manifest = buildCrmManifest({ appName: APP_NAME, description: t('description') })
  return new Response(JSON.stringify(manifest), {
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
