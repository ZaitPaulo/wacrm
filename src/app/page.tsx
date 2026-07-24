import type { Metadata } from 'next'
import Link from 'next/link'
import { getShowcase } from '@/lib/showcase/data'
import { getBaseUrl } from '@/lib/showcase/site-url'
import { Catalog } from '@/components/storefront/catalog'
import { StoreFooter } from '@/components/storefront/footer'

// Refleja los cambios del CRM al instante (inventario, precios, on/off).
export const dynamic = 'force-dynamic'

// Metadata dinámica según el negocio (title/description/OG/Twitter). El
// layout raíz pone noindex por defecto para la app privada; aquí lo
// revertimos para la vitrina pública.
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
  const data = await getShowcase()

  // Vitrina no configurada: ninguna cuenta activó showcase_enabled.
  if (!data) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 p-8 text-center text-slate-900">
        <h1 className="text-2xl font-semibold">Vitrina no configurada</h1>
        <p className="max-w-md text-sm text-slate-500">
          Aún no hay una vitrina pública activa. Un administrador puede activarla
          en el CRM (Ajustes → Public showcase).
        </p>
        <Link href="/login" className="text-sm font-medium text-slate-900 underline">
          Ir al CRM
        </Link>
      </main>
    )
  }

  const { account, vehicles } = data
  const displayName = account.public_name?.trim() || account.name
  const base = await getBaseUrl()

  // Datos estructurados (schema.org) para resultados enriquecidos: el
  // concesionario y su oferta de vehículos.
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
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* Hero */}
      <section className="bg-gradient-to-br from-slate-900 to-slate-700 text-white">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/60">
            {displayName}
          </p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Encuentra tu próximo vehículo
          </h1>
          <p className="mt-3 max-w-xl text-slate-300">
            Explora nuestro inventario disponible y contáctanos por WhatsApp para
            comenzar tu compra hoy mismo.
          </p>
          <span className="mt-6 inline-block rounded-full bg-white/10 px-3.5 py-1.5 text-sm font-medium">
            {vehicles.length} vehículo{vehicles.length === 1 ? '' : 's'} disponible
            {vehicles.length === 1 ? '' : 's'}
          </span>
        </div>
      </section>

      {/* Catálogo */}
      <main className="mx-auto max-w-6xl px-4 py-12">
        <h2 className="mb-6 text-xl font-bold tracking-tight text-slate-900">
          Nuestro inventario
        </h2>
        {vehicles.length === 0 ? (
          <p className="py-20 text-center text-slate-500">
            No hay vehículos disponibles en este momento. Vuelve pronto.
          </p>
        ) : (
          <Catalog vehicles={vehicles} whatsapp={account.public_whatsapp} />
        )}
      </main>

      <StoreFooter account={account} />
    </div>
  )
}
