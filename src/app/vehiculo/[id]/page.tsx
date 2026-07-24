import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getShowcaseVehicle } from '@/lib/showcase/data'
import { getBaseUrl } from '@/lib/showcase/site-url'
import { featuresToList, whatsappHref, formatPrice } from '@/lib/showcase/format'
import {
  labelOf,
  TRANSMISSIONS,
  FUEL_TYPES,
  BODY_TYPES,
  CONDITIONS,
} from '@/lib/inventory/specs'
import { Gallery } from '@/components/storefront/gallery'
import { StoreFooter } from '@/components/storefront/footer'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params
  const [data, base] = await Promise.all([getShowcaseVehicle(id), getBaseUrl()])
  if (!data) {
    return { title: 'Vehículo no encontrado', robots: { index: false, follow: false } }
  }
  const { account, vehicle: v } = data
  const name = account.public_name?.trim() || account.name
  const title = `${v.brand} ${v.model} ${v.year} — $${formatPrice(v.price)} | ${name}`
  const parts = [`${v.brand} ${v.model} ${v.year}`]
  if (v.mileage != null) parts.push(`${formatPrice(v.mileage)} km`)
  if (v.transmission) parts.push(labelOf(TRANSMISSIONS, v.transmission))
  if (v.fuel_type) parts.push(labelOf(FUEL_TYPES, v.fuel_type))
  const description = `${parts.join(' · ')}. Disponible en ${name}. Contáctanos por WhatsApp.`
  return {
    metadataBase: new URL(base),
    title: { absolute: title },
    description,
    robots: { index: true, follow: true },
    alternates: { canonical: `/vehiculo/${v.id}` },
    // og:image lo aporta vehiculo/[id]/opengraph-image.tsx (generada).
    openGraph: {
      title,
      description,
      url: `${base}/vehiculo/${v.id}`,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  }
}

export default async function VehiclePage({ params }: Params) {
  const { id } = await params
  const [data, base] = await Promise.all([getShowcaseVehicle(id), getBaseUrl()])
  if (!data) notFound()

  const { account, vehicle: v } = data
  const feats = featuresToList(v.features)

  const specs: [string, string][] = [
    ['Año', String(v.year)],
    ['Kilometraje', v.mileage != null ? `${formatPrice(v.mileage)} km` : '—'],
    ['Transmisión', labelOf(TRANSMISSIONS, v.transmission)],
    ['Combustible', labelOf(FUEL_TYPES, v.fuel_type)],
    ['Carrocería', labelOf(BODY_TYPES, v.body_type)],
    ['Color', v.color || '—'],
    ['Condición', labelOf(CONDITIONS, v.condition)],
    ['Puertas', v.doors != null ? String(v.doors) : '—'],
  ]

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Car',
    name: `${v.brand} ${v.model} ${v.year}`,
    brand: v.brand,
    model: v.model,
    vehicleModelDate: String(v.year),
    ...(v.images && v.images.length ? { image: v.images } : {}),
    ...(v.mileage != null
      ? {
          mileageFromOdometer: {
            '@type': 'QuantitativeValue',
            value: v.mileage,
            unitCode: 'KMT',
          },
        }
      : {}),
    ...(v.color ? { color: v.color } : {}),
    ...(v.fuel_type ? { fuelType: labelOf(FUEL_TYPES, v.fuel_type) } : {}),
    ...(v.body_type ? { bodyType: labelOf(BODY_TYPES, v.body_type) } : {}),
    ...(v.doors != null ? { numberOfDoors: v.doors } : {}),
    offers: {
      '@type': 'Offer',
      priceCurrency: 'USD',
      price: v.price,
      availability: 'https://schema.org/InStock',
      url: `${base}/vehiculo/${v.id}`,
    },
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="mx-auto max-w-6xl px-4 py-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-900"
        >
          <ArrowLeft className="size-4" />
          Volver al catálogo
        </Link>
      </div>

      <main className="mx-auto max-w-6xl px-4 pb-14">
        <div className="grid gap-8 lg:grid-cols-2">
          <Gallery images={v.images ?? []} alt={`${v.brand} ${v.model} ${v.year}`} />

          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {v.brand} {v.model} {v.year}
            </h1>
            <p className="mt-2 text-3xl font-extrabold">${formatPrice(v.price)}</p>

            <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {specs.map(([k, val]) => (
                <div key={k} className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
                  <dt className="text-xs text-slate-500">{k}</dt>
                  <dd className="mt-0.5 text-sm font-semibold text-slate-900">{val}</dd>
                </div>
              ))}
            </dl>

            {feats.length > 0 && (
              <div className="mt-6">
                <h2 className="mb-2 text-sm font-semibold text-slate-900">
                  Características
                </h2>
                <ul className="flex flex-wrap gap-2">
                  {feats.map((f, i) => (
                    <li
                      key={i}
                      className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600"
                    >
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {account.public_whatsapp && (
              <a
                href={whatsappHref(account.public_whatsapp, v)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 px-6 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-green-700 sm:w-auto"
              >
                Comenzar compra por WhatsApp
              </a>
            )}
          </div>
        </div>
      </main>

      <StoreFooter account={account} />
    </div>
  )
}
