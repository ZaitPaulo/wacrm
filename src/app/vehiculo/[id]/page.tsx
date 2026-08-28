import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { CheckCircle2 } from 'lucide-react'
import { WhatsAppIcon } from '@/components/storefront/whatsapp-icon'
import { getShowcaseVehicle } from '@/lib/showcase/data'
import { getBaseUrl } from '@/lib/showcase/site-url'
import {
  featuresToList,
  whatsappHref,
  formatPrice,
  formatNumber,
} from '@/lib/showcase/format'
import {
  labelOf,
  TRANSMISSIONS,
  FUEL_TYPES,
  BODY_TYPES,
  CONDITIONS,
} from '@/lib/inventory/specs'
import { formatRefTag } from '@/lib/inventory/public-ref'
import { Gallery } from '@/components/storefront/gallery'
import { StoreNav } from '@/components/storefront/store-nav'
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
  const vehicleName = `${v.brand} ${v.model} ${v.year}`
  const price = formatPrice(v.price, account.default_currency)
  // Dos títulos a propósito, porque compiten en sitios distintos.
  //
  // El de compartir abre con el nombre del negocio, por pedido del
  // cliente: en la tarjeta de WhatsApp es lo primero que se lee y es lo
  // que da confianza para abrir el enlace.
  //
  // El de la pestaña y los buscadores abre con el vehículo y deja el
  // negocio al final: ahí lo que compite es el modelo, y 134 fichas
  // empezando con la misma palabra se estorban entre sí.
  const shareTitle = `${name} | ${vehicleName} — ${price}`
  const pageTitle = `${vehicleName} — ${price} | ${name}`
  const t = await getTranslations('Inventory')
  const specs: string[] = []
  if (v.mileage != null) specs.push(`${formatNumber(v.mileage)} km`)
  if (v.transmission) specs.push(labelOf(t, TRANSMISSIONS, v.transmission))
  if (v.fuel_type) specs.push(labelOf(t, FUEL_TYPES, v.fuel_type))
  const description =
    `${name} — ${vehicleName}, ${price}.` +
    (specs.length ? ` ${specs.join(' · ')}.` : '') +
    ' Contáctanos por WhatsApp.'

  return {
    metadataBase: new URL(base),
    title: { absolute: pageTitle },
    description,
    robots: { index: true, follow: true },
    alternates: { canonical: `/vehiculo/${v.id}` },
    // og:image lo aporta vehiculo/[id]/opengraph-image.tsx (generada).
    openGraph: {
      title: shareTitle,
      description,
      url: `${base}/vehiculo/${v.id}`,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: shareTitle,
      description,
    },
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs font-semibold uppercase tracking-wider text-[#44474d]">
        {label}
      </span>
      <span className="text-lg text-[#191c1e]">{value}</span>
    </div>
  )
}

export default async function VehiclePage({ params }: Params) {
  const { id } = await params
  const [data, base] = await Promise.all([getShowcaseVehicle(id), getBaseUrl()])
  if (!data) notFound()

  const { account, vehicle: v } = data
  const t = await getTranslations('Inventory')
  const s = await getTranslations('Storefront')
  const feats = featuresToList(v.features)

  const specRows: [string, string][] = [
    [s('transmission'), labelOf(t, TRANSMISSIONS, v.transmission)],
    [s('fuel'), labelOf(t, FUEL_TYPES, v.fuel_type)],
    [s('bodyType'), labelOf(t, BODY_TYPES, v.body_type)],
    [s('color'), v.color || '—'],
    [s('condition'), labelOf(t, CONDITIONS, v.condition)],
  ]

  const waDigits = account.public_whatsapp?.replace(/\D/g, '') || null
  // Igual que el CTA de consulta: lleva el código para poder atribuir la
  // conversación a este vehículo. Una prueba de manejo es la consulta con
  // más intención de compra que existe, así que perderla sería lo peor.
  const testDriveHref = waDigits
    ? `https://wa.me/${waDigits}?text=${encodeURIComponent(
        `Hola, quiero agendar una prueba de manejo del ${v.brand} ${v.model} ${v.year}.` +
          (v.public_ref ? ` ${formatRefTag(v.public_ref)}` : ''),
      )}`
    : null

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
    ...(v.fuel_type ? { fuelType: labelOf(t, FUEL_TYPES, v.fuel_type) } : {}),
    ...(v.body_type ? { bodyType: labelOf(t, BODY_TYPES, v.body_type) } : {}),
    offers: {
      '@type': 'Offer',
      priceCurrency: 'USD',
      price: v.price,
      availability: 'https://schema.org/InStock',
      url: `${base}/vehiculo/${v.id}`,
    },
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#f7f9fb] text-[#191c1e]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <StoreNav account={account} />

      <main className="mx-auto w-full max-w-[1280px] flex-grow space-y-12 px-6 py-10 lg:px-12">
        {/* Hero split */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Galería (8 cols) */}
          <div className="lg:col-span-8">
            <Gallery images={v.images ?? []} alt={`${v.brand} ${v.model} ${v.year}`} />
          </div>

          {/* Info + acciones (4 cols) */}
          <div className="flex flex-col gap-6 lg:col-span-4">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-[#e6e8ea] px-3 py-1 text-xs font-semibold text-[#191c1e]">
                <span className="size-2 rounded-full bg-[#0070ea]" />
                {s('available')}
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-[#191c1e] sm:text-4xl">
                {v.brand} {v.model} {v.year}
              </h1>
              <p className="mt-2 text-2xl font-semibold text-[#0d1c32]">
                {formatPrice(v.price, account.default_currency)}
              </p>
            </div>

            {/* Stats clave */}
            <div className="grid grid-cols-2 gap-4 border-y border-[#c5c6cd] py-6">
              <Stat label={s('year')} value={String(v.year)} />
              <Stat
                label={s('mileage')}
                value={v.mileage != null ? `${formatNumber(v.mileage)} km` : '—'}
              />
              <Stat label={s('fuel')} value={labelOf(t, FUEL_TYPES, v.fuel_type)} />
              <Stat label={s('condition')} value={labelOf(t, CONDITIONS, v.condition)} />
            </div>

            {/* Acciones */}
            {account.public_whatsapp && (
              <div className="mt-2 flex flex-col gap-3">
                <a
                  href={whatsappHref(account.public_whatsapp, v)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#25D366] px-6 py-4 text-sm font-semibold uppercase tracking-wide text-white shadow-sm transition-colors hover:bg-[#20b358]"
                >
                  <WhatsAppIcon className="size-5" />
                  {s('interested')}
                </a>
                {testDriveHref && (
                  <a
                    href={testDriveHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-black px-6 py-4 text-sm font-semibold uppercase tracking-wide text-black transition-colors hover:bg-[#f2f4f6]"
                  >
                    {s('bookTestDrive')}
                  </a>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Detalles */}
        <div className="grid grid-cols-1 gap-12 border-t border-[#c5c6cd] pt-12 lg:grid-cols-2">
          {/* Especificaciones */}
          <div className="space-y-6">
            <h2 className="border-b border-[#c5c6cd] pb-4 text-2xl font-semibold text-[#191c1e]">
              {s('specifications')}
            </h2>
            <div className="flex flex-col divide-y divide-[#c5c6cd]">
              {specRows.map(([k, val], i) => (
                <div
                  key={k}
                  className={`flex justify-between py-3 ${
                    i % 2 === 1 ? 'rounded bg-[#f2f4f6] px-2' : ''
                  }`}
                >
                  <span className="text-[#44474d]">{k}</span>
                  <span className="font-medium text-[#191c1e]">{val}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Características */}
          {feats.length > 0 && (
            <div className="space-y-6">
              <h2 className="border-b border-[#c5c6cd] pb-4 text-2xl font-semibold text-[#191c1e]">
                {s('features')}
              </h2>
              <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {feats.map((f, i) => (
                  <li key={i} className="flex items-center gap-3 text-[#191c1e]">
                    <CheckCircle2 className="size-5 shrink-0 text-[#0059bb]" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </main>

      <StoreFooter account={account} />
    </div>
  )
}
