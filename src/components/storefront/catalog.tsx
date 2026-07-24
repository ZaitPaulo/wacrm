'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Gauge, Cog, Fuel, SlidersHorizontal, X } from 'lucide-react';
import type { ShowcaseVehicle } from '@/lib/showcase/format';
import { featuresToList, whatsappHref, formatPrice } from '@/lib/showcase/format';
import {
  TRANSMISSIONS,
  FUEL_TYPES,
  BODY_TYPES,
  labelOf,
  type SpecOption,
} from '@/lib/inventory/specs';

// Vitrina estilo ecommerce automotor: panel de filtros propios de la
// industria + grilla de tarjetas. Estilos con Tailwind concreto
// (independiente del tema del CRM).

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-4" aria-hidden="true">
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.95 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.22 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.42-.07-.13-.27-.2-.57-.35zM12.04 21.5h-.01a9.5 9.5 0 01-4.84-1.33l-.35-.2-3.6.94.96-3.51-.23-.36a9.46 9.46 0 01-1.45-5.05c0-5.24 4.27-9.5 9.52-9.5 2.54 0 4.93.99 6.73 2.79a9.44 9.44 0 012.79 6.72c0 5.24-4.27 9.5-9.52 9.5z" />
    </svg>
  );
}

const selectClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-slate-400 focus:outline-none';
const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none';

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className="mb-1 block text-xs font-semibold text-slate-500">{label}</span>
      {children}
    </div>
  );
}

function Spec({ icon: Icon, label }: { icon: typeof Gauge; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg bg-slate-50 py-2 text-center">
      <Icon className="size-4 text-slate-400" aria-hidden="true" />
      <span className="text-xs font-medium text-slate-600">{label}</span>
    </div>
  );
}

function VehicleCard({
  v,
  whatsapp,
}: {
  v: ShowcaseVehicle;
  whatsapp: string | null;
}) {
  const image = v.images?.[0] ?? null;
  const tag = featuresToList(v.features)[0];

  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70 transition duration-300 hover:-translate-y-1 hover:shadow-xl">
      <div className="relative aspect-[4/3] overflow-hidden bg-slate-100">
        {image ? (
          <Image
            src={image}
            alt={`${v.brand} ${v.model} ${v.year}`}
            fill
            sizes="(min-width: 1280px) 400px, (min-width: 640px) 45vw, 100vw"
            className="object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            Sin foto
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/55 to-transparent" />
        <span className="absolute bottom-3 left-3 rounded-lg bg-white/95 px-3 py-1 text-base font-extrabold text-slate-900 shadow-sm">
          ${formatPrice(v.price)}
        </span>
        <span className="absolute right-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-xs font-medium text-white backdrop-blur">
          {v.year}
        </span>
        <Link
          href={`/vehiculo/${v.id}`}
          className="absolute inset-0"
          aria-label={`Ver ${v.brand} ${v.model} ${v.year}`}
        />
      </div>

      <div className="flex flex-1 flex-col gap-3 p-5">
        <Link href={`/vehiculo/${v.id}`} className="block">
          <h3 className="text-lg font-bold tracking-tight text-slate-900 hover:text-slate-600">
            {v.brand} {v.model}
          </h3>
          {tag && <p className="mt-0.5 text-sm text-slate-500">{tag}</p>}
        </Link>

        <div className="grid grid-cols-3 gap-2">
          <Spec
            icon={Gauge}
            label={v.mileage != null ? `${formatPrice(v.mileage)} km` : '—'}
          />
          <Spec icon={Cog} label={labelOf(TRANSMISSIONS, v.transmission)} />
          <Spec icon={Fuel} label={labelOf(FUEL_TYPES, v.fuel_type)} />
        </div>

        <div className="mt-auto pt-1">
          {whatsapp ? (
            <a
              href={whatsappHref(whatsapp, v)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-green-700"
            >
              <WhatsAppIcon />
              Me interesa
            </a>
          ) : (
            <span className="text-xs text-slate-400">Contacto no disponible</span>
          )}
        </div>
      </div>
    </article>
  );
}

// Opciones presentes en los datos, mapeadas a sus etiquetas ES.
function presentOptions(
  vehicles: ShowcaseVehicle[],
  pick: (v: ShowcaseVehicle) => string | null,
  catalog: SpecOption[],
): SpecOption[] {
  const present = new Set(
    vehicles.map(pick).filter((x): x is string => !!x),
  );
  return catalog.filter((o) => present.has(o.value));
}

export function Catalog({
  vehicles,
  whatsapp,
}: {
  vehicles: ShowcaseVehicle[];
  whatsapp: string | null;
}) {
  const [brand, setBrand] = useState('all');
  const [model, setModel] = useState('all');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [mileageMax, setMileageMax] = useState('');
  const [yearMin, setYearMin] = useState('');
  const [yearMax, setYearMax] = useState('');
  const [transmission, setTransmission] = useState('all');
  const [fuel, setFuel] = useState('all');
  const [body, setBody] = useState('all');
  const [showFilters, setShowFilters] = useState(false);

  const brands = useMemo(
    () => Array.from(new Set(vehicles.map((v) => v.brand))).sort(),
    [vehicles],
  );
  const models = useMemo(() => {
    const pool = brand === 'all' ? vehicles : vehicles.filter((v) => v.brand === brand);
    return Array.from(new Set(pool.map((v) => v.model))).sort();
  }, [vehicles, brand]);

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

  const shown = useMemo(() => {
    const pMin = priceMin ? Number(priceMin) : null;
    const pMax = priceMax ? Number(priceMax) : null;
    const kMax = mileageMax ? Number(mileageMax) : null;
    const yMin = yearMin ? Number(yearMin) : null;
    const yMax = yearMax ? Number(yearMax) : null;
    return vehicles.filter((v) => {
      if (brand !== 'all' && v.brand !== brand) return false;
      if (model !== 'all' && v.model !== model) return false;
      if (pMin != null && v.price < pMin) return false;
      if (pMax != null && v.price > pMax) return false;
      if (kMax != null && (v.mileage == null || v.mileage > kMax)) return false;
      if (yMin != null && v.year < yMin) return false;
      if (yMax != null && v.year > yMax) return false;
      if (transmission !== 'all' && v.transmission !== transmission) return false;
      if (fuel !== 'all' && v.fuel_type !== fuel) return false;
      if (body !== 'all' && v.body_type !== body) return false;
      return true;
    });
  }, [
    vehicles,
    brand,
    model,
    priceMin,
    priceMax,
    mileageMax,
    yearMin,
    yearMax,
    transmission,
    fuel,
    body,
  ]);

  const hasFilters =
    brand !== 'all' ||
    model !== 'all' ||
    priceMin !== '' ||
    priceMax !== '' ||
    mileageMax !== '' ||
    yearMin !== '' ||
    yearMax !== '' ||
    transmission !== 'all' ||
    fuel !== 'all' ||
    body !== 'all';

  function clear() {
    setBrand('all');
    setModel('all');
    setPriceMin('');
    setPriceMax('');
    setMileageMax('');
    setYearMin('');
    setYearMax('');
    setTransmission('all');
    setFuel('all');
    setBody('all');
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[260px_1fr]">
      {/* Botón filtros (móvil) */}
      <button
        type="button"
        onClick={() => setShowFilters((s) => !s)}
        className="inline-flex items-center gap-2 self-start rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 lg:hidden"
      >
        <SlidersHorizontal className="size-4" />
        Filtros
      </button>

      {/* Panel de filtros */}
      <aside
        className={`${showFilters ? 'block' : 'hidden'} h-fit space-y-4 rounded-2xl border border-slate-200 bg-white p-5 lg:sticky lg:top-24 lg:block`}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">Filtros</h3>
          {hasFilters && (
            <button
              type="button"
              onClick={clear}
              className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"
            >
              <X className="size-3.5" />
              Limpiar
            </button>
          )}
        </div>

        <Field label="Marca">
          <select
            className={selectClass}
            value={brand}
            onChange={(e) => {
              setBrand(e.target.value);
              setModel('all');
            }}
          >
            <option value="all">Todas</option>
            {brands.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Modelo">
          <select
            className={selectClass}
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            <option value="all">Todos</option>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Precio (USD)">
          <div className="flex items-center gap-2">
            <input
              type="number"
              placeholder="Mín"
              className={inputClass}
              value={priceMin}
              onChange={(e) => setPriceMin(e.target.value)}
            />
            <span className="text-slate-400">–</span>
            <input
              type="number"
              placeholder="Máx"
              className={inputClass}
              value={priceMax}
              onChange={(e) => setPriceMax(e.target.value)}
            />
          </div>
        </Field>

        <Field label="Kilometraje (máx)">
          <input
            type="number"
            placeholder="Hasta… km"
            className={inputClass}
            value={mileageMax}
            onChange={(e) => setMileageMax(e.target.value)}
          />
        </Field>

        <Field label="Año">
          <div className="flex items-center gap-2">
            <input
              type="number"
              placeholder="Desde"
              className={inputClass}
              value={yearMin}
              onChange={(e) => setYearMin(e.target.value)}
            />
            <span className="text-slate-400">–</span>
            <input
              type="number"
              placeholder="Hasta"
              className={inputClass}
              value={yearMax}
              onChange={(e) => setYearMax(e.target.value)}
            />
          </div>
        </Field>

        {transmissionOpts.length > 0 && (
          <Field label="Transmisión">
            <select
              className={selectClass}
              value={transmission}
              onChange={(e) => setTransmission(e.target.value)}
            >
              <option value="all">Todas</option>
              {transmissionOpts.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        )}

        {fuelOpts.length > 0 && (
          <Field label="Combustible">
            <select
              className={selectClass}
              value={fuel}
              onChange={(e) => setFuel(e.target.value)}
            >
              <option value="all">Todos</option>
              {fuelOpts.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        )}

        {bodyOpts.length > 0 && (
          <Field label="Carrocería">
            <select
              className={selectClass}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            >
              <option value="all">Todas</option>
              {bodyOpts.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        )}
      </aside>

      {/* Resultados */}
      <div>
        <p className="mb-4 text-sm text-slate-500">
          {shown.length} vehículo{shown.length === 1 ? '' : 's'}
        </p>
        {shown.length === 0 ? (
          <p className="py-16 text-center text-slate-500">
            No hay vehículos que coincidan con los filtros.
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
  );
}
