import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('Storefront translations consistency', () => {
  const readMessages = (locale: string) => {
    const filePath = path.resolve(process.cwd(), 'messages', `${locale}.json`)
    const raw = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(raw).Storefront
  }

  const es = readMessages('es')
  const en = readMessages('en')
  const ko = readMessages('ko')

  it('contains the same set of keys in es, en, and ko', () => {
    const esKeys = Object.keys(es).sort()
    const enKeys = Object.keys(en).sort()
    const koKeys = Object.keys(ko).sort()

    expect(enKeys).toEqual(esKeys)
    expect(koKeys).toEqual(esKeys)
  })

  it('includes all required redesign keys', () => {
    const requiredKeys = [
      'searchPlaceholder',
      'sort',
      'sortLowestPrice',
      'sortHighestPrice',
      'sortLowestMileage',
      'sortNewestYear',
      'resultsCount',
      'totalCount',
      'clear',
      'clearFilters',
      'applyFilters',
      'emptyTitle',
      'emptySubtitle',
      'contactDealership',
      'noPhotosYet',
      'noPhotosYetDescription',
      'requestPhotos',
      'galleryCount',
      'similarVehicles',
      'backToInventory',
      'refCodeLabel',
      'refCodeExplanation',
      'inventory',
      'zoomImage',
      'close',
      'nextPhoto',
      'previousPhoto',
      'zoomIn',
      'zoomOut',
    ]

    for (const key of requiredKeys) {
      expect(es, `Missing key in es: ${key}`).toHaveProperty(key)
      expect(en, `Missing key in en: ${key}`).toHaveProperty(key)
      expect(ko, `Missing key in ko: ${key}`).toHaveProperty(key)
    }
  })
})
