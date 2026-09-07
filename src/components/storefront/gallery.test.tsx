import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) =>
    React.createElement('img', { ...props, src: props.src as string }),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) => {
    if (key === 'galleryCount' && params) {
      return `${params.current} de ${params.total}`
    }
    return key
  },
}))

import { Gallery, galleryReducer } from './gallery'

describe('Gallery component (task 7.3)', () => {
  it('renders single photo without navigation controls or counter', () => {
    const html = renderToStaticMarkup(
      React.createElement(Gallery, {
        images: ['https://example.com/single.jpg'],
        alt: 'Toyota Corolla',
      }),
    )

    expect(html).toContain('single.jpg')
    // No thumbnail buttons
    expect(html).not.toContain('aria-current')
    // No counter
    expect(html).not.toContain('1 de 1')
  })

  it('renders multiple photos with counter and thumbnail buttons', () => {
    const html = renderToStaticMarkup(
      React.createElement(Gallery, {
        images: [
          'https://example.com/photo1.jpg',
          'https://example.com/photo2.jpg',
          'https://example.com/photo3.jpg',
        ],
        alt: 'Toyota Corolla',
      }),
    )

    expect(html).toContain('photo1.jpg')
    // Shows counter "1 de 3"
    expect(html).toContain('1 de 3')
    // Has thumbnail buttons for each photo
    expect(html).toContain('photo2.jpg')
    expect(html).toContain('photo3.jpg')
  })

  it('highlights selected thumbnail with active border', () => {
    const html = renderToStaticMarkup(
      React.createElement(Gallery, {
        images: ['https://example.com/1.jpg', 'https://example.com/2.jpg'],
        alt: 'Car',
      }),
    )

    // Active thumbnail has border-(--brand) or ring or active indicator
    expect(html).toMatch(/border-(--brand)|ring-2|border-black/)
  })
})

describe('Gallery lightbox and zoom (TDD)', () => {
  it('renders a zoom button on the main photo', () => {
    const html = renderToStaticMarkup(
      React.createElement(Gallery, {
        images: ['https://example.com/car.jpg'],
        alt: 'Car',
      }),
    )

    expect(html).toContain('aria-label="zoomImage"')
  })

  it('renders full-screen lightbox modal with controls when open', () => {
    const html = renderToStaticMarkup(
      React.createElement(Gallery, {
        images: ['https://example.com/1.jpg', 'https://example.com/2.jpg'],
        alt: 'Car',
        initialOpen: true,
      }),
    )

    expect(html).toContain('role="dialog"')
    expect(html).toContain('bg-black/95')
    expect(html).toContain('aria-label="close"')
    expect(html).toContain('aria-label="zoomIn"')
    expect(html).toContain('aria-label="previousPhoto"')
    expect(html).toContain('aria-label="nextPhoto"')
    expect(html).toContain('1 de 2')
  })

  it('renders zoom-out button and enlarged image state when zoomed', () => {
    const html = renderToStaticMarkup(
      React.createElement(Gallery, {
        images: ['https://example.com/1.jpg'],
        alt: 'Car',
        initialOpen: true,
        initialZoomed: true,
      }),
    )

    expect(html).toContain('aria-label="zoomOut"')
    expect(html).toMatch(/scale-150|scale-200/)
    expect(html).toContain('cursor-zoom-out')
  })

  it('hides previous and next buttons when there is only a single photo in lightbox', () => {
    const html = renderToStaticMarkup(
      React.createElement(Gallery, {
        images: ['https://example.com/single.jpg'],
        alt: 'Single Car',
        initialOpen: true,
      }),
    )

    expect(html).not.toContain('aria-label="previousPhoto"')
    expect(html).not.toContain('aria-label="nextPhoto"')
    expect(html).toContain('aria-label="close"')
    expect(html).toContain('aria-label="zoomIn"')
  })

  describe('galleryReducer state logic', () => {
    it('opens lightbox and resets zoom', () => {
      const initial = { isOpen: false, isZoomed: true, selected: 0 }
      const state = galleryReducer(initial, { type: 'OPEN' })
      expect(state).toEqual({ isOpen: true, isZoomed: false, selected: 0 })
    })

    it('closes lightbox and resets zoom', () => {
      const initial = { isOpen: true, isZoomed: true, selected: 2 }
      const state = galleryReducer(initial, { type: 'CLOSE' })
      expect(state).toEqual({ isOpen: false, isZoomed: false, selected: 2 })
    })

    it('toggles zoom state', () => {
      const state1 = galleryReducer(
        { isOpen: true, isZoomed: false, selected: 0 },
        { type: 'TOGGLE_ZOOM' },
      )
      expect(state1.isZoomed).toBe(true)

      const state2 = galleryReducer(state1, { type: 'TOGGLE_ZOOM' })
      expect(state2.isZoomed).toBe(false)
    })

    it('navigates to next photo and wraps around, resetting zoom', () => {
      const state1 = galleryReducer(
        { isOpen: true, isZoomed: true, selected: 0 },
        { type: 'NEXT', total: 3 },
      )
      expect(state1.selected).toBe(1)
      expect(state1.isZoomed).toBe(false)

      const state2 = galleryReducer(
        { isOpen: true, isZoomed: true, selected: 2 },
        { type: 'NEXT', total: 3 },
      )
      expect(state2.selected).toBe(0)
    })

    it('navigates to previous photo and wraps around, resetting zoom', () => {
      const state1 = galleryReducer(
        { isOpen: true, isZoomed: true, selected: 1 },
        { type: 'PREV', total: 3 },
      )
      expect(state1.selected).toBe(0)
      expect(state1.isZoomed).toBe(false)

      const state2 = galleryReducer(
        { isOpen: true, isZoomed: true, selected: 0 },
        { type: 'PREV', total: 3 },
      )
      expect(state2.selected).toBe(2)
    })

    it('selects a specific photo by index, resetting zoom', () => {
      const state = galleryReducer(
        { isOpen: true, isZoomed: true, selected: 0 },
        { type: 'SELECT', index: 3 },
      )
      expect(state.selected).toBe(3)
      expect(state.isZoomed).toBe(false)
    })
  })
})
