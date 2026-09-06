import type { ShowcaseVehicle } from '@/lib/showcase/format'

export type SortOption = 'price_asc' | 'price_desc' | 'mileage_asc' | 'year_desc' | ''

export interface StorefrontFilterState {
  q: string
  sort: SortOption
  brand: string
  year: string
  budget: string
  mileage: string
  transmission: string
  fuel: string
  withPhotos: boolean
  automatic: boolean
  recent: boolean
}

export const INITIAL_FILTER_STATE: StorefrontFilterState = {
  q: '',
  sort: '',
  brand: '',
  year: '',
  budget: '',
  mileage: '',
  transmission: '',
  fuel: '',
  withPhotos: false,
  automatic: false,
  recent: false,
}

/** Serializa el estado de búsqueda a un Record<string, string> plano. */
export function serializeFilterState(state: StorefrontFilterState): Record<string, string> {
  const result: Record<string, string> = {}
  if (state.q.trim()) result.q = state.q.trim()
  if (state.sort) result.sort = state.sort
  if (state.brand) result.brand = state.brand
  if (state.year) result.year = state.year
  if (state.budget) result.budget = state.budget
  if (state.mileage) result.mileage = state.mileage
  if (state.transmission) result.transmission = state.transmission
  if (state.fuel) result.fuel = state.fuel
  if (state.withPhotos) result.withPhotos = 'true'
  if (state.automatic) result.automatic = 'true'
  if (state.recent) result.recent = 'true'
  return result
}

/** Indica si hay algún criterio de búsqueda o filtro activo. */
export function hasActiveFilters(state: StorefrontFilterState): boolean {
  return (
    state.q.trim() !== '' ||
    state.brand !== '' ||
    state.year !== '' ||
    state.budget !== '' ||
    state.mileage !== '' ||
    state.transmission !== '' ||
    state.fuel !== '' ||
    state.withPhotos ||
    state.automatic ||
    state.recent
  )
}

/** Obtiene los IDs de los N vehículos más recientes según created_at. */
export function getRecentVehicleIds(vehicles: ShowcaseVehicle[], count = 12): Set<string> {
  const sorted = [...vehicles].sort((a, b) => {
    const timeA = a.created_at ? new Date(a.created_at).getTime() : 0
    const timeB = b.created_at ? new Date(b.created_at).getTime() : 0
    return timeB - timeA
  })
  return new Set(sorted.slice(0, count).map((v) => v.id))
}

/** Aplica búsqueda por texto, los 6 filtros y los 3 atajos sobre la lista de vehículos. */
export function filterVehicles(
  vehicles: ShowcaseVehicle[],
  state: StorefrontFilterState,
  recentIds: Set<string>,
): ShowcaseVehicle[] {
  const query = state.q.trim().toLowerCase()
  const queryTerms = query ? query.split(/\s+/) : []

  return vehicles.filter((v) => {
    if (queryTerms.length > 0) {
      const target = `${v.brand} ${v.model} ${v.year}`.toLowerCase()
      if (!queryTerms.every((term) => target.includes(term))) {
        return false
      }
    }
    if (state.brand && v.brand.toLowerCase() !== state.brand.toLowerCase()) {
      return false
    }
    if (state.year && String(v.year) !== state.year) {
      return false
    }
    if (state.budget && v.price > Number(state.budget)) {
      return false
    }
    if (state.mileage && (v.mileage == null || v.mileage > Number(state.mileage))) {
      return false
    }
    if (state.transmission && v.transmission !== state.transmission) {
      return false
    }
    if (state.fuel && v.fuel_type !== state.fuel) {
      return false
    }
    if (state.withPhotos && (!v.images || v.images.length === 0)) {
      return false
    }
    if (state.automatic && v.transmission !== 'automatic') {
      return false
    }
    if (state.recent && !recentIds.has(v.id)) {
      return false
    }
    return true
  })
}

/** Ordena los vehículos filtrados según la opción elegida. */
export function sortVehicles(
  vehicles: ShowcaseVehicle[],
  sort: SortOption,
): ShowcaseVehicle[] {
  if (!sort) return vehicles

  return [...vehicles].sort((a, b) => {
    switch (sort) {
      case 'price_asc':
        return a.price - b.price
      case 'price_desc':
        return b.price - a.price
      case 'mileage_asc': {
        if (a.mileage == null && b.mileage == null) return 0
        if (a.mileage == null) return 1
        if (b.mileage == null) return -1
        return a.mileage - b.mileage
      }
      case 'year_desc':
        return b.year - a.year
      default:
        return 0
    }
  })
}
