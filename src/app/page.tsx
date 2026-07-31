import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { getShowcase } from '@/lib/showcase/data'
import { getBaseUrl } from '@/lib/showcase/site-url'
import { Storefront } from '@/components/storefront/storefront'
import { StoreNav } from '@/components/storefront/store-nav'
import { StoreFooter } from '@/components/storefront/footer'

// Refleja los cambios del CRM al instante (inventario, precios, on/off).
export const dynamic = 'force-dynamic'

// Metadata dinámica según el negocio. El layout raíz pone noindex por
// defecto para la app privada; aquí lo revertimos para la vitrina.
export async function generateMetadata(): Promise<Metadata> {
  const [data, base] = await Promise.all([getShowcase(), getBaseUrl()])
  if (!data) {
    return { title: 'Vitrina', robots: { index: false, follow: false } }
  }
  const name = data.account.public_name?.trim() || data.account.name
  const title = `${name} — Vehículos en venta`
  const description = data.account.public_address
    ? `Explora los vehículos disponibles de ${name}. ${data.account.public_address}. Contáctanos por WhatsApp.`
    : `Explora los vehículos disponibles de ${name} y contáctanos por WhatsApp para comenzar tu compra.`
  return {
    metadataBase: new URL(base),
    title: { absolute: title },
    description,
    robots: { index: true, follow: true },
    alternates: { canonical: '/' },
    // og:image lo aporta app/opengraph-image.tsx (imagen generada).
    openGraph: {
      title,
      description,
      url: base,
      siteName: name,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  }
}

export default async function StorefrontPage() {
  const t = await getTranslations('Storefront')
  const data = await getShowcase()

  // Vitrina no configurada: ninguna cuenta activó showcase_enabled.
  if (!data) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#f7f9fb] p-8 text-center text-[#191c1e]">
        <h1 className="text-2xl font-semibold">{t('notConfigured')}</h1>
        <p className="max-w-md text-sm text-[#44474d]">
          Aún no hay una vitrina pública activa. Un administrador puede activarla
          en el CRM (Ajustes → Public showcase).
        </p>
        <Link href="/login" className="text-sm font-medium text-[#0059bb] underline">
          {t('goToCrm')}
        </Link>
      </main>
    )
  }

  const { account, vehicles } = data
  const displayName = account.public_name?.trim() || account.name
  const heroImage = vehicles.find((v) => v.images?.[0])?.images?.[0] ?? null
  const base = await getBaseUrl()

  // Datos estructurados (schema.org) para resultados enriquecidos.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'AutoDealer',
    name: displayName,
    url: base,
    ...(account.public_logo_url
      ? { logo: account.public_logo_url, image: account.public_logo_url }
      : {}),
    ...(account.public_phone ? { telephone: account.public_phone } : {}),
    ...(account.public_email ? { email: account.public_email } : {}),
    ...(account.public_address ? { address: account.public_address } : {}),
    makesOffer: vehicles.slice(0, 50).map((v) => ({
      '@type': 'Offer',
      priceCurrency: 'USD',
      price: v.price,
      availability: 'https://schema.org/InStock',
      itemOffered: {
        '@type': 'Car',
        name: `${v.brand} ${v.model} ${v.year}`,
        brand: v.brand,
        model: v.model,
        vehicleModelDate: String(v.year),
        ...(v.mileage != null
          ? {
              mileageFromOdometer: {
                '@type': 'QuantitativeValue',
                value: v.mileage,
                unitCode: 'KMT',
              },
            }
          : {}),
        ...(v.images?.[0] ? { image: v.images[0] } : {}),
      },
    })),
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#f7f9fb] text-[#191c1e]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <StoreNav account={account} />

      <main className="flex-grow">
        <Storefront
          vehicles={vehicles}
          whatsapp={account.public_whatsapp}
          heroImage={heroImage}
          currency={account.default_currency}
        />
      </main>

      <StoreFooter account={account} />
    </div>
  )
}
