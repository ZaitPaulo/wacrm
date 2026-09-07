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
  BODY_TYPES,
  type SpecOption,
} from '@/lib/inventory/specs'
import {
  INITIAL_FILTER_STATE,
  hasActiveFilters,
  countActiveFilters,
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

/**
 * Los siete selectores de filtro, en un solo sitio.
 *
 * Los consumen dos contenedores con maquetación distinta —el lateral fijo
 * de escritorio (una columna) y el panel desplegable del teléfono (dos)—,
 * así que este componente solo emite los campos y deja la rejilla a quien
 * lo monta. Antes estaban escritos dos veces y cualquier cambio había que
 * hacerlo por duplicado.
 */
function FilterFields({
  state,
  setState,
  brands,
  years,
  budgetTiers,
  mileageTiers,
  transmissionOpts,
  fuelOpts,
  bodyOpts,
  currency,
}: {
  state: StorefrontFilterState
  setState: React.Dispatch<React.SetStateAction<StorefrontFilterState>>
  brands: string[]
  years: number[]
  budgetTiers: number[]
  mileageTiers: number[]
  transmissionOpts: SpecOption[]
  fuelOpts: SpecOption[]
  bodyOpts: SpecOption[]
  currency: string
}) {
  const t = useTranslations('Inventory')
  const s = useTranslations('Storefront')

  return (
    <>
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
        {budgetTiers.map((tier) => (
          <option key={tier} value={tier}>
            {s('upTo', { value: formatPrice(tier, currency) })}
          </option>
        ))}
      </SelectField>

      <SelectField
        label={s('mileage')}
        value={state.mileage}
        onChange={(v) => setState((prev) => ({ ...prev, mileage: v }))}
      >
        <option value="">{s('noLimit')}</option>
        {mileageTiers.map((tier) => (
          <option key={tier} value={tier}>
            {s('upTo', { value: `${formatNumber(tier)} km` })}
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

      <SelectField
        label={s('bodyType')}
        value={state.body}
        onChange={(v) => setState((prev) => ({ ...prev, body: v }))}
      >
        <option value="">{s('anyFeminine')}</option>
        {bodyOpts.map((o) => (
          <option key={o.value} value={o.value}>
            {t(o.labelKey)}
          </option>
        ))}
      </SelectField>
    </>
  )
}

export function VehicleCard({
  v,
  account,
  whatsapp,
  currency,
  baseUrl,
}: {
  v: ShowcaseVehicle
  account: ShowcaseAccount
  whatsapp: string | null
  currency: string
  baseUrl: string
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
  // El catálogo de `Inventory` lo consume ahora `FilterFields`, que es
  // quien traduce las etiquetas de transmisión, combustible y carrocería.
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
  const bodyOpts = useMemo(
    () => presentOptions(vehicles, (v) => v.body_type, BODY_TYPES),
    [vehicles],
  )

  const filtered = useMemo(
    () => filterVehicles(vehicles, state),
    [vehicles, state],
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
      {/* Cabecera fija: marca y buscador en todos los anchos; por debajo
          de `lg`, además, el botón que abre los filtros y el conteo. Los
          selectores en sí viven en el lateral (ver más abajo). */}
      <div className="sticky top-0 z-40 w-full border-b border-[#c5c6cd]/50 bg-white/95 backdrop-blur-md shadow-xs">
        <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-12 py-3 space-y-3">
          {/* Marca a la izquierda; buscador y orden pegados al borde
              derecho, en la misma línea. Por debajo de `md` la fila se
              parte: el orden se queda junto al logo y el buscador baja a
              ocupar el ancho completo, que es lo único que cabe en un
              teléfono sin encoger los tres a la vez.

              La banda negra de bienvenida y el par "Contacto / Iniciar
              sesión" se retiraron por pedido del negocio; el acceso al CRM
              sigue en el pie, como "Administración". */}
          <div className="flex flex-wrap items-center gap-3 sm:gap-4">
            <Link href="/" className="order-1 flex items-center gap-2 shrink-0">
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

            <div className="relative order-3 w-full md:order-2 md:ml-auto md:w-80 lg:w-[26rem]">
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

            <div className="relative order-2 ml-auto shrink-0 md:order-3 md:ml-0">
              <select
                value={state.sort}
                onChange={(e) => setState((prev) => ({ ...prev, sort: e.target.value as SortOption }))}
                className="appearance-none rounded-lg border border-[#c5c6cd] bg-white min-h-[44px] py-1.5 pl-3 pr-8 text-xs font-bold uppercase tracking-wider text-[#191c1e] outline-none transition-all focus:border-(--brand)"
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

          {/* Por debajo de `lg` no hay lateral, así que los filtros se
              alcanzan desde aquí. Esta fila viaja con la cabecera fija: es
              lo que evita volver arriba para cambiar un criterio, que era
              el defecto de la maqueta original en el teléfono. */}
          <div className="flex lg:hidden items-center gap-2 pt-1 border-t border-[#c5c6cd]/30">
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

            {/* En `lg` el conteo vive en el pie del lateral; aquí acompaña
                al botón para que siga siendo permanente al hacer scroll. */}
            <span className="text-xs font-bold uppercase tracking-wider text-[#44474d] whitespace-nowrap">
              {active
                ? s('resultsCount', { shown: shown.length, total: vehicles.length })
                : s('totalCount', { total: vehicles.length })}
            </span>

            {active && (
              <button
                type="button"
                onClick={clear}
                className="ml-auto inline-flex min-h-[44px] items-center gap-1 text-xs font-bold uppercase tracking-wider text-(--brand) shrink-0"
              >
                <X className="size-3.5" />
                {s('clear')}
              </button>
            )}
          </div>

          {/* Panel de filtros por debajo de `lg`: se abre sobre la lista,
              sin sacar al visitante de los resultados ni perder el scroll. */}
          {mobileFiltersOpen && (
            <div className="lg:hidden pt-3 border-t border-[#c5c6cd]/40 space-y-3 max-h-[60vh] overflow-y-auto pb-2">
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
                <FilterFields
                  state={state}
                  setState={setState}
                  brands={brands}
                  years={years}
                  budgetTiers={budgetTiers}
                  mileageTiers={mileageTiers}
                  transmissionOpts={transmissionOpts}
                  fuelOpts={fuelOpts}
                  bodyOpts={bodyOpts}
                  currency={currency}
                />
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
        </div>
      </div>

      {/* Inventario: lateral de filtros fijo + grilla.
          El lateral vuelve a ser la maqueta original por pedido del negocio:
          la barra superior de filtros se sentía cargada. Lo que NO vuelve es
          el punto débil de aquella versión —en pantallas angostas los filtros
          quedaban tras un botón que se perdía al hacer scroll—: por debajo de
          `lg` siguen viviendo en el panel que se abre desde la cabecera fija. */}
      <section id="inventario" className="w-full scroll-mt-24 bg-[#f7f9fb] px-4 sm:px-6 py-8 pb-28 lg:pb-12 lg:px-12">
        <div className="mx-auto grid max-w-[1280px] gap-8 lg:grid-cols-[280px_minmax(0,1fr)]">

          <aside className="hidden h-fit lg:sticky lg:top-24 lg:block rounded-xl border border-[#c5c6cd]/50 bg-white p-5 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.06)]">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wider text-[#191c1e] font-[family-name:var(--font-barlow-condensed)]">
                {s('filters')}
              </h3>
              {active && (
                <button
                  type="button"
                  onClick={clear}
                  className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-(--brand) hover:underline"
                >
                  <X className="size-3.5" />
                  {s('clear')}
                </button>
              )}
            </div>

            <div className="space-y-4">
              <FilterFields
                state={state}
                setState={setState}
                brands={brands}
                years={years}
                budgetTiers={budgetTiers}
                mileageTiers={mileageTiers}
                transmissionOpts={transmissionOpts}
                fuelOpts={fuelOpts}
                bodyOpts={bodyOpts}
                currency={currency}
              />
            </div>

            <p className="mt-5 border-t border-[#c5c6cd]/50 pt-4 text-xs font-bold uppercase tracking-wider text-[#44474d]">
              {active
                ? s('resultsCount', { shown: shown.length, total: vehicles.length })
                : s('totalCount', { total: vehicles.length })}
            </p>
          </aside>

          <div>
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
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {shown.map((v) => (
                <VehicleCard
                  key={v.id}
                  v={v}
                  account={safeAccount}
                  whatsapp={effectiveWhatsapp}
                  currency={currency}
                  baseUrl={baseUrl}
                />
              ))}
            </div>
          )}
          </div>
        </div>
      </section>

      {/* 6.4 Barra inferior anclada en móvil */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#c5c6cd]/40 bg-white/95 backdrop-blur-md p-3 flex gap-2 lg:hidden shadow-lg">
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
