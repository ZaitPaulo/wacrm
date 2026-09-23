import { describe, expect, it } from 'vitest'

import { CRM_MANIFEST_PATH, buildCrmManifest, crmPwaMetadata } from './manifest'

describe('buildCrmManifest', () => {
  const m = buildCrmManifest({ appName: 'LoraMotors', description: 'CRM de ventas' })

  it('abre en la bandeja y se instala como app', () => {
    expect(m.start_url).toBe('/inbox')
    expect(m.scope).toBe('/')
    expect(m.display).toBe('standalone')
    expect(m.id).toBe('/inbox')
    expect(m.name).toBe('LoraMotors CRM')
    expect(m.short_name).toBe('LoraMotors')
    expect(m.description).toBe('CRM de ventas')
  })

  it('trae iconos de 192 y 512, y uno maskable', () => {
    const icons = m.icons ?? []
    expect(icons.some((i) => i.sizes === '192x192' && i.purpose === 'any')).toBe(true)
    expect(icons.some((i) => i.sizes === '512x512' && i.purpose === 'any')).toBe(true)
    expect(icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable')).toBe(true)
    for (const i of icons) expect(i.src.startsWith('/icons/')).toBe(true)
  })
})

describe('crmPwaMetadata', () => {
  it('enlaza el manifest del CRM y se declara app web de Apple', () => {
    const md = crmPwaMetadata('LoraMotors')
    expect(md.manifest).toBe(CRM_MANIFEST_PATH)
    expect(md.appleWebApp).toMatchObject({ capable: true, title: 'LoraMotors' })
  })
})
