// ============================================================
// Catálogos de especificaciones de vehículos (valor DB -> etiqueta ES),
// compartidos por el formulario de /inventory, la validación de la API
// y la vitrina pública. Una sola fuente de verdad para las opciones.
// ============================================================

export interface SpecOption {
  value: string
  label: string
}

export const TRANSMISSIONS: SpecOption[] = [
  { value: 'manual', label: 'Mecánica' },
  { value: 'automatic', label: 'Automática' },
  { value: 'cvt', label: 'CVT' },
  { value: 'other', label: 'Otra' },
]

export const FUEL_TYPES: SpecOption[] = [
  { value: 'gasoline', label: 'Gasolina' },
  { value: 'diesel', label: 'Diésel' },
  { value: 'hybrid', label: 'Híbrido' },
  { value: 'electric', label: 'Eléctrico' },
  { value: 'lpg', label: 'GLP' },
  { value: 'other', label: 'Otro' },
]

export const BODY_TYPES: SpecOption[] = [
  { value: 'sedan', label: 'Sedán' },
  { value: 'suv', label: 'SUV' },
  { value: 'hatchback', label: 'Hatchback' },
  { value: 'pickup', label: 'Pickup' },
  { value: 'coupe', label: 'Coupé' },
  { value: 'van', label: 'Van' },
  { value: 'wagon', label: 'Familiar' },
  { value: 'convertible', label: 'Convertible' },
  { value: 'other', label: 'Otro' },
]

export const CONDITIONS: SpecOption[] = [
  { value: 'new', label: 'Nuevo' },
  { value: 'used', label: 'Usado' },
]

/** Etiqueta ES de un valor; '—' si es nulo, el propio valor si no está mapeado. */
export function labelOf(
  options: SpecOption[],
  value: string | null | undefined,
): string {
  if (!value) return '—'
  return options.find((o) => o.value === value)?.label ?? value
}

export const TRANSMISSION_VALUES = TRANSMISSIONS.map((o) => o.value)
export const FUEL_TYPE_VALUES = FUEL_TYPES.map((o) => o.value)
export const BODY_TYPE_VALUES = BODY_TYPES.map((o) => o.value)
export const CONDITION_VALUES = CONDITIONS.map((o) => o.value)
