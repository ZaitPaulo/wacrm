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
  body: string
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
  body: '',
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
  if (state.body) result.body = state.body
  return result
}

/** Indica si hay algún criterio de búsqueda o filtro activo. */
export function hasActiveFilters(state: StorefrontFilterState): boolean {
  return countActiveFilters(state) > 0
}

/** Cuenta cuántos criterios de búsqueda y filtros están activos. */
export function countActiveFilters(state: StorefrontFilterState): number {
  let count = 0
  if (state.q.trim()) count++
  if (state.brand) count++
  if (state.year) count++
  if (state.budget) count++
  if (state.mileage) count++
  if (state.transmission) count++
  if (state.fuel) count++
  if (state.body) count++
  return count
}

/** Aplica la búsqueda por texto y los siete filtros sobre la lista. */
export function filterVehicles(
  vehicles: ShowcaseVehicle[],
  state: StorefrontFilterState,
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
    if (state.body && v.body_type !== state.body) {
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
