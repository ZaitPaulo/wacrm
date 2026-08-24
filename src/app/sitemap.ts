import type { MetadataRoute } from 'next'
import { getBaseUrl } from '@/lib/showcase/site-url'
import { getShowcase } from '@/lib/showcase/data'

// Sitemap de la vitrina: la portada + una entrada por cada vehículo
// disponible. Al ser dinámico, un vehículo nuevo aparece automáticamente
// (misma fuente que la vitrina).
//
// La directiva es lo que hace cierta esa frase: sin ella Next prerenderiza
// el sitemap durante el build y la lista queda congelada en los vehículos
// que hubiera ese día — los nuevos no llegarían nunca a Google.
export const dynamic = 'force-dynamic'
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [base, data] = await Promise.all([getBaseUrl(), getShowcase()])
  const vehicles = data?.vehicles ?? []

  return [
    {
      url: base,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: `${base}/privacidad`,
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    ...vehicles.map((v) => ({
      url: `${base}/vehiculo/${v.id}`,
      lastModified: new Date(),
      changeFrequency: 'daily' as const,
      priority: 0.8,
    })),
  ]
}
