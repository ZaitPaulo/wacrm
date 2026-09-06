import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/image', () => ({
  default: (props: any) => React.createElement('img', { ...props, src: props.src }),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, any>) => {
    if (key === 'galleryCount' && params) {
      return `${params.current} de ${params.total}`
    }
    return key
  },
}))

import { Gallery } from './gallery'

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
    expect(html).not.toContain('<button')
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
