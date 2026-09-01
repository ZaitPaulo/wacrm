// ============================================================
// Compartir un vehículo por WhatsApp.
//
// Módulo PURO: arma el texto y el enlace, sin tocar el DOM ni depender
// de React. Lo usan los tres lugares donde aparece el botón —vitrina,
// ficha del vehículo e inventario del CRM— para que al cliente le
// llegue el mismo mensaje salga de donde salga.
//
// No confundir con `whatsappHref()` de ./format: aquél abre un chat CON
// el negocio (wa.me/<número>) para que el interesado pregunte. Éste abre
// wa.me SIN número, así WhatsApp pregunta a quién enviarle la ficha —
// que es justo lo que hace quien comparte.
// ============================================================

import type { ShowcaseVehicle } from './format'
import { formatNumber, formatPrice } from './format'
import {
  FUEL_TYPES,
  TRANSMISSIONS,
  labelOf,
  type SpecTranslator,
} from '@/lib/inventory/specs'

/**
 * Lo mínimo que hace falta para compartir. Se declara por campos y no
 * como `ShowcaseVehicle` porque el inventario del CRM comparte filas de
 * `InventoryVehicle`, que tiene otras columnas pero éstas iguales.
 */
export type ShareableVehicle = Pick<
  ShowcaseVehicle,
  'id' | 'brand' | 'model' | 'year' | 'price' | 'mileage' | 'transmission' | 'fuel_type'
>

/** URL pública de la ficha. `baseUrl` puede venir con o sin barra final. */
export function vehicleShareUrl(baseUrl: string, vehicleId: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/vehiculo/${vehicleId}`
}

/**
 * Base pública del sitio, del lado del cliente.
 *
 * Prefiere `NEXT_PUBLIC_SITE_URL` —la misma que usa `getBaseUrl()` en el
 * servidor— porque el CRM puede atenderse por un host interno mientras
 * la vitrina vive en el dominio público, y el link que se comparte tiene
 * que ser el público. Si no está configurada, cae al origen actual.
 *
 * Devuelve cadena vacía fuera del navegador y sin configuración: quien
 * llama debe tratarlo como "todavía no sé la URL", no como raíz del
 * sitio. Por eso los componentes de la vitrina reciben la base por prop
 * desde el servidor en vez de llamar aquí.
 */
export function publicBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '')
  if (configured) return configured
  if (typeof window !== 'undefined') return window.location.origin
  return ''
}

/**
 * Mensaje listo para pegar en WhatsApp: título, especificaciones y link.
 *
 * ```
 * Toyota Corolla 2020 — $85.000.000
 * 45.000 km · Automático
 *
 * https://ejemplo.com/vehiculo/<id>
 * ```
 *
 * El link va en su propio párrafo a propósito: WhatsApp arma la tarjeta
 * de vista previa (la imagen la genera `vehiculo/[id]/opengraph-image`)
 * y con el enlace suelto al final se ve más limpia. El texto igual dice
 * lo esencial, para cuando la vista previa no carga.
 *
 * Las especificaciones se omiten si el vehículo no las tiene cargadas —
 * mejor una línea menos que un renglón lleno de guiones.
 */
export function vehicleShareMessage(
  vehicle: ShareableVehicle,
  { currency, url, t }: { currency: string; url: string; t: SpecTranslator },
): string {
  const title =
    `${vehicle.brand} ${vehicle.model} ${vehicle.year}` +
    ` — ${formatPrice(vehicle.price, currency)}`

  const specs: string[] = []
  if (vehicle.mileage != null) specs.push(`${formatNumber(vehicle.mileage)} km`)
  if (vehicle.transmission) {
    specs.push(labelOf(t, TRANSMISSIONS, vehicle.transmission))
  }
  if (vehicle.fuel_type) specs.push(labelOf(t, FUEL_TYPES, vehicle.fuel_type))

  const head = specs.length ? `${title}\n${specs.join(' · ')}` : title
  return `${head}\n\n${url}`
}

/**
 * Enlace que abre WhatsApp con el mensaje escrito y sin destinatario,
 * para que el usuario elija el chat.
 *
 * `wa.me` sin número es la forma documentada de "compartir hacia
 * WhatsApp": funciona igual en la app de escritorio, en web y en móvil.
 */
export function whatsappShareHref(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`
}
