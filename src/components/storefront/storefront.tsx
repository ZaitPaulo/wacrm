'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { X, SlidersHorizontal, ChevronDown } from 'lucide-react';
import { WhatsAppIcon } from './whatsapp-icon';
import type { ShowcaseVehicle } from '@/lib/showcase/format';
import { whatsappHref, formatPrice, featuresToList } from '@/lib/showcase/format';
import {
  labelOf,
  TRANSMISSIONS,
  FUEL_TYPES,
  BODY_TYPES,
  type SpecOption,
} from '@/lib/inventory/specs';

// Réplica del diseño "Loramotors Storefront" (Stitch): hero + PANEL DE
// FILTROS STICKY A LA IZQUIERDA + grid. Filtros de industria: marca,
// modelo, año, precio, kilometraje, transmisión, combustible, carrocería.

const LUXURY_SHADOW = 'shadow-[0_10px_25px_-5px_rgba(10,25,47,0.05)]';
const SELECT_CLASS =
  'w-full appearance-none rounded-lg border border-[#c5c6cd] bg-[#f2f4f6] py-2 pl-3 pr-9 text-sm text-[#191c1e] outline-none transition-all focus:border-[#0059bb] focus:ring-2 focus:ring-[#0059bb]/20';

// Filtro tipo dropdown (label + <select> con chevron), al estilo de los
// Select del formulario del CRM.
function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-semibold uppercase tracking-wide text-[#44474d]">
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
  );
}

function presentOptions(
  vehicles: ShowcaseVehicle[],
  pick: (v: ShowcaseVehicle) => string | null,
  catalog: SpecOption[],
): SpecOption[] {
  const present = new Set(vehicles.map(pick).filter((x): x is string => !!x));
  return catalog.filter((o) => present.has(o.value));
}

// Tramos de presupuesto legibles derivados del precio máximo — funciona
// igual con miles (USD) o millones (COP).
function niceBudgetTiers(maxPrice: number): number[] {
  if (maxPrice <= 0) return [];
  const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(maxPrice)) - 1));
  const tiers = [0.2, 0.4, 0.6, 0.8].map(
    (f) => Math.ceil((maxPrice * f) / mag) * mag,
  );
  return Array.from(new Set(tiers)).filter((t) => t > 0 && t < maxPrice);
}

function VehicleCard({
  v,
  whatsapp,
}: {
  v: ShowcaseVehicle;
  whatsapp: string | null;
}) {
  const image = v.images?.[0] ?? null;
  const body = labelOf(BODY_TYPES, v.body_type);
  const subtitle = body !== '—' ? body : featuresToList(v.features)[0];
  const href = `/vehiculo/${v.id}`;

  return (
    <article
      className={`group flex flex-col overflow-hidden rounded-xl border border-[#c5c6cd]/30 bg-white ${LUXURY_SHADOW} transition-transform duration-300 hover:scale-[1.02]`}
    >
      <div className="relative aspect-video overflow-hidden bg-[#f2f4f6]">
        {image ? (
          <Image
            src={image}
            alt={`${v.brand} ${v.model} ${v.year}`}
            fill
            sizes="(min-width: 1024px) 380px, (min-width: 768px) 45vw, 100vw"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-[#75777e]">
            Sin foto
          </div>
        )}
        {v.condition === 'new' && (
          <div className="absolute right-4 top-4 rounded-full border border-[#0059bb]/20 bg-white/90 px-3 py-1 text-xs font-semibold text-[#0059bb] backdrop-blur-sm">
            Nuevo
          </div>
        )}
        <Link
          href={href}
          className="absolute inset-0"
          aria-label={`Ver ${v.brand} ${v.model} ${v.year}`}
        />
      </div>

      <div className="flex flex-grow flex-col p-6">
        <Link href={href}>
          <h3 className="text-xl font-semibold leading-tight text-[#191c1e] transition-colors group-hover:text-[#0059bb]">
            {v.brand} {v.model}
          </h3>
        </Link>
        {subtitle && (
          <p className="mb-6 mt-1 text-xs font-semibold uppercase tracking-wider text-[#44474d]">
            {subtitle}
          </p>
        )}

        <div className="mb-6 grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-[#75777e]">
              Año
            </span>
            <span className="font-medium tabular-nums text-[#191c1e]">{v.year}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-[#75777e]">
              Kilometraje
            </span>
            <span className="font-medium tabular-nums text-[#191c1e]">
              {v.mileage != null ? `${formatPrice(v.mileage)} km` : '—'}
            </span>
          </div>
        </div>

        <div className="mt-auto space-y-3 border-t border-[#c5c6cd]/30 pt-6">
          <div className="text-2xl font-bold tabular-nums text-[#0d1c32]">
            ${formatPrice(v.price)}
          </div>
          {whatsapp ? (
            <a
              href={whatsappHref(whatsapp, v)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#25D366] px-5 py-3 text-xs font-semibold uppercase tracking-wide text-white transition-colors hover:bg-[#20b358]"
            >
              <WhatsAppIcon className="size-[18px]" />
              Me interesa
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function Storefront({
  vehicles,
  whatsapp,
  heroImage,
}: {
  vehicles: ShowcaseVehicle[];
  whatsapp: string | null;
  heroImage: string | null;
}) {
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [budget, setBudget] = useState('');
  const [mileageMax, setMileageMax] = useState('');
  const [transmission, setTransmission] = useState('');
  const [fuel, setFuel] = useState('');
  const [body, setBody] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const brands = useMemo(
    () => Array.from(new Set(vehicles.map((v) => v.brand))).sort(),
    [vehicles],
  );
  const models = useMemo(() => {
    const pool = brand ? vehicles.filter((v) => v.brand === brand) : vehicles;
    return Array.from(new Set(pool.map((v) => v.model))).sort();
  }, [vehicles, brand]);
  const years = useMemo(
    () => Array.from(new Set(vehicles.map((v) => v.year))).sort((a, b) => b - a),
    [vehicles],
  );
  const maxPrice = useMemo(
    () => vehicles.reduce((m, v) => Math.max(m, v.price), 0),
    [vehicles],
  );
  const maxMileage = useMemo(
    () => vehicles.reduce((m, v) => Math.max(m, v.mileage ?? 0), 0),
    [vehicles],
  );
  const budgetTiers = useMemo(() => niceBudgetTiers(maxPrice), [maxPrice]);
  const mileageTiers = useMemo(
    () => [10000, 30000, 50000, 100000, 200000].filter((t) => t < maxMileage),
    [maxMileage],
  );
  const transmissionOpts = useMemo(
    () => presentOptions(vehicles, (v) => v.transmission, TRANSMISSIONS),
    [vehicles],
  );
  const fuelOpts = useMemo(
    () => presentOptions(vehicles, (v) => v.fuel_type, FUEL_TYPES),
    [vehicles],
  );
  const bodyOpts = useMemo(
    () => presentOptions(vehicles, (v) => v.body_type, BODY_TYPES),
    [vehicles],
  );

  const shown = useMemo(
    () =>
      vehicles.filter((v) => {
        if (brand && v.brand !== brand) return false;
        if (model && v.model !== model) return false;
        if (year && String(v.year) !== year) return false;
        if (budget && v.price > Number(budget)) return false;
        if (mileageMax && (v.mileage == null || v.mileage > Number(mileageMax)))
          return false;
        if (transmission && v.transmission !== transmission) return false;
        if (fuel && v.fuel_type !== fuel) return false;
        if (body && v.body_type !== body) return false;
        return true;
      }),
    [vehicles, brand, model, year, budget, mileageMax, transmission, fuel, body],
  );

  const hasFilters =
    brand !== '' ||
    model !== '' ||
    year !== '' ||
    budget !== '' ||
    mileageMax !== '' ||
    transmission !== '' ||
    fuel !== '' ||
    body !== '';

  function clear() {
    setBrand('');
    setModel('');
    setYear('');
    setBudget('');
    setMileageMax('');
    setTransmission('');
    setFuel('');
    setBody('');
  }

  return (
    <>
      {/* Hero */}
      <section className="relative flex min-h-[55vh] w-full items-center overflow-hidden bg-white px-6 py-16 lg:px-12">
        <div className="absolute inset-0 z-0">
          {heroImage ? (
            <Image
              src={heroImage}
              alt=""
              fill
              priority
              sizes="100vw"
              className="object-cover opacity-90"
            />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-r from-white via-white/70 to-white/20" />
        </div>

        <div className="relative z-10 mx-auto w-full max-w-[1280px]">
          <h1 className="mb-5 max-w-2xl text-4xl font-bold leading-tight tracking-tight text-[#191c1e] sm:text-5xl">
            Encuentra el auto de tus sueños
          </h1>
          <p className="mb-8 max-w-xl text-lg text-[#44474d]">
            Calidad premium, confianza garantizada. Explora nuestra selección de
            vehículos inspeccionados.
          </p>
          <a
            href="#inventario"
            className="inline-flex items-center justify-center rounded-lg bg-black px-8 py-3 text-xs font-semibold uppercase tracking-wide text-white transition-colors hover:bg-[#0059bb]"
          >
            Ver inventario
          </a>
        </div>
      </section>

      {/* Inventario: filtros a la izquierda + grid */}
      <section
        id="inventario"
        className="w-full scroll-mt-24 bg-[#f7f9fb] px-6 py-16 lg:px-12"
      >
        <div className="mx-auto max-w-[1280px]">
          <div className="mb-8">
            <h2 className="mb-1 text-2xl font-semibold text-[#191c1e]">
              Inventario Destacado
            </h2>
            <p className="text-[#44474d]">Descubre los vehículos disponibles hoy.</p>
          </div>

          <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
            {/* Sidebar de filtros */}
            <div>
              <button
                type="button"
                onClick={() => setShowFilters((s) => !s)}
                className="mb-4 inline-flex items-center gap-2 rounded-lg border border-[#c5c6cd] bg-white px-4 py-2 text-sm font-medium text-[#191c1e] lg:hidden"
              >
                <SlidersHorizontal className="size-4" />
                Filtros
              </button>

              <aside
                className={`${showFilters ? 'block' : 'hidden'} h-fit rounded-xl border border-[#c5c6cd] bg-white p-5 ${LUXURY_SHADOW} lg:sticky lg:top-24 lg:block`}
              >
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[#191c1e]">Filtros</h3>
                  {hasFilters && (
                    <button
                      type="button"
                      onClick={clear}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#0059bb] hover:underline"
                    >
                      <X className="size-3.5" />
                      Limpiar
                    </button>
                  )}
                </div>

                <div className="space-y-4">
                  <SelectField
                    label="Marca"
                    value={brand}
                    onChange={(v) => {
                      setBrand(v);
                      setModel('');
                    }}
                  >
                    <option value="">Todas</option>
                    {brands.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </SelectField>
                  <SelectField label="Modelo" value={model} onChange={setModel}>
                    <option value="">Todos</option>
                    {models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </SelectField>
                  <SelectField label="Año" value={year} onChange={setYear}>
                    <option value="">Cualquiera</option>
                    {years.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </SelectField>
                  <SelectField label="Presupuesto" value={budget} onChange={setBudget}>
                    <option value="">Sin límite</option>
                    {budgetTiers.map((t) => (
                      <option key={t} value={t}>
                        Hasta ${formatPrice(t)}
                      </option>
                    ))}
                  </SelectField>
                  <SelectField
                    label="Kilometraje"
                    value={mileageMax}
                    onChange={setMileageMax}
                  >
                    <option value="">Sin límite</option>
                    {mileageTiers.map((t) => (
                      <option key={t} value={t}>
                        Hasta {formatPrice(t)} km
                      </option>
                    ))}
                  </SelectField>
                  {transmissionOpts.length > 0 && (
                    <SelectField
                      label="Transmisión"
                      value={transmission}
                      onChange={setTransmission}
                    >
                      <option value="">Todas</option>
                      {transmissionOpts.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </SelectField>
                  )}
                  {fuelOpts.length > 0 && (
                    <SelectField label="Combustible" value={fuel} onChange={setFuel}>
                      <option value="">Todos</option>
                      {fuelOpts.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </SelectField>
                  )}
                  {bodyOpts.length > 0 && (
                    <SelectField label="Carrocería" value={body} onChange={setBody}>
                      <option value="">Todas</option>
                      {bodyOpts.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </SelectField>
                  )}
                </div>

                <p className="mt-5 border-t border-[#c5c6cd] pt-4 text-sm text-[#44474d]">
                  {shown.length} de {vehicles.length} vehículos
                </p>
              </aside>
            </div>

            {/* Grid */}
            <div>
              {shown.length === 0 ? (
                <p className="py-16 text-center text-[#44474d]">
                  No hay vehículos que coincidan con tu búsqueda.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
                  {shown.map((v) => (
                    <VehicleCard key={v.id} v={v} whatsapp={whatsapp} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
