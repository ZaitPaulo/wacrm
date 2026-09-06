'use client'

import { useState, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import Image from 'next/image'
import {
  Search,
  X,
  SlidersHorizontal,
  ChevronDown,
  Camera,
  Sparkles,
  Gauge,
  CameraOff,
  SearchX,
} from 'lucide-react'
import { WhatsAppIcon } from './whatsapp-icon'
import { ShareVehicleButton } from './share-vehicle-button'
import type { ShowcaseVehicle, ShowcaseAccount } from '@/lib/showcase/format'
import {
  whatsappHref,
  requestPhotosHref,
  formatPrice,
  formatNumber,
} from '@/lib/showcase/format'
import {
  TRANSMISSIONS,
  FUEL_TYPES,
  type SpecOption,
} from '@/lib/inventory/specs'
import {
  INITIAL_FILTER_STATE,
  hasActiveFilters,
  countActiveFilters,
  getRecentVehicleIds,
  filterVehicles,
  sortVehicles,
  type StorefrontFilterState,
  type SortOption,
} from './storefront-filter'

export { serializeFilterState, hasActiveFilters, countActiveFilters } from './storefront-filter'

const SELECT_CLASS =
  'w-full appearance-none rounded-lg border border-[#c5c6cd] bg-[#f2f4f6] min-h-[44px] py-2 pl-3 pr-8 text-xs font-semibold text-[#191c1e] outline-none transition-all focus:border-(--brand) focus:ring-2 focus:ring-(--brand)/20'

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-bold uppercase tracking-wider text-[#75777e]">
        {label}
      </label>
      <div className="relative">
        <select
          className={SELECT_CLASS}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-[#75777e]" />
      </div>
    </div>
  )
}

function presentOptions(
  vehicles: ShowcaseVehicle[],
  pick: (v: ShowcaseVehicle) => string | null,
  catalog: SpecOption[],
): SpecOption[] {
  const present = new Set(vehicles.map(pick).filter((x): x is string => !!x))
  return catalog.filter((o) => present.has(o.value))
}

function niceBudgetTiers(maxPrice: number): number[] {
  if (maxPrice <= 0) return []
  const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(maxPrice)) - 1))
  const tiers = [0.2, 0.4, 0.6, 0.8].map(
    (f) => Math.ceil((maxPrice * f) / mag) * mag,
  )
  return Array.from(new Set(tiers)).filter((t) => t > 0 && t < maxPrice)
}

export function VehicleCard({
  v,
  account,
  whatsapp,
  currency,
  baseUrl,
  isRecent,
}: {
  v: ShowcaseVehicle
  account: ShowcaseAccount
  whatsapp: string | null
  currency: string
  baseUrl: string
  isRecent: boolean
}) {
  const t = useTranslations('Inventory')
  const s = useTranslations('Storefront')
  const image = v.images?.[0] ?? null
  const displayName = account.public_name?.trim() || account.name
  const href = `/vehiculo/${v.id}`

  const specsParts: string[] = []
  if (v.mileage != null) {
    specsParts.push(`${formatNumber(v.mileage)} km`)
  } else {
    specsParts.push('—')
  }
  if (v.transmission) {
    const opt = TRANSMISSIONS.find((o) => o.value === v.transmission)
    specsParts.push(opt ? t(opt.labelKey) : v.transmission)
  }
  if (v.fuel_type) {
    const opt = FUEL_TYPES.find((o) => o.value === v.fuel_type)
    specsParts.push(opt ? t(opt.labelKey) : v.fuel_type)
  }
  const specsLine = specsParts.join(' · ')

  let badge: React.ReactNode = null
  if (v.condition === 'new') {
    badge = (
      <span className="rounded bg-black/90 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white shadow-xs">
        {s('new')}
      </span>
    )
  } else if (isRecent) {
    badge = (
      <span className="rounded bg-(--brand) px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white shadow-xs">
        {s('recentlyAdded')}
      </span>
    )
  } else if (v.images && v.images.length > 1) {
    badge = (
      <span className="inline-flex items-center gap-1 rounded bg-black/75 px-2 py-1 text-[11px] font-semibold text-white shadow-xs">
        <Camera className="size-3" />
        <span>{v.images.length}</span>
      </span>
    )
  }

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-xl border border-[#c5c6cd]/40 bg-white shadow-[0_4px_20px_-4px_rgba(0,0,0,0.06)] transition-all duration-300 hover:shadow-lg hover:border-black/30">
      <div className="relative aspect-[16/10] sm:aspect-video w-full overflow-hidden bg-[#11161f]">
        {image ? (
          <Image
            src={image}
            alt={`${v.brand} ${v.model} ${v.year}`}
            fill
            sizes="(min-width: 1280px) 380px, (min-width: 768px) 45vw, 100vw"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center text-white">
            {account.public_logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={account.public_logo_url}
                alt={displayName}
                className="max-h-8 max-w-[140px] object-contain brightness-0 invert opacity-80"
              />
            ) : (
              <span className="text-xl font-black uppercase tracking-tight text-white font-[family-name:var(--font-barlow-condensed)]">
                {displayName}
              </span>
            )}
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-neutral-300">
              <CameraOff className="size-3.5" />
              <span>{s('noPhotosYet')}</span>
            </div>
          </div>
        )}

        {badge && <div className="absolute left-3 top-3 z-10">{badge}</div>}
      </div>

      <div className="flex flex-1 flex-col p-5">
        <p className="text-[11px] font-bold uppercase tracking-wider text-[#75777e]">
          {v.brand}
        </p>
        <h3 className="mt-0.5 text-xl font-bold uppercase tracking-tight text-[#191c1e] font-[family-name:var(--font-barlow-condensed)] group-hover:text-(--brand) transition-colors line-clamp-1">
          {v.model} <span className="font-normal text-[#75777e]">{v.year}</span>
        </h3>

        {specsLine && (
          <p className="mt-2 text-xs font-medium text-[#44474d] line-clamp-1">
            {specsLine}
          </p>
        )}

        <hr className="my-4 border-t border-[#c5c6cd]/40" />

        <div className="mt-auto space-y-3">
          <div className="text-2xl font-black tabular-nums tracking-tight text-[#191c1e] font-[family-name:var(--font-barlow-condensed)]">
            {formatPrice(v.price, currency)}
          </div>

          <div className="flex gap-2">
            {whatsapp ? (
              image ? (
                <a
                  href={whatsappHref(whatsapp, v)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative z-20 flex flex-1 min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[#25D366] px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition-colors hover:bg-[#20b358]"
                >
                  <WhatsAppIcon className="size-4 shrink-0" />
                  <span>{s('interested')}</span>
                </a>
              ) : (
                <a
                  href={requestPhotosHref(whatsapp, v)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative z-20 flex flex-1 min-h-[44px] items-center justify-center gap-2 rounded-lg bg-(--brand) px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition-opacity hover:opacity-90"
                >
                  <Camera className="size-4 shrink-0" />
                  <span>{s('requestPhotos')}</span>
                </a>
              )
            ) : null}
            <ShareVehicleButton vehicle={v} currency={currency} baseUrl={baseUrl} />
          </div>
        </div>
      </div>

      <Link
        href={href}
        className="absolute inset-0 z-10"
        aria-label={s('viewVehicle', { vehicle: `${v.brand} ${v.model} ${v.year}` })}
      />
    </article>
  )
}

export function Storefront({
  vehicles,
  account,
  whatsapp,
  currency,
  baseUrl,
}: {
  vehicles: ShowcaseVehicle[]
  account?: ShowcaseAccount
  whatsapp?: string | null
  currency: string
  baseUrl: string
}) {
  const t = useTranslations('Inventory')
  const s = useTranslations('Storefront')

  const safeAccount: ShowcaseAccount = account ?? {
    id: 'default',
    name: 'Showcase',
    default_currency: currency,
    public_whatsapp: whatsapp ?? null,
    public_brand_color: null,
    public_name: null,
    public_logo_url: null,
    public_address: null,
    public_phone: null,
    public_email: null,
    public_hours: null,
  }

  const effectiveWhatsapp = whatsapp ?? safeAccount.public_whatsapp
  const displayName = safeAccount.public_name?.trim() || safeAccount.name

  const [state, setState] = useState<StorefrontFilterState>(INITIAL_FILTER_STATE)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)

  const recentIds = useMemo(() => getRecentVehicleIds(vehicles, 12), [vehicles])

  const brands = useMemo(
    () => Array.from(new Set(vehicles.map((v) => v.brand))).sort(),
    [vehicles],
  )
  const years = useMemo(
    () => Array.from(new Set(vehicles.map((v) => v.year))).sort((a, b) => b - a),
    [vehicles],
  )
  const maxPrice = useMemo(
    () => vehicles.reduce((m, v) => Math.max(m, v.price), 0),
    [vehicles],
  )
  const maxMileage = useMemo(
    () => vehicles.reduce((m, v) => Math.max(m, v.mileage ?? 0), 0),
    [vehicles],
  )
  const budgetTiers = useMemo(() => niceBudgetTiers(maxPrice), [maxPrice])
  const mileageTiers = useMemo(
    () => [10000, 30000, 50000, 100000, 200000].filter((tier) => tier < maxMileage),
    [maxMileage],
  )
  const transmissionOpts = useMemo(
    () => presentOptions(vehicles, (v) => v.transmission, TRANSMISSIONS),
    [vehicles],
  )
  const fuelOpts = useMemo(
    () => presentOptions(vehicles, (v) => v.fuel_type, FUEL_TYPES),
    [vehicles],
  )

  const filtered = useMemo(
    () => filterVehicles(vehicles, state, recentIds),
    [vehicles, state, recentIds],
  )
  const shown = useMemo(
    () => sortVehicles(filtered, state.sort),
    [filtered, state.sort],
  )

  const active = useMemo(() => hasActiveFilters(state), [state])
  const activeCount = useMemo(() => countActiveFilters(state), [state])

  const clear = () => setState(INITIAL_FILTER_STATE)

  return (
    <>
      {/* 4.7 Banda de marca de altura fija */}
      <section className="w-full border-b border-black/10 bg-black px-4 sm:px-6 py-6 lg:px-12 text-white">
        <div className="mx-auto flex max-w-[1280px] flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black uppercase tracking-tight font-[family-name:var(--font-barlow-condensed)]">
              {s('heroTitle')}
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-neutral-300">
              {s('heroSubtitle')}
            </p>
          </div>
          <span className="hidden sm:inline-block rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-neutral-200">
            {s('ogAvailability', { count: vehicles.length })}
          </span>
        </div>
      </section>

      {/* 4.4 & 6.1 Bloque de controles anclado sticky top-0 */}
      <div className="sticky top-0 z-40 w-full border-b border-[#c5c6cd]/50 bg-white/95 backdrop-blur-md shadow-xs">
        <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-12 py-3 space-y-3">
          {/* Fila 1: Logo/Nombre y Buscador por texto (todos los tamaños) */}
          <div className="flex items-center justify-between gap-3 sm:gap-4">
            <Link href="/" className="flex items-center gap-2 shrink-0">
              {safeAccount.public_logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={safeAccount.public_logo_url}
                  alt={displayName}
                  className="h-7 md:h-8 w-auto object-contain"
                />
              ) : (
                <span className="text-xl md:text-2xl font-black uppercase tracking-tight text-black font-[family-name:var(--font-barlow-condensed)]">
                  {displayName}
                </span>
              )}
            </Link>

            <div className="relative flex-1 max-w-lg">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#75777e]" />
              <input
                type="text"
                value={state.q}
                onChange={(e) => setState((prev) => ({ ...prev, q: e.target.value }))}
                placeholder={s('searchPlaceholder')}
                className="w-full min-h-[44px] rounded-lg border border-[#c5c6cd] bg-[#f2f4f6] pl-9 pr-9 text-xs sm:text-sm text-[#191c1e] outline-none transition-all focus:border-(--brand) focus:ring-2 focus:ring-(--brand)/20"
              />
              {state.q && (
                <button
                  type="button"
                  onClick={() => setState((prev) => ({ ...prev, q: '' }))}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#75777e] hover:text-[#191c1e]"
                  aria-label={s('clear')}
                >
                  <X className="size-4" />
                </button>
              )}
            </div>

            <div className="hidden md:flex items-center gap-3 shrink-0">
              {effectiveWhatsapp && (
                <a
                  href={`https://wa.me/${effectiveWhatsapp.replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-bold uppercase tracking-wider text-[#44474d] hover:text-black transition-colors"
                >
                  {s('contact')}
                </a>
              )}
              <Link
                href="/login"
                className="inline-flex min-h-[40px] items-center justify-center rounded-lg bg-black px-4 py-2 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-neutral-800"
              >
                {s('signIn')}
              </Link>
            </div>
          </div>

          {/* 6.1 Fila 2 en móvil: Botón de filtros + atajos horizontales deslizables */}
          <div className="flex md:hidden items-center gap-2 pt-1 border-t border-[#c5c6cd]/30">
            <button
              type="button"
              onClick={() => setMobileFiltersOpen((prev) => !prev)}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[#c5c6cd] bg-white px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#191c1e] shrink-0 active:bg-[#f2f4f6]"
            >
              <SlidersHorizontal className="size-4" />
              <span>{s('filters')}</span>
              {activeCount > 0 && (
                <span className="flex size-5 items-center justify-center rounded-full bg-black text-[10px] font-bold text-white">
                  {activeCount}
                </span>
              )}
            </button>

            <div className="flex items-center gap-2 overflow-x-auto py-1 scrollbar-none flex-1">
              <button
                type="button"
                onClick={() => setState((prev) => ({ ...prev, withPhotos: !prev.withPhotos }))}
                className={`inline-flex min-h-[38px] items-center gap-1 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors shrink-0 ${
                  state.withPhotos
                    ? 'bg-black text-white'
                    : 'border border-[#c5c6cd] bg-white text-[#44474d]'
                }`}
              >
                <Camera className="size-3" />
                {s('shortcutWithPhotos')}
              </button>
              <button
                type="button"
                onClick={() => setState((prev) => ({ ...prev, automatic: !prev.automatic }))}
                className={`inline-flex min-h-[38px] items-center gap-1 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors shrink-0 ${
                  state.automatic
                    ? 'bg-black text-white'
                    : 'border border-[#c5c6cd] bg-white text-[#44474d]'
                }`}
              >
                <Gauge className="size-3" />
                {s('shortcutAutomatic')}
              </button>
              <button
                type="button"
                onClick={() => setState((prev) => ({ ...prev, recent: !prev.recent }))}
                className={`inline-flex min-h-[38px] items-center gap-1 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors shrink-0 ${
                  state.recent
                    ? 'bg-black text-white'
                    : 'border border-[#c5c6cd] bg-white text-[#44474d]'
                }`}
              >
                <Sparkles className="size-3" />
                {s('shortcutRecentlyAdded')}
              </button>
            </div>
          </div>

          {/* 4.4 Fila (b): Los 6 selectores de filtros en desktop */}
          <div className="hidden md:grid md:grid-cols-6 gap-2.5">
            <SelectField
              label={s('brand')}
              value={state.brand}
              onChange={(v) => setState((prev) => ({ ...prev, brand: v }))}
            >
              <option value="">{s('anyFeminine')}</option>
              {brands.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </SelectField>

            <SelectField
              label={s('year')}
              value={state.year}
              onChange={(v) => setState((prev) => ({ ...prev, year: v }))}
            >
              <option value="">{s('anyYear')}</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </SelectField>

            <SelectField
              label={s('budget')}
              value={state.budget}
              onChange={(v) => setState((prev) => ({ ...prev, budget: v }))}
            >
              <option value="">{s('noLimit')}</option>
              {budgetTiers.map((t) => (
                <option key={t} value={t}>
                  {s('upTo', { value: formatPrice(t, currency) })}
                </option>
              ))}
            </SelectField>

            <SelectField
              label={s('mileage')}
              value={state.mileage}
              onChange={(v) => setState((prev) => ({ ...prev, mileage: v }))}
            >
              <option value="">{s('noLimit')}</option>
              {mileageTiers.map((t) => (
                <option key={t} value={t}>
                  {s('upTo', { value: `${formatNumber(t)} km` })}
                </option>
              ))}
            </SelectField>

            <SelectField
              label={s('transmission')}
              value={state.transmission}
              onChange={(v) => setState((prev) => ({ ...prev, transmission: v }))}
            >
              <option value="">{s('anyFeminine')}</option>
              {transmissionOpts.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(o.labelKey)}
                </option>
              ))}
            </SelectField>

            <SelectField
              label={s('fuel')}
              value={state.fuel}
              onChange={(v) => setState((prev) => ({ ...prev, fuel: v }))}
            >
              <option value="">{s('anyMasculine')}</option>
              {fuelOpts.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(o.labelKey)}
                </option>
              ))}
            </SelectField>
          </div>

          {/* 6.2 Desplegable de filtros en móvil */}
          {mobileFiltersOpen && (
            <div className="md:hidden pt-3 border-t border-[#c5c6cd]/40 space-y-3 max-h-[60vh] overflow-y-auto pb-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-[#191c1e]">
                  {s('filters')} {activeCount > 0 ? `(${activeCount})` : ''}
                </span>
                {active && (
                  <button
                    type="button"
                    onClick={clear}
                    className="min-h-[44px] inline-flex items-center text-xs font-bold uppercase tracking-wider text-(--brand) hover:underline"
                  >
                    {s('clearFilters')}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <SelectField
                  label={s('brand')}
                  value={state.brand}
                  onChange={(v) => setState((prev) => ({ ...prev, brand: v }))}
                >
                  <option value="">{s('anyFeminine')}</option>
                  {brands.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </SelectField>

                <SelectField
                  label={s('year')}
                  value={state.year}
                  onChange={(v) => setState((prev) => ({ ...prev, year: v }))}
                >
                  <option value="">{s('anyYear')}</option>
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </SelectField>

                <SelectField
                  label={s('budget')}
                  value={state.budget}
                  onChange={(v) => setState((prev) => ({ ...prev, budget: v }))}
                >
                  <option value="">{s('noLimit')}</option>
                  {budgetTiers.map((t) => (
                    <option key={t} value={t}>
                      {s('upTo', { value: formatPrice(t, currency) })}
                    </option>
                  ))}
                </SelectField>

                <SelectField
                  label={s('mileage')}
                  value={state.mileage}
                  onChange={(v) => setState((prev) => ({ ...prev, mileage: v }))}
                >
                  <option value="">{s('noLimit')}</option>
                  {mileageTiers.map((t) => (
                    <option key={t} value={t}>
                      {s('upTo', { value: `${formatNumber(t)} km` })}
                    </option>
                  ))}
                </SelectField>

                <SelectField
                  label={s('transmission')}
                  value={state.transmission}
                  onChange={(v) => setState((prev) => ({ ...prev, transmission: v }))}
                >
                  <option value="">{s('anyFeminine')}</option>
                  {transmissionOpts.map((o) => (
                    <option key={o.value} value={o.value}>
                      {t(o.labelKey)}
                    </option>
                  ))}
                </SelectField>

                <SelectField
                  label={s('fuel')}
                  value={state.fuel}
                  onChange={(v) => setState((prev) => ({ ...prev, fuel: v }))}
                >
                  <option value="">{s('anyMasculine')}</option>
                  {fuelOpts.map((o) => (
                    <option key={o.value} value={o.value}>
                      {t(o.labelKey)}
                    </option>
                  ))}
                </SelectField>
              </div>

              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                className="w-full min-h-[44px] rounded-lg bg-black text-white text-xs font-bold uppercase tracking-wider transition-colors hover:bg-neutral-800 shadow-xs"
              >
                {s('applyFilters', { count: shown.length })}
              </button>
            </div>
          )}

          {/* 4.4 Fila (c): Atajos rápidos, conteo y orden (desktop) */}
          <div className="hidden md:flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#c5c6cd]/30">
            <div className="flex items-center gap-2 overflow-x-auto py-1 scrollbar-none">
              <button
                type="button"
                onClick={() => setState((prev) => ({ ...prev, withPhotos: !prev.withPhotos }))}
                className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-bold uppercase tracking-wider transition-colors shrink-0 ${
                  state.withPhotos
                    ? 'bg-black text-white'
                    : 'border border-[#c5c6cd] bg-white text-[#44474d] hover:bg-[#f2f4f6]'
                }`}
              >
                <Camera className="size-3.5" />
                {s('shortcutWithPhotos')}
              </button>
              <button
                type="button"
                onClick={() => setState((prev) => ({ ...prev, automatic: !prev.automatic }))}
                className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-bold uppercase tracking-wider transition-colors shrink-0 ${
                  state.automatic
                    ? 'bg-black text-white'
                    : 'border border-[#c5c6cd] bg-white text-[#44474d] hover:bg-[#f2f4f6]'
                }`}
              >
                <Gauge className="size-3.5" />
                {s('shortcutAutomatic')}
              </button>
              <button
                type="button"
                onClick={() => setState((prev) => ({ ...prev, recent: !prev.recent }))}
                className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-bold uppercase tracking-wider transition-colors shrink-0 ${
                  state.recent
                    ? 'bg-black text-white'
                    : 'border border-[#c5c6cd] bg-white text-[#44474d] hover:bg-[#f2f4f6]'
                }`}
              >
                <Sparkles className="size-3.5" />
                {s('shortcutRecentlyAdded')}
              </button>
            </div>

            <div className="flex items-center gap-3 ml-auto">
              <span className="text-xs font-bold uppercase tracking-wider text-[#44474d] whitespace-nowrap">
                {active
                  ? s('resultsCount', { shown: shown.length, total: vehicles.length })
                  : s('totalCount', { total: vehicles.length })}
              </span>

              {active && (
                <button
                  type="button"
                  onClick={clear}
                  className="inline-flex min-h-[36px] items-center gap-1 text-xs font-bold uppercase tracking-wider text-(--brand) hover:underline"
                >
                  <X className="size-3.5" />
                  {s('clear')}
                </button>
              )}

              <div className="relative">
                <select
                  value={state.sort}
                  onChange={(e) => setState((prev) => ({ ...prev, sort: e.target.value as SortOption }))}
                  className="appearance-none rounded-lg border border-[#c5c6cd] bg-[#f2f4f6] min-h-[36px] py-1.5 pl-3 pr-8 text-xs font-bold uppercase tracking-wider text-[#191c1e] outline-none transition-all focus:border-(--brand)"
                >
                  <option value="">{s('sort')}</option>
                  <option value="price_asc">{s('sortLowestPrice')}</option>
                  <option value="price_desc">{s('sortHighestPrice')}</option>
                  <option value="mileage_asc">{s('sortLowestMileage')}</option>
                  <option value="year_desc">{s('sortNewestYear')}</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[#75777e]" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Grilla y Estado Vacío */}
      <section className="w-full bg-[#f7f9fb] px-4 sm:px-6 py-8 pb-28 md:pb-12 lg:px-12">
        <div className="mx-auto max-w-[1280px]">
          {shown.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-[#c5c6cd]/40 bg-white p-12 text-center shadow-xs">
              <div className="rounded-full bg-[#f2f4f6] p-4 text-[#75777e]">
                <SearchX className="size-8" />
              </div>
              <h3 className="mt-4 text-xl font-bold uppercase tracking-tight text-[#191c1e] font-[family-name:var(--font-barlow-condensed)]">
                {s('emptyTitle')}
              </h3>
              <p className="mt-2 max-w-md text-sm text-[#44474d]">
                {s('emptySubtitle')}
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={clear}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-[#c5c6cd] bg-white px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-[#191c1e] transition-colors hover:bg-[#f2f4f6]"
                >
                  <X className="size-4" />
                  {s('clearFilters')}
                </button>
                {effectiveWhatsapp && (
                  <a
                    href={`https://wa.me/${effectiveWhatsapp.replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[#25D366] px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-white transition-colors hover:bg-[#20b358]"
                  >
                    <WhatsAppIcon className="size-4" />
                    {s('contactDealership')}
                  </a>
                )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {shown.map((v) => (
                <VehicleCard
                  key={v.id}
                  v={v}
                  account={safeAccount}
                  whatsapp={effectiveWhatsapp}
                  currency={currency}
                  baseUrl={baseUrl}
                  isRecent={recentIds.has(v.id)}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 6.4 Barra inferior anclada en móvil */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#c5c6cd]/40 bg-white/95 backdrop-blur-md p-3 flex gap-2 md:hidden shadow-lg">
        <button
          type="button"
          onClick={() => setMobileFiltersOpen((prev) => !prev)}
          className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-2 rounded-lg border border-[#c5c6cd] bg-white px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-[#191c1e] shadow-xs active:bg-[#f2f4f6]"
        >
          <SlidersHorizontal className="size-4" />
          <span>{s('filters')}</span>
          {activeCount > 0 && (
            <span className="flex size-5 items-center justify-center rounded-full bg-black text-[10px] font-bold text-white">
              {activeCount}
            </span>
          )}
        </button>
        {effectiveWhatsapp && (
          <a
            href={`https://wa.me/${effectiveWhatsapp.replace(/\D/g, '')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-2 rounded-lg bg-[#25D366] px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-xs active:bg-[#20b358]"
          >
            <WhatsAppIcon className="size-4" />
            <span>{s('contact')}</span>
          </a>
        )}
      </div>
    </>
  )
}
