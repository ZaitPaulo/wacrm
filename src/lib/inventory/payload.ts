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
  features?: Record<string, unknown> | unknown[]
  images?: string[]
  internal_notes?: string | null
}

type Result = { value: VehiclePayload } | { error: string }

/** Devuelve el string recortado, o undefined si no es un string. */
function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v.trim() : undefined
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
    if (!s) return { error: 'brand es obligatorio' }
    out.brand = s
  } else if (!opts.partial) {
    return { error: 'brand es obligatorio' }
  }

  // model
  if (b.model !== undefined) {
    const s = str(b.model)
    if (!s) return { error: 'model es obligatorio' }
    out.model = s
  } else if (!opts.partial) {
    return { error: 'model es obligatorio' }
  }

  // year
  if (b.year !== undefined) {
    const n = Number(b.year)
    if (!Number.isInteger(n) || n < 1900 || n > 2100) {
      return { error: 'year debe ser un entero entre 1900 y 2100' }
    }
    out.year = n
  } else if (!opts.partial) {
    return { error: 'year es obligatorio' }
  }

  // license_plate / vin — strings anulables
  if (b.license_plate !== undefined) out.license_plate = str(b.license_plate) || null
  if (b.vin !== undefined) out.vin = str(b.vin) || null

  // price
  if (b.price !== undefined) {
    const n = Number(b.price)
    if (!Number.isFinite(n) || n < 0) {
      return { error: 'price debe ser un número >= 0' }
    }
    out.price = n
  }

  // mileage — entero anulable
  if (b.mileage === null || b.mileage === '') {
    out.mileage = null
  } else if (b.mileage !== undefined) {
    const n = Number(b.mileage)
    if (!Number.isInteger(n) || n < 0) {
      return { error: 'mileage debe ser un entero >= 0' }
    }
    out.mileage = n
  }

  // Enums estructurados (anulables): valor válido o null.
  const enumFields: [keyof VehiclePayload, unknown, readonly string[], string][] = [
    ['transmission', b.transmission, TRANSMISSION_VALUES, 'transmission'],
    ['fuel_type', b.fuel_type, FUEL_TYPE_VALUES, 'fuel_type'],
    ['body_type', b.body_type, BODY_TYPE_VALUES, 'body_type'],
  ]
  for (const [key, raw, values, name] of enumFields) {
    if (raw === undefined) continue
    if (raw === null || raw === '') {
      ;(out as Record<string, unknown>)[key] = null
    } else if (typeof raw === 'string' && values.includes(raw)) {
      ;(out as Record<string, unknown>)[key] = raw
    } else {
      return { error: `${name} inválido` }
    }
  }

  // condition — no anulable (default 'used' en DB)
  if (b.condition !== undefined) {
    if (typeof b.condition !== 'string' || !CONDITION_VALUES.includes(b.condition)) {
      return { error: 'condition inválido' }
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
      return { error: 'doors debe ser un entero >= 0' }
    }
    out.doors = n
  }

  // status
  if (b.status !== undefined) {
    if (!VEHICLE_STATUSES.includes(b.status as VehicleStatusValue)) {
      return { error: 'status inválido' }
    }
    out.status = b.status as VehicleStatusValue
  }

  // features — objeto o arreglo JSON
  if (b.features !== undefined) {
    if (b.features === null) out.features = {}
    else if (typeof b.features === 'object') {
      out.features = b.features as Record<string, unknown> | unknown[]
    } else {
      return { error: 'features debe ser un objeto o arreglo JSON' }
    }
  }

  // images — arreglo de URLs
  if (b.images !== undefined) {
    if (!Array.isArray(b.images) || b.images.some((x) => typeof x !== 'string')) {
      return { error: 'images debe ser un arreglo de URLs' }
    }
    out.images = (b.images as string[]).map((s) => s.trim()).filter(Boolean)
  }

  // internal_notes
  if (b.internal_notes !== undefined) {
    out.internal_notes = str(b.internal_notes) || null
  }

  return { value: out }
}
