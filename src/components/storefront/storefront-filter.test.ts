import { describe, it, expect } from 'vitest'
import {
  INITIAL_FILTER_STATE,
  serializeFilterState,
  hasActiveFilters,
  countActiveFilters,
  filterVehicles,
  sortVehicles,
  type StorefrontFilterState,
} from './storefront-filter'
import type { ShowcaseVehicle } from '@/lib/showcase/format'

const mockVehicles: ShowcaseVehicle[] = [
  {
    id: 'v1',
    brand: 'Renault',
    model: 'Duster',
    year: 2021,
    price: 65000000,
    mileage: 45000,
    transmission: 'manual',
    fuel_type: 'gasoline',
    body_type: 'suv',
    condition: 'used',
    features: null,
    images: ['https://example.com/duster.jpg'],
    public_ref: 'REF-001',
  },
  {
    id: 'v2',
    brand: 'Toyota',
    model: 'Corolla Cross',
    year: 2023,
    price: 110000000,
    mileage: 15000,
    transmission: 'automatic',
    fuel_type: 'hybrid',
    body_type: 'suv',
    condition: 'used',
    features: null,
    images: ['https://example.com/corolla.jpg'],
    public_ref: 'REF-002',
  },
  {
    id: 'v3',
    brand: 'Chevrolet',
    model: 'Onix',
    year: 2020,
    price: 45000000,
    mileage: null, // No mileage recorded
    transmission: 'automatic',
    fuel_type: 'gasoline',
    body_type: 'hatchback',
    condition: 'used',
    features: null,
    images: [], // No photos
    public_ref: 'REF-003',
  },
  {
    id: 'v4',
    brand: 'Toyota',
    model: 'Yaris',
    year: 2024,
    price: 85000000,
    mileage: 5000,
    transmission: 'automatic',
    fuel_type: 'gasoline',
    body_type: 'sedan',
    condition: 'new',
    features: null,
    images: null, // null photos
    public_ref: null,
  },
]

describe('Storefront filter & sort logic', () => {
  describe('serializeFilterState', () => {
    it('serializes empty initial state to empty object', () => {
      const serialized = serializeFilterState(INITIAL_FILTER_STATE)
      expect(serialized).toEqual({})
    })

    it('serializes active state attributes to string records', () => {
      const state: StorefrontFilterState = {
        q: 'toyota',
        sort: 'price_asc',
        brand: 'Toyota',
        year: '2023',
        budget: '100000000',
        mileage: '50000',
        transmission: 'automatic',
        fuel: 'hybrid',
        body: 'suv',
      }
      const serialized = serializeFilterState(state)
      expect(serialized).toEqual({
        q: 'toyota',
        sort: 'price_asc',
        brand: 'Toyota',
        year: '2023',
        budget: '100000000',
        mileage: '50000',
        transmission: 'automatic',
        fuel: 'hybrid',
        body: 'suv',
      })
    })
  })

  describe('hasActiveFilters', () => {
    it('returns false for initial state', () => {
      expect(hasActiveFilters(INITIAL_FILTER_STATE)).toBe(false)
    })

    it('returns true when text query q is active', () => {
      expect(hasActiveFilters({ ...INITIAL_FILTER_STATE, q: 'duster' })).toBe(true)
    })

    it('returns true when a filter is active', () => {
      expect(hasActiveFilters({ ...INITIAL_FILTER_STATE, brand: 'Toyota' })).toBe(true)
      expect(hasActiveFilters({ ...INITIAL_FILTER_STATE, year: '2023' })).toBe(true)
      expect(hasActiveFilters({ ...INITIAL_FILTER_STATE, budget: '50000' })).toBe(true)
      expect(hasActiveFilters({ ...INITIAL_FILTER_STATE, mileage: '20000' })).toBe(true)
      expect(hasActiveFilters({ ...INITIAL_FILTER_STATE, transmission: 'automatic' })).toBe(true)
      expect(hasActiveFilters({ ...INITIAL_FILTER_STATE, fuel: 'gasoline' })).toBe(true)
    })

    it('returns true when the body type filter is active', () => {
      expect(hasActiveFilters({ ...INITIAL_FILTER_STATE, body: 'suv' })).toBe(true)
    })
  })

  describe('countActiveFilters', () => {
    it('returns 0 for initial state', () => {
      expect(countActiveFilters(INITIAL_FILTER_STATE)).toBe(0)
    })

    it('correctly counts active filters and query', () => {
      expect(countActiveFilters({ ...INITIAL_FILTER_STATE, q: 'duster' })).toBe(1)
      expect(
        countActiveFilters({
          ...INITIAL_FILTER_STATE,
          q: 'duster',
          brand: 'Renault',
          body: 'suv',
          transmission: 'automatic',
        }),
      ).toBe(4)
    })

    it('counts the body type filter', () => {
      expect(countActiveFilters({ ...INITIAL_FILTER_STATE, body: 'suv' })).toBe(1)
      expect(hasActiveFilters({ ...INITIAL_FILTER_STATE, body: 'suv' })).toBe(true)
    })
  })

  describe('filterVehicles', () => {
    it('filters by free text q matching brand, model, or year (case insensitive partial match)', () => {
      expect(filterVehicles(mockVehicles, { ...INITIAL_FILTER_STATE, q: 'dust' }).map((v) => v.id)).toEqual(['v1'])
      expect(filterVehicles(mockVehicles, { ...INITIAL_FILTER_STATE, q: 'TOYOTA' }).map((v) => v.id)).toEqual(['v2', 'v4'])
      expect(filterVehicles(mockVehicles, { ...INITIAL_FILTER_STATE, q: '2020' }).map((v) => v.id)).toEqual(['v3'])
      expect(filterVehicles(mockVehicles, { ...INITIAL_FILTER_STATE, q: 'cross 2023' }).map((v) => v.id)).toEqual(['v2'])
    })

    it('filters by body type (carrocería)', () => {
      expect(
        filterVehicles(mockVehicles, { ...INITIAL_FILTER_STATE, body: 'suv' }).map(
          (v) => v.id,
        ),
      ).toEqual(['v1', 'v2'])
      expect(
        filterVehicles(mockVehicles, { ...INITIAL_FILTER_STATE, body: 'sedan' }).map(
          (v) => v.id,
        ),
      ).toEqual(['v4'])
      // Una carrocería sin vehículos no devuelve nada, y no rompe.
      expect(
        filterVehicles(mockVehicles, { ...INITIAL_FILTER_STATE, body: 'convertible' }),
      ).toEqual([])
    })

    it('combines body type with another filter', () => {
      const res = filterVehicles(
        mockVehicles,
        { ...INITIAL_FILTER_STATE, body: 'suv', fuel: 'hybrid' },
      )
      expect(res.map((v) => v.id)).toEqual(['v2'])
    })

    it('filters by brand, year, budget, mileage, transmission, fuel', () => {
      expect(filterVehicles(mockVehicles, { ...INITIAL_FILTER_STATE, brand: 'Toyota' }).map((v) => v.id)).toEqual(['v2', 'v4'])
      expect(filterVehicles(mockVehicles, { ...INITIAL_FILTER_STATE, year: '2021' }).map((v) => v.id)).toEqual(['v1'])
      expect(filterVehicles(mockVehicles, { ...INITIAL_FILTER_STATE, budget: '70000000' }).map((v) => v.id)).toEqual(['v1', 'v3'])
      expect(filterVehicles(mockVehicles, { ...INITIAL_FILTER_STATE, mileage: '20000' }).map((v) => v.id)).toEqual(['v2', 'v4'])
      expect(filterVehicles(mockVehicles, { ...INITIAL_FILTER_STATE, transmission: 'manual' }).map((v) => v.id)).toEqual(['v1'])
      expect(filterVehicles(mockVehicles, { ...INITIAL_FILTER_STATE, fuel: 'hybrid' }).map((v) => v.id)).toEqual(['v2'])
    })

    it('combines text query with several filters', () => {
      const res = filterVehicles(mockVehicles, {
        ...INITIAL_FILTER_STATE,
        q: 'toyota',
        transmission: 'automatic',
        body: 'suv',
      })
      expect(res.map((v) => v.id)).toEqual(['v2'])
    })
  })

  describe('sortVehicles', () => {
    it('sorts by price_asc: lowest price first', () => {
      const res = sortVehicles(mockVehicles, 'price_asc')
      expect(res.map((v) => v.price)).toEqual([45000000, 65000000, 85000000, 110000000])
    })

    it('sorts by price_desc: highest price first', () => {
      const res = sortVehicles(mockVehicles, 'price_desc')
      expect(res.map((v) => v.price)).toEqual([110000000, 85000000, 65000000, 45000000])
    })

    it('sorts by mileage_asc: lowest mileage first, null mileage placed at the end', () => {
      const res = sortVehicles(mockVehicles, 'mileage_asc')
      expect(res.map((v) => v.id)).toEqual(['v4', 'v2', 'v1', 'v3'])
      expect(res[res.length - 1].mileage).toBeNull()
    })

    it('sorts by year_desc: newest year first', () => {
      const res = sortVehicles(mockVehicles, 'year_desc')
      expect(res.map((v) => v.year)).toEqual([2024, 2023, 2021, 2020])
    })

    it('preserves default order when sort is empty', () => {
      const res = sortVehicles(mockVehicles, '')
      expect(res.map((v) => v.id)).toEqual(['v1', 'v2', 'v3', 'v4'])
    })
  })
})
