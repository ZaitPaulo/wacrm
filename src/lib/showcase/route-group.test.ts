import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Mock next/font/google before importing layout
vi.mock('next/font/google', () => ({
  Barlow: vi.fn().mockImplementation((config) => ({
    variable: config?.variable ?? '--font-barlow',
    className: 'mock-barlow',
  })),
  Barlow_Condensed: vi.fn().mockImplementation((config) => ({
    variable: config?.variable ?? '--font-barlow-condensed',
    className: 'mock-barlow-condensed',
  })),
}))

// Mock showcase data
vi.mock('@/lib/showcase/data', () => ({
  getShowcase: vi.fn(),
  getShowcaseAccount: vi.fn(),
}))

import { getShowcaseAccount } from '@/lib/showcase/data'
import { DEFAULT_BRAND_COLOR, type ShowcaseAccount } from '@/lib/showcase/format'
import StorefrontLayout from '@/app/(storefront)/layout'

const appDir = path.resolve(process.cwd(), 'src/app')
const storefrontDir = path.resolve(appDir, '(storefront)')

describe('Section 3: Storefront route group and visual system', () => {
  describe('3.1 File placement and route group isolation', () => {
    it('contains page.tsx, loading.tsx, opengraph-image.tsx in (storefront)/', () => {
      expect(fs.existsSync(path.join(storefrontDir, 'page.tsx'))).toBe(true)
      expect(fs.existsSync(path.join(storefrontDir, 'loading.tsx'))).toBe(true)
      expect(fs.existsSync(path.join(storefrontDir, 'opengraph-image.tsx'))).toBe(true)
    })

    it('contains vehiculo/[id]/ routes in (storefront)/', () => {
      const vehiculoDir = path.join(storefrontDir, 'vehiculo', '[id]')
      expect(fs.existsSync(path.join(vehiculoDir, 'page.tsx'))).toBe(true)
      expect(fs.existsSync(path.join(vehiculoDir, 'loading.tsx'))).toBe(true)
      expect(fs.existsSync(path.join(vehiculoDir, 'opengraph-image.tsx'))).toBe(true)
    })

    it('keeps robots.ts, sitemap.ts, and icon.png in root src/app/', () => {
      expect(fs.existsSync(path.join(appDir, 'robots.ts'))).toBe(true)
      expect(fs.existsSync(path.join(appDir, 'sitemap.ts'))).toBe(true)
      expect(fs.existsSync(path.join(appDir, 'icon.png'))).toBe(true)
    })

    it('removes old storefront files from root src/app/', () => {
      expect(fs.existsSync(path.join(appDir, 'page.tsx'))).toBe(false)
      expect(fs.existsSync(path.join(appDir, 'loading.tsx'))).toBe(false)
      expect(fs.existsSync(path.join(appDir, 'opengraph-image.tsx'))).toBe(false)
      expect(fs.existsSync(path.join(appDir, 'vehiculo'))).toBe(false)
    })

    // /privacidad usa StoreNav y StoreFooter, que dependen de --brand y de
    // las fuentes de marca. Fuera del grupo esas variables no existen: los
    // hover perdían el color y la cabecera caía a la tipografía del CRM.
    it('contains privacidad/ in (storefront)/, not in root src/app/', () => {
      expect(fs.existsSync(path.join(storefrontDir, 'privacidad', 'page.tsx'))).toBe(true)
      expect(fs.existsSync(path.join(appDir, 'privacidad'))).toBe(false)
    })
  })

  describe('3.2 Font configuration in layout.tsx', () => {
    const layoutContent = fs.readFileSync(path.join(storefrontDir, 'layout.tsx'), 'utf8')

    it('loads Barlow with weights 400, 500, 600, 700 and display swap', () => {
      expect(layoutContent).toContain("subsets: ['latin']")
      expect(layoutContent).toMatch(/weight:\s*\[['"]400['"],\s*['"]500['"],\s*['"]600['"],\s*['"]700['"]\]/)
      expect(layoutContent).toMatch(/display:\s*['"]swap['"]/)
    })

    it('loads Barlow Condensed with weights 600, 700, 800, italic and display swap', () => {
      expect(layoutContent).toContain('Barlow_Condensed')
      expect(layoutContent).toMatch(/weight:\s*\[['"]600['"],\s*['"]700['"],\s*['"]800['"]\]/)
      expect(layoutContent).toMatch(/style:\s*\[['"]normal['"],\s*['"]italic['"]\]/)
    })
  })

  describe('3.3 Vitrina CSS variables and theme isolation', () => {
    const layoutContent = fs.readFileSync(path.join(storefrontDir, 'layout.tsx'), 'utf8')

    it('does not use any CRM theme tokens from globals.css', () => {
      expect(layoutContent).not.toContain('bg-background')
      expect(layoutContent).not.toContain('text-foreground')
      expect(layoutContent).not.toContain('bg-card')
      expect(layoutContent).not.toContain('text-card-foreground')
      expect(layoutContent).not.toContain('border-border')
    })

    it('renders with brand color when account has public_brand_color', async () => {
      vi.mocked(getShowcaseAccount).mockResolvedValueOnce({
        id: 'acc_1',
        name: 'Lora Motors',
        default_currency: 'USD',
        public_whatsapp: '123456789',
        public_brand_color: '#123456',
      } as unknown as ShowcaseAccount)

      const res = await StorefrontLayout({ children: 'Test Child' })
      expect(res.props.style).toHaveProperty('--brand', '#123456')
    })

    it('safely handles null account data without throwing (safe navigation)', async () => {
      vi.mocked(getShowcaseAccount).mockResolvedValueOnce(null)

      const res = await StorefrontLayout({ children: 'Test Child' })
      expect(res.props.style).toHaveProperty('--brand')
    })

    it('falls back to the default brand color when the stored value is invalid', async () => {
      vi.mocked(getShowcaseAccount).mockResolvedValueOnce({
        id: 'acc_1',
        name: 'Lora Motors',
        default_currency: 'USD',
        public_brand_color: 'rojo',
      } as unknown as ShowcaseAccount)

      const res = await StorefrontLayout({ children: 'Test Child' })
      expect(res.props.style).toHaveProperty('--brand', DEFAULT_BRAND_COLOR)
    })

    // El layout envuelve TODA la vitrina, incluida cada ficha. Pedir el
    // inventario completo aquí para leer una columna de `accounts` añadía
    // una consulta de 128 filas por vista de ficha, que el `cache()` de
    // React no deduplica porque la ficha llama a otra función.
    it('does not pull the whole inventory just to read the brand color', () => {
      expect(layoutContent).toContain('getShowcaseAccount')
      expect(layoutContent).not.toMatch(/\bgetShowcase\b(?!Account)/)
    })
  })
})
