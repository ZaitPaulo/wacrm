// ============================================================
// Tipos + helpers PUROS de la vitrina (usables en cliente y servidor).
// Sin dependencias de Supabase — el acceso a datos server-only vive en
// ./data.ts, para no arrastrar el service-role al bundle del cliente.
// ============================================================

import { CURRENCIES } from '@/lib/currency'

export interface ShowcaseAccount {
  id: string
  name: string
  /** Moneda de la cuenta; los precios de los vehículos se muestran con su símbolo. */
  default_currency: string
  public_whatsapp: string | null
  public_name: string | null
  public_logo_url: string | null
  public_address: string | null
  public_phone: string | null
  public_email: string | null
  public_hours: string | null
}

export interface ShowcaseVehicle {
  id: string
  brand: string
  model: string
  year: number
  price: number
  mileage: number | null
  transmission: string | null
  fuel_type: string | null
  body_type: string | null
  condition: string | null
  features: Record<string, unknown> | unknown[] | null
  images: string[] | null
}

export interface ShowcaseData {
  account: ShowcaseAccount
  vehicles: ShowcaseVehicle[]
}

/** Vehículo con todos los campos que muestra la página de detalle. */
export interface ShowcaseVehicleDetail extends ShowcaseVehicle {
  color: string | null
  doors: number | null
}

/** Formatea un número con separadores de miles (sin decimales). */
/** Número con separadores de miles, sin unidad. Para kilometraje y demás. */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat('es', { maximumFractionDigits: 0 }).format(value)
}

/**
 * Precio con el símbolo de la moneda de la cuenta.
 *
 * Los precios de `inventory_vehicles` se guardan como números pelados: la
 * moneda vive una sola vez en `accounts.default_currency`, así que hay que
 * pasarla acá. Antes el símbolo estaba escrito a mano en cada pantalla, lo
 * que daba `$` incluso para cuentas en euros o yenes.
 */
export function formatPrice(value: number, currency: string): string {
  const symbol =
    CURRENCIES.find((c) => c.code === currency)?.symbol ?? `${currency} `
  return `${symbol}${formatNumber(value)}`
}

/** Convierte el JSONB `features` en una lista de etiquetas legibles. */
export function featuresToList(features: ShowcaseVehicle['features']): string[] {
  if (!features) return []
  if (Array.isArray(features)) return features.map((f) => String(f)).filter(Boolean)
  return Object.entries(features).map(([k, v]) => (v === true ? k : `${k}: ${String(v)}`))
}

/** Construye el enlace wa.me con un mensaje prellenado sobre el vehículo. */
export function whatsappHref(
  number: string,
  vehicle: Pick<ShowcaseVehicle, 'brand' | 'model' | 'year'>,
): string {
  const digits = number.replace(/\D/g, '')
  const msg = `Hola, me interesa el ${vehicle.brand} ${vehicle.model} ${vehicle.year}. ¿Sigue disponible?`
  return `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`
}
