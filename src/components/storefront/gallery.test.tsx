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

import {
  Gallery,
  galleryReducer,
  MIN_SCALE,
  MAX_SCALE,
  ZOOM_STEP,
  TOGGLE_SCALE,
} from './gallery'

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

  it('renders zoom-out button and a scaled, draggable stage when zoomed', () => {
    const html = renderToStaticMarkup(
      React.createElement(Gallery, {
        images: ['https://example.com/1.jpg'],
        alt: 'Car',
        initialOpen: true,
        initialScale: TOGGLE_SCALE,
      }),
    )

    expect(html).toContain('aria-label="zoomOut"')
    // La ampliacion va en el transform del lienzo, no en una clase fija.
    expect(html).toContain('scale(' + TOGGLE_SCALE + ')')
    // Se recorre arrastrando, nunca con barras de scroll del navegador.
    expect(html).toContain('cursor-grab')
  })

  it('never renders browser scrollbars inside the viewer', () => {
    for (const scale of [MIN_SCALE, TOGGLE_SCALE, MAX_SCALE]) {
      const html = renderToStaticMarkup(
        React.createElement(Gallery, {
          images: ['https://example.com/1.jpg'],
          alt: 'Car',
          initialOpen: true,
          initialScale: scale,
        }),
      )
      expect(html).not.toContain('overflow-auto')
      expect(html).toContain('overflow-hidden')
    }
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
    const fitted = (selected = 0) => ({
      isOpen: true,
      selected,
      scale: MIN_SCALE,
      offsetX: 0,
      offsetY: 0,
    })

    const zoomed = (selected = 0) => ({
      isOpen: true,
      selected,
      scale: TOGGLE_SCALE,
      offsetX: 40,
      offsetY: -25,
    })

    it('opens lightbox fitted to the viewer', () => {
      const state = galleryReducer({ ...zoomed(), isOpen: false }, { type: 'OPEN' })
      expect(state).toEqual(fitted(0))
    })

    it('closes lightbox and resets the view', () => {
      const state = galleryReducer(zoomed(2), { type: 'CLOSE' })
      expect(state).toEqual({ ...fitted(2), isOpen: false })
    })

    it('toggles between fitted and zoomed, recentring on the way back', () => {
      const state1 = galleryReducer(fitted(), { type: 'TOGGLE_ZOOM' })
      expect(state1.scale).toBe(TOGGLE_SCALE)
      expect(state1.offsetX).toBe(0)

      const state2 = galleryReducer({ ...state1, offsetX: 80 }, { type: 'TOGGLE_ZOOM' })
      expect(state2.scale).toBe(MIN_SCALE)
      expect(state2.offsetX).toBe(0)
    })

    it('zooms by steps and clamps to the allowed range', () => {
      expect(galleryReducer(fitted(), { type: 'ZOOM_BY', delta: -1 }).scale).toBe(MIN_SCALE)

      const maxed = galleryReducer(
        { ...fitted(), scale: MAX_SCALE },
        { type: 'ZOOM_BY', delta: 10 },
      )
      expect(maxed.scale).toBe(MAX_SCALE)

      const stepped = galleryReducer(fitted(), { type: 'ZOOM_BY', delta: ZOOM_STEP })
      expect(stepped.scale).toBe(MIN_SCALE + ZOOM_STEP)
    })

    it('recentres when zooming all the way back out', () => {
      const state = galleryReducer(
        { isOpen: true, selected: 0, scale: MIN_SCALE + ZOOM_STEP, offsetX: 90, offsetY: 60 },
        { type: 'ZOOM_BY', delta: -ZOOM_STEP },
      )
      expect(state).toEqual(fitted(0))
    })

    it('pans within bounds and never past them', () => {
      const start = { isOpen: true, selected: 0, scale: TOGGLE_SCALE, offsetX: 0, offsetY: 0 }

      const moved = galleryReducer(start, { type: 'PAN', dx: 30, dy: -20, maxX: 100, maxY: 100 })
      expect(moved.offsetX).toBe(30)
      expect(moved.offsetY).toBe(-20)

      const clamped = galleryReducer(moved, { type: 'PAN', dx: 500, dy: -500, maxX: 100, maxY: 100 })
      expect(clamped.offsetX).toBe(100)
      expect(clamped.offsetY).toBe(-100)
    })

    it('cannot pan at all when the photo fits the viewer', () => {
      const state = galleryReducer(fitted(), { type: 'PAN', dx: 50, dy: 50, maxX: 0, maxY: 0 })
      expect(state.offsetX).toBe(0)
      expect(state.offsetY).toBe(0)
    })

    it('navigates to next photo and wraps around, resetting the view', () => {
      const state1 = galleryReducer(zoomed(0), { type: 'NEXT', total: 3 })
      expect(state1).toEqual(fitted(1))

      const state2 = galleryReducer(zoomed(2), { type: 'NEXT', total: 3 })
      expect(state2.selected).toBe(0)
    })

    it('navigates to previous photo and wraps around, resetting the view', () => {
      const state1 = galleryReducer(zoomed(1), { type: 'PREV', total: 3 })
      expect(state1).toEqual(fitted(0))

      const state2 = galleryReducer(zoomed(0), { type: 'PREV', total: 3 })
      expect(state2.selected).toBe(2)
    })

    it('selects a specific photo by index, resetting the view', () => {
      const state = galleryReducer(zoomed(0), { type: 'SELECT', index: 3 })
      expect(state).toEqual(fitted(3))
    })
  })
})
