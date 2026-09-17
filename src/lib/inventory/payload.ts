// ============================================================
// Validación/normalización del cuerpo de escritura de un vehículo,
// compartida por POST /api/inventory y PATCH /api/inventory/[id].
//
// `partial: false` (crear) exige brand/model/year; `partial: true`
// (editar) solo toca los campos presentes en el body.
// ============================================================

import {
  TRANSMISSION_VALUES,
  FUEL_TYPE_VALUES,
  BODY_TYPE_VALUES,
  CONDITION_VALUES,
} from './specs'

export const VEHICLE_STATUSES = [
  'available',
  'reserved',
  'sold',
  'hidden',
] as const
export type VehicleStatusValue = (typeof VEHICLE_STATUSES)[number]

export interface VehiclePayload {
  brand?: string
  model?: string
  year?: number
  license_plate?: string | null
  vin?: string | null
  price?: number
  mileage?: number | null
  transmission?: string | null
  fuel_type?: string | null
  body_type?: string | null
  color?: string | null
  condition?: string
  doors?: number | null
  status?: VehicleStatusValue
  // Campos de la lista de precios del cliente (510).
  engine_displacement?: string | null
  plate_city?: string | null
  warranty_price?: number | null
  soat_expires_at?: string | null
  tecnomecanica_expires_at?: string | null
  has_lien?: boolean
  on_display?: boolean
  accepts_trade_in?: boolean
  features?: Record<string, unknown> | unknown[]
  images?: string[]
  internal_notes?: string | null
  // Cierre de venta (508). Los tres se escriben juntos o se limpian
  // juntos — ver `applySoldCoherence`.
  sold_price?: number | null
  sold_at?: string | null
  sold_to_contact_id?: string | null
  // Propietario (525). Que el contacto sea de la cuenta lo valida la ruta
  // con `ownerContactError`: acá solo se normaliza la forma.
  owner_contact_id?: string | null
}

/**
 * Costo de compra. Va aparte del payload del vehículo porque persiste
 * en otra tabla (`vehicle_acquisitions`) y bajo otro permiso (admin+).
 */
export interface AcquisitionPayload {
  purchase_cost: number
  purchase_date: string | null
}

/**
 * Error de validación. `field` es el nombre de la columna que falló, y
 * viaja hasta el formulario para que marque ese input en rojo y lleve al
 * usuario hasta él en vez de dejarlo buscar a ojo cuál corregir.
 */
export interface PayloadError {
  error: string
  field?: string
}

type Result = { value: VehiclePayload } | PayloadError

/** Devuelve el string recortado, o undefined si no es un string. */
function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v.trim() : undefined
}

/**
 * Normaliza una fecha recibida del cliente.
 *
 * El año se limita al mismo rango que `year` (1900–2100), y no por gusto:
 * en un `<input type="date">` es fácil teclear el año de más y mandar
 * "112026-07-15". `Date.parse` lo acepta, `toISOString()` lo devuelve en
 * formato extendido ("+112026-07-15T00:00:00.000Z") y recortarlo a diez
 * caracteres dejaba "+112026-07". Postgres leía ese "+112026" como
 * desplazamiento de zona horaria y abortaba el INSERT con un 22009 que
 * llegaba al usuario como "No se pudo crear el vehículo", sin decir qué
 * campo era el culpable.
 *
 * @param raw Valor recibido, sin confiar.
 * @param dateOnly `true` recorta a YYYY-MM-DD (columnas DATE); `false`
 *   devuelve el ISO completo (columnas TIMESTAMPTZ).
 * @returns La fecha normalizada, o `null` si no es utilizable.
 */
function normalizeDate(raw: unknown, dateOnly: boolean): string | null {
  const s = str(raw)
  if (!s) return null
  const ms = Date.parse(s)
  if (Number.isNaN(ms)) return null
  const d = new Date(ms)
  const year = d.getUTCFullYear()
  if (year < 1900 || year > 2100) return null
  const iso = d.toISOString()
  return dateOnly ? iso.slice(0, 10) : iso
}

/** Error de fecha inválida, con el nombre del campo tal como lo ve el usuario. */
function dateError(field: string, label: string): PayloadError {
  return {
    error: `Revisa la fecha de ${label}: el año debe estar entre 1900 y 2100`,
    field,
  }
}

/**
 * Nombre de cada campo TAL COMO APARECE en el formulario de /inventory
 * (ver `Inventory.fields` en `messages/es.json`).
 *
 * El mensaje de error es lo único que el usuario tiene para saber qué
 * corregir, y "fuel_type inválido" no le dice nada a quien está mirando
 * un campo rotulado «Combustible». Al renombrar una etiqueta en pantalla
 * hay que actualizarla también acá.
 */
const LABELS = {
  brand: 'Marca',
  model: 'Línea',
  year: 'Año',
  license_plate: 'Placa',
  vin: 'VIN',
  price: 'Precio',
  mileage: 'Kilometraje',
  transmission: 'Transmisión',
  fuel_type: 'Combustible',
  body_type: 'Carrocería',
  condition: 'Condición',
  color: 'Color',
  doors: 'Puertas',
  status: 'Estado',
  warranty_price: 'Precio con garantía',
  features: 'Características',
  images: 'Imágenes',
  internal_notes: 'Notas internas',
  sold_price: 'Precio de venta',
  sold_to_contact_id: 'Comprador',
  owner_contact_id: 'Propietario',
  purchase_cost: 'Costo de compra',
  has_lien: 'Tiene prenda',
  on_display: 'En vitrina física',
  accepts_trade_in: 'Recibe permuta',
} as const

/** Error de un campo concreto, con el rótulo que el usuario tiene enfrente. */
function fieldError(key: keyof typeof LABELS, problem: string): PayloadError {
  return { error: `Revisa «${LABELS[key]}»: ${problem}`, field: key }
}

/**
 * Valida y normaliza el cuerpo de escritura de un vehículo.
 *
 * @param body Cuerpo JSON recibido, sin confiar (unknown).
 * @param opts `partial: false` (crear) exige brand/model/year; `partial:
 *   true` (editar) solo valida y devuelve los campos presentes en el body.
 * @returns `{ value }` con el patch ya normalizado y tipado, o `{ error }`
 *   con un mensaje listo para responder con HTTP 400.
 */
export function buildVehiclePayload(
  body: unknown,
  opts: { partial: boolean },
): Result {
  if (!body || typeof body !== 'object') return { error: 'Cuerpo inválido' }
  const b = body as Record<string, unknown>
  const out: VehiclePayload = {}

  // brand
  if (b.brand !== undefined) {
    const s = str(b.brand)
    if (!s) return fieldError('brand', 'es obligatoria')
    out.brand = s
  } else if (!opts.partial) {
    return fieldError('brand', 'es obligatoria')
  }

  // model
  if (b.model !== undefined) {
    const s = str(b.model)
    if (!s) return fieldError('model', 'es obligatoria')
    out.model = s
  } else if (!opts.partial) {
    return fieldError('model', 'es obligatoria')
  }

  // year
  if (b.year !== undefined) {
    const n = Number(b.year)
    if (!Number.isInteger(n) || n < 1900 || n > 2100) {
      return fieldError('year', 'debe ser un número entero entre 1900 y 2100')
    }
    out.year = n
  } else if (!opts.partial) {
    return fieldError('year', 'es obligatorio')
  }

  // license_plate / vin — strings anulables
  if (b.license_plate !== undefined) out.license_plate = str(b.license_plate) || null
  if (b.vin !== undefined) out.vin = str(b.vin) || null

  // price
  if (b.price !== undefined) {
    const n = Number(b.price)
    if (!Number.isFinite(n) || n < 0) {
      return fieldError('price', 'debe ser un número de 0 en adelante')
    }
    out.price = n
  }

  // mileage — entero anulable
  if (b.mileage === null || b.mileage === '') {
    out.mileage = null
  } else if (b.mileage !== undefined) {
    const n = Number(b.mileage)
    if (!Number.isInteger(n) || n < 0) {
      return fieldError('mileage', 'debe ser un número entero de 0 en adelante')
    }
    out.mileage = n
  }

  // Enums estructurados (anulables): valor válido o null.
  // El rótulo del mensaje ya no se repite acá: sale de LABELS por la
  // misma clave, así que la columna y el nombre en pantalla no pueden
  // quedar desalineados.
  const enumFields: [keyof typeof LABELS, unknown, readonly string[]][] = [
    ['transmission', b.transmission, TRANSMISSION_VALUES],
    ['fuel_type', b.fuel_type, FUEL_TYPE_VALUES],
    ['body_type', b.body_type, BODY_TYPE_VALUES],
  ]
  for (const [key, raw, values] of enumFields) {
    if (raw === undefined) continue
    if (raw === null || raw === '') {
      ;(out as Record<string, unknown>)[key] = null
    } else if (typeof raw === 'string' && values.includes(raw)) {
      ;(out as Record<string, unknown>)[key] = raw
    } else {
      return fieldError(key, 'el valor elegido no es válido')
    }
  }

  // condition — no anulable (default 'used' en DB)
  if (b.condition !== undefined) {
    if (typeof b.condition !== 'string' || !CONDITION_VALUES.includes(b.condition)) {
      return fieldError('condition', 'el valor elegido no es válido')
    }
    out.condition = b.condition
  }

  // color — texto anulable
  if (b.color !== undefined) out.color = str(b.color) || null

  // doors — entero anulable
  if (b.doors === null || b.doors === '') {
    out.doors = null
  } else if (b.doors !== undefined) {
    const n = Number(b.doors)
    if (!Number.isInteger(n) || n < 0) {
      return fieldError('doors', 'debe ser un número entero de 0 en adelante')
    }
    out.doors = n
  }

  // status
  if (b.status !== undefined) {
    if (!VEHICLE_STATUSES.includes(b.status as VehicleStatusValue)) {
      return fieldError('status', 'el valor elegido no es válido')
    }
    out.status = b.status as VehicleStatusValue
  }

  // --- Lista de precios del cliente (510) --------------------

  // Cilindraje y sede: texto libre anulable.
  if (b.engine_displacement !== undefined) {
    out.engine_displacement = str(b.engine_displacement) || null
  }
  if (b.plate_city !== undefined) {
    out.plate_city = str(b.plate_city) || null
  }

  // Precio con garantía. Anulable: no todas las unidades la ofrecen.
  if (b.warranty_price === null || b.warranty_price === '') {
    out.warranty_price = null
  } else if (b.warranty_price !== undefined) {
    const n = Number(b.warranty_price)
    if (!Number.isFinite(n) || n < 0) {
      return fieldError('warranty_price', 'debe ser un número de 0 en adelante')
    }
    out.warranty_price = n
  }

  // Vencimientos de SOAT y tecnomecánica. Se guardan como DATE, así que
  // se recorta a YYYY-MM-DD: conservar la hora haría que un vencimiento
  // se corriera un día según la zona horaria de quien lo consulte.
  const dateFields: [
    'soat_expires_at' | 'tecnomecanica_expires_at',
    unknown,
    string,
  ][] = [
    ['soat_expires_at', b.soat_expires_at, 'vencimiento del SOAT'],
    [
      'tecnomecanica_expires_at',
      b.tecnomecanica_expires_at,
      'vencimiento de la tecnomecánica',
    ],
  ]
  for (const [key, raw, label] of dateFields) {
    if (raw === null || raw === '') {
      out[key] = null
    } else if (raw !== undefined) {
      const v = normalizeDate(raw, true)
      if (!v) return dateError(key, label)
      out[key] = v
    }
  }

  // Banderas. NOT NULL en la base, así que un valor ausente se deja
  // fuera del patch y conserva lo que ya hubiera.
  const boolFields: ['has_lien' | 'on_display' | 'accepts_trade_in', unknown][] = [
    ['has_lien', b.has_lien],
    ['on_display', b.on_display],
    ['accepts_trade_in', b.accepts_trade_in],
  ]
  for (const [key, raw] of boolFields) {
    if (raw === undefined || raw === null) continue
    if (typeof raw !== 'boolean') return fieldError(key, 'sólo admite sí o no')
    out[key] = raw
  }

  // features — objeto o arreglo JSON
  if (b.features !== undefined) {
    if (b.features === null) out.features = {}
    else if (typeof b.features === 'object') {
      out.features = b.features as Record<string, unknown> | unknown[]
    } else {
      return fieldError('features', 'tienen un formato que el sistema no entiende')
    }
  }

  // images — arreglo de URLs
  if (b.images !== undefined) {
    if (!Array.isArray(b.images) || b.images.some((x) => typeof x !== 'string')) {
      return fieldError('images', 'tienen un formato que el sistema no entiende')
    }
    out.images = (b.images as string[]).map((s) => s.trim()).filter(Boolean)
  }

  // internal_notes
  if (b.internal_notes !== undefined) {
    out.internal_notes = str(b.internal_notes) || null
  }

  // --- Cierre de venta (508) ---------------------------------
  if (b.sold_price === null || b.sold_price === '') {
    out.sold_price = null
  } else if (b.sold_price !== undefined) {
    const n = Number(b.sold_price)
    if (!Number.isFinite(n) || n < 0) {
      return fieldError('sold_price', 'debe ser un número de 0 en adelante')
    }
    out.sold_price = n
  }

  if (b.sold_at === null || b.sold_at === '') {
    out.sold_at = null
  } else if (b.sold_at !== undefined) {
    const v = normalizeDate(b.sold_at, false)
    if (!v) return dateError('sold_at', 'venta')
    out.sold_at = v
  }

  if (b.sold_to_contact_id === null || b.sold_to_contact_id === '') {
    out.sold_to_contact_id = null
  } else if (b.sold_to_contact_id !== undefined) {
    const s = str(b.sold_to_contact_id)
    if (!s) return fieldError('sold_to_contact_id', 'el contacto elegido no es válido')
    out.sold_to_contact_id = s
  }

  // --- Propietario (525) -------------------------------------
  // Independiente del estado: a diferencia del comprador, el propietario
  // no se limpia al cambiar de estado — sigue siendo el dueño.
  if (b.owner_contact_id === null || b.owner_contact_id === '') {
    out.owner_contact_id = null
  } else if (b.owner_contact_id !== undefined) {
    const s = str(b.owner_contact_id)
    if (!s) return fieldError('owner_contact_id', 'el contacto elegido no es válido')
    out.owner_contact_id = s
  }

  const coherence = applySoldCoherence(out)
  if (coherence) return coherence

  return { value: out }
}

/**
 * Hace cumplir, del lado de la aplicación, el mismo invariante que el
 * CHECK `inventory_vehicles_sold_coherence` de la migración 508: sólo un
 * vehículo en estado `sold` puede llevar datos de cierre.
 *
 * Actúa únicamente cuando el body trae `status`, para no pisar los datos
 * de venta de un vehículo ya vendido al que sólo se le edita, digamos,
 * el kilometraje.
 *
 * @returns un mensaje de error, o `null` si el payload quedó coherente.
 */
function applySoldCoherence(out: VehiclePayload): PayloadError | null {
  if (out.status === undefined) return null

  if (out.status === 'sold') {
    // Pasar a vendido exige el precio de cierre: es el dato del que
    // dependen margen, ingresos y ticket promedio. Sin él la venta
    // entraría al tablero como un hueco silencioso.
    if (out.sold_price === undefined || out.sold_price === null) {
      return {
        error: 'Al marcar como vendido hay que indicar el precio de venta',
        field: 'sold_price',
      }
    }
    // La fecha sí tiene default razonable: hoy.
    if (out.sold_at === undefined || out.sold_at === null) {
      out.sold_at = new Date().toISOString()
    }
    if (out.sold_to_contact_id === undefined) out.sold_to_contact_id = null
    return null
  }

  // Reversión: salir de 'sold' limpia el cierre, aunque el cliente no
  // haya mandado los campos. Así un vehículo que vuelve a estar
  // disponible nunca arrastra un precio de venta viejo.
  out.sold_price = null
  out.sold_at = null
  out.sold_to_contact_id = null
  return null
}

/**
 * Valida los datos de compra. Devuelve `null` cuando el body no trae
 * ninguno (el vehículo simplemente no tiene adquisición registrada) y
 * `{ clear: true }` cuando pide borrar el registro existente.
 *
 * Un costo ausente NO es un costo de 0: el tablero excluye del margen a
 * los vehículos sin adquisición en vez de reportar 100% de utilidad.
 */
export function buildAcquisitionPayload(
  body: unknown,
): { value: AcquisitionPayload | null; clear: boolean } | PayloadError {
  if (!body || typeof body !== 'object') return { value: null, clear: false }
  const b = body as Record<string, unknown>

  if (b.purchase_cost === undefined && b.purchase_date === undefined) {
    return { value: null, clear: false }
  }

  // Vaciar el costo borra el registro entero: no tiene sentido guardar
  // una fecha de compra sin saber cuánto se pagó.
  if (b.purchase_cost === null || b.purchase_cost === '') {
    return { value: null, clear: true }
  }

  const cost = Number(b.purchase_cost)
  if (!Number.isFinite(cost) || cost < 0) {
    return fieldError('purchase_cost', 'debe ser un número de 0 en adelante')
  }

  let date: string | null = null
  if (b.purchase_date !== null && b.purchase_date !== undefined && b.purchase_date !== '') {
    // DATE en la base: sólo la parte de fecha, sin hora ni zona.
    date = normalizeDate(b.purchase_date, true)
    if (!date) return dateError('purchase_date', 'compra')
  }

  return { value: { purchase_cost: cost, purchase_date: date }, clear: false }
}
