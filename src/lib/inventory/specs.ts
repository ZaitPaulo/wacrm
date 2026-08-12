// ============================================================
// Catálogos de especificaciones de vehículos, compartidos por el
// formulario de /inventory, la validación de la API y la vitrina
// pública. Una sola fuente de verdad para las opciones.
//
// `value` es lo que se persiste en `inventory_vehicles` y lo que usan
// los filtros de la vitrina: NO se traduce ni se renombra. Lo traducible
// es `labelKey`, que apunta al catálogo dentro del namespace `Inventory`.
// ============================================================

export interface SpecOption {
  /** Valor almacenado en base de datos. Estable, nunca traducido. */
  value: string
  /** Clave del catálogo, relativa al namespace `Inventory`. */
  labelKey: string
}

export const TRANSMISSIONS: SpecOption[] = [
  { value: 'manual', labelKey: 'specs.transmission.manual' },
  { value: 'automatic', labelKey: 'specs.transmission.automatic' },
  { value: 'cvt', labelKey: 'specs.transmission.cvt' },
  { value: 'other', labelKey: 'specs.transmission.other' },
]

export const FUEL_TYPES: SpecOption[] = [
  { value: 'gasoline', labelKey: 'specs.fuelType.gasoline' },
  { value: 'diesel', labelKey: 'specs.fuelType.diesel' },
  { value: 'hybrid', labelKey: 'specs.fuelType.hybrid' },
  { value: 'electric', labelKey: 'specs.fuelType.electric' },
  { value: 'lpg', labelKey: 'specs.fuelType.lpg' },
  { value: 'other', labelKey: 'specs.fuelType.other' },
]

export const BODY_TYPES: SpecOption[] = [
  { value: 'sedan', labelKey: 'specs.bodyType.sedan' },
  { value: 'suv', labelKey: 'specs.bodyType.suv' },
  { value: 'hatchback', labelKey: 'specs.bodyType.hatchback' },
  { value: 'pickup', labelKey: 'specs.bodyType.pickup' },
  { value: 'coupe', labelKey: 'specs.bodyType.coupe' },
  { value: 'van', labelKey: 'specs.bodyType.van' },
  { value: 'wagon', labelKey: 'specs.bodyType.wagon' },
  { value: 'convertible', labelKey: 'specs.bodyType.convertible' },
  { value: 'other', labelKey: 'specs.bodyType.other' },
]

export const CONDITIONS: SpecOption[] = [
  { value: 'new', labelKey: 'specs.condition.new' },
  { value: 'used', labelKey: 'specs.condition.used' },
]

/** Traductor del namespace `Inventory`, en la forma que devuelven tanto
 *  `useTranslations` como `getTranslations`. */
type SpecTranslator = (key: string) => string

/**
 * Etiqueta traducida de un valor. Devuelve el guion largo si el valor es
 * nulo, y el propio valor si no está en el catálogo — una fila vieja con
 * un valor que ya no ofrecemos se muestra tal cual en vez de romper.
 */
export function labelOf(
  t: SpecTranslator,
  options: SpecOption[],
  value: string | null | undefined,
): string {
  if (!value) return t('specs.empty')
  const option = options.find((o) => o.value === value)
  return option ? t(option.labelKey) : value
}

export const TRANSMISSION_VALUES = TRANSMISSIONS.map((o) => o.value)
export const FUEL_TYPE_VALUES = FUEL_TYPES.map((o) => o.value)
export const BODY_TYPE_VALUES = BODY_TYPES.map((o) => o.value)
export const CONDITION_VALUES = CONDITIONS.map((o) => o.value)

// ============================================================
// Precio con garantía
// ============================================================

/**
 * Carrocerías que el negocio cuenta como "camioneta".
 *
 * Importa porque el recargo de la garantía depende de esto. En Colombia
 * la palabra cubre SUV, pick-up y van; un sedán o un hatchback no.
 */
const CAMIONETA_BODY_TYPES = new Set(['suv', 'pickup', 'van'])

/** Recargo de la garantía, en pesos, según el tipo de carrocería. */
export const WARRANTY_MARKUP = {
  vehicle: 1_500_000,
  camioneta: 2_000_000,
} as const

/**
 * Precio con garantía sugerido: precio de venta más el recargo que
 * corresponda. La regla la dio el cliente — 1,5 M para vehículos, 2,0 M
 * para camionetas — y se cumple en toda su lista de precios.
 *
 * Es una SUGERENCIA, no una fórmula impuesta: el formulario la usa para
 * prellenar el campo y el operador puede sobrescribirla. Por eso el
 * valor se persiste en su propia columna en vez de calcularse al leer:
 * una excepción puntual no debe obligar a cambiar la regla.
 *
 * Devuelve null cuando no hay precio del que partir, para que el campo
 * quede vacío en vez de proponer el recargo suelto como si fuera precio.
 */
export function suggestedWarrantyPrice(
  price: number | null | undefined,
  bodyType: string | null | undefined,
): number | null {
  if (price == null || !Number.isFinite(price) || price <= 0) return null
  const markup = CAMIONETA_BODY_TYPES.has(bodyType ?? '')
    ? WARRANTY_MARKUP.camioneta
    : WARRANTY_MARKUP.vehicle
  return price + markup
}
