import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import {
  CheckCircle2,
  Camera,
  CameraOff,
  ArrowLeft,
  ArrowRight,
} from 'lucide-react'
import { WhatsAppIcon } from '@/components/storefront/whatsapp-icon'
import { getShowcaseVehicle } from '@/lib/showcase/data'
import { getBaseUrl } from '@/lib/showcase/site-url'
import {
  featuresToList,
  whatsappHref,
  requestPhotosHref,
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
import { ShareVehicleButton } from '@/components/storefront/share-vehicle-button'
import { Gallery } from '@/components/storefront/gallery'
import { VehicleCard } from '@/components/storefront/storefront'
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
      <span className="text-[11px] font-bold uppercase tracking-wider text-[#75777e]">
        {label}
      </span>
      <span className="text-base font-bold text-[#191c1e] font-[family-name:var(--font-barlow-condensed)]">
        {value}
      </span>
    </div>
  )
}

export default async function VehiclePage({ params }: Params) {
  const { id } = await params
  const [data, base] = await Promise.all([getShowcaseVehicle(id), getBaseUrl()])
  if (!data) notFound()

  const { account, vehicle: v, similarVehicles } = data
  const t = await getTranslations('Inventory')
  const s = await getTranslations('Storefront')
  const feats = featuresToList(v.features)
  const name = account.public_name?.trim() || account.name
  const hasPhotos = Boolean(v.images && v.images.length > 0)
  const priceFormatted = formatPrice(v.price, account.default_currency)

  const specRows: [string, string][] = [
    [s('transmission'), labelOf(t, TRANSMISSIONS, v.transmission)],
    [s('fuel'), labelOf(t, FUEL_TYPES, v.fuel_type)],
    [s('bodyType'), labelOf(t, BODY_TYPES, v.body_type)],
    [s('color'), v.color || '—'],
    [s('condition'), labelOf(t, CONDITIONS, v.condition)],
  ]

  const waDigits = account.public_whatsapp?.replace(/\D/g, '') || null
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

      <main className="mx-auto w-full max-w-[1280px] flex-grow space-y-12 px-4 sm:px-6 py-8 pb-28 lg:pb-12 lg:px-12">
        {/* Enlace para volver */}
        <div>
          <Link
            href="/#inventario"
            className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#75777e] hover:text-black transition-colors"
          >
            <ArrowLeft className="size-3.5" />
            <span>{s('backToInventory')}</span>
          </Link>
        </div>

        {/* Hero split: Galería (8 cols) + Panel anclado (4 cols) */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          {/* 7.3 & 7.4 Galería o Bloque de Marca */}
          <div className="lg:col-span-8">
            {hasPhotos ? (
              <Gallery images={v.images ?? []} alt={`${v.brand} ${v.model} ${v.year}`} />
            ) : (
              <div className="flex aspect-video w-full flex-col items-center justify-center rounded-2xl bg-[#11161f] p-8 text-center text-white shadow-xs">
                {account.public_logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={account.public_logo_url}
                    alt={name}
                    className="max-h-12 max-w-[200px] object-contain brightness-0 invert opacity-80"
                  />
                ) : (
                  <span className="text-3xl font-black uppercase tracking-tight text-white font-[family-name:var(--font-barlow-condensed)]">
                    {name}
                  </span>
                )}
                <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-xs font-medium text-neutral-300">
                  <CameraOff className="size-4" />
                  <span>{s('noPhotosYet')}</span>
                </div>
                <p className="mt-2 max-w-sm text-xs text-neutral-400">
                  {s('noPhotosYetDescription')}
                </p>
              </div>
            )}
          </div>

          {/* 7.1 Panel anclado de precio y contacto en desktop */}
          <div className="flex flex-col gap-6 lg:col-span-4">
            <div className="lg:sticky lg:top-24 space-y-6">
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-[#e6e8ea] px-3 py-1 text-xs font-semibold text-[#191c1e]">
                  <span className="size-2 rounded-full bg-[#0070ea]" />
                  {s('available')}
                </div>
                <h1 className="text-3xl font-bold uppercase tracking-tight text-[#191c1e] sm:text-4xl font-[family-name:var(--font-barlow-condensed)]">
                  {v.brand} {v.model} <span className="font-normal text-[#75777e]">{v.year}</span>
                </h1>
                <p className="mt-2 text-3xl font-black tabular-nums tracking-tight text-[#191c1e] font-[family-name:var(--font-barlow-condensed)]">
                  {priceFormatted}
                </p>
              </div>

              {/* Stats clave */}
              <div className="grid grid-cols-2 gap-4 border-y border-[#c5c6cd]/50 py-4">
                <Stat label={s('year')} value={String(v.year)} />
                <Stat
                  label={s('mileage')}
                  value={v.mileage != null ? `${formatNumber(v.mileage)} km` : '—'}
                />
                <Stat label={s('fuel')} value={labelOf(t, FUEL_TYPES, v.fuel_type)} />
                <Stat label={s('condition')} value={labelOf(t, CONDITIONS, v.condition)} />
              </div>

              {/* 7.5 Código de referencia y su explicación */}
              {v.public_ref && (
                <div className="rounded-xl border border-[#c5c6cd]/50 bg-white p-4 space-y-1 shadow-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-[#75777e]">
                      {s('refCodeLabel')}
                    </span>
                    <span className="font-mono text-xs font-bold text-[#191c1e] bg-[#f2f4f6] px-2.5 py-1 rounded">
                      {v.public_ref}
                    </span>
                  </div>
                  <p className="text-xs text-[#75777e] leading-relaxed">
                    {s('refCodeExplanation')}
                  </p>
                </div>
              )}

              {/* Acciones principales */}
              <div className="flex flex-col gap-3">
                {account.public_whatsapp && (
                  hasPhotos ? (
                    <>
                      <a
                        href={whatsappHref(account.public_whatsapp, v)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex w-full min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[#25D366] px-6 py-3.5 text-xs font-bold uppercase tracking-wider text-white shadow-xs transition-colors hover:bg-[#20b358]"
                      >
                        <WhatsAppIcon className="size-4" />
                        <span>{s('interested')}</span>
                      </a>
                      {testDriveHref && (
                        <a
                          href={testDriveHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex w-full min-h-[44px] items-center justify-center gap-2 rounded-lg border-2 border-black px-6 py-3.5 text-xs font-bold uppercase tracking-wider text-black transition-colors hover:bg-[#f2f4f6]"
                        >
                          <span>{s('bookTestDrive')}</span>
                        </a>
                      )}
                    </>
                  ) : (
                    <a
                      href={requestPhotosHref(account.public_whatsapp, v)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex w-full min-h-[44px] items-center justify-center gap-2 rounded-lg bg-(--brand) px-6 py-3.5 text-xs font-bold uppercase tracking-wider text-white shadow-xs transition-opacity hover:opacity-90"
                    >
                      <Camera className="size-4" />
                      <span>{s('requestPhotos')}</span>
                    </a>
                  )
                )}
                <ShareVehicleButton
                  vehicle={v}
                  currency={account.default_currency}
                  baseUrl={base}
                  variant="detail"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Detalles: Especificaciones y Características */}
        <div className="grid grid-cols-1 gap-12 border-t border-[#c5c6cd]/50 pt-12 lg:grid-cols-2">
          {/* Especificaciones */}
          <div className="space-y-6">
            <h2 className="border-b border-[#c5c6cd]/50 pb-4 text-2xl font-bold uppercase tracking-tight text-[#191c1e] font-[family-name:var(--font-barlow-condensed)]">
              {s('specifications')}
            </h2>
            <div className="flex flex-col divide-y divide-[#c5c6cd]/40">
              {specRows.map(([k, val], i) => (
                <div
                  key={k}
                  className={`flex justify-between py-3.5 ${
                    i % 2 === 1 ? 'rounded bg-[#f2f4f6] px-3' : 'px-1'
                  }`}
                >
                  <span className="text-sm font-semibold text-[#75777e]">{k}</span>
                  <span className="text-sm font-bold text-[#191c1e]">{val}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Características */}
          {feats.length > 0 && (
            <div className="space-y-6">
              <h2 className="border-b border-[#c5c6cd]/50 pb-4 text-2xl font-bold uppercase tracking-tight text-[#191c1e] font-[family-name:var(--font-barlow-condensed)]">
                {s('features')}
              </h2>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {feats.map((f, i) => (
                  <li key={i} className="flex items-center gap-2.5 text-sm font-medium text-[#191c1e]">
                    <CheckCircle2 className="size-4 shrink-0 text-(--brand)" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* 7.6 Sección de vehículos parecidos */}
        {similarVehicles && similarVehicles.length > 0 && (
          <section className="border-t border-[#c5c6cd]/50 pt-12 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold uppercase tracking-tight text-[#191c1e] font-[family-name:var(--font-barlow-condensed)]">
                {s('similarVehicles')}
              </h2>
              <Link
                href="/#inventario"
                className="text-xs font-bold uppercase tracking-wider text-(--brand) hover:underline inline-flex items-center gap-1"
              >
                <span>{s('backToInventory')}</span>
                <ArrowRight className="size-3.5" />
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {similarVehicles.map((sim) => (
                <VehicleCard
                  key={sim.id}
                  v={sim}
                  account={account}
                  whatsapp={account.public_whatsapp}
                  currency={account.default_currency}
                  baseUrl={base}
                  isRecent={false}
                />
              ))}
            </div>
          </section>
        )}
      </main>

      {/* 7.2 Barra inferior anclada en móvil */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#c5c6cd]/40 bg-white/95 backdrop-blur-md p-3 px-4 flex items-center justify-between gap-3 shadow-lg lg:hidden">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#75777e] block">
            {v.brand} {v.model}
          </span>
          <span className="text-lg font-black tabular-nums tracking-tight text-[#191c1e] font-[family-name:var(--font-barlow-condensed)]">
            {priceFormatted}
          </span>
        </div>

        {account.public_whatsapp && (
          hasPhotos ? (
            <a
              href={whatsappHref(account.public_whatsapp, v)}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-lg bg-[#25D366] px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-xs active:bg-[#20b358]"
            >
              <WhatsAppIcon className="size-4" />
              <span>{s('interested')}</span>
            </a>
          ) : (
            <a
              href={requestPhotosHref(account.public_whatsapp, v)}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-lg bg-(--brand) px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-xs active:opacity-90"
            >
              <Camera className="size-4" />
              <span>{s('requestPhotos')}</span>
            </a>
          )
        )}
      </div>

      <StoreFooter account={account} />
    </div>
  )
}
