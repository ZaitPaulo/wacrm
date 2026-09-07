'use client'

import { useReducer, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import Image from 'next/image'
import { ZoomIn, ZoomOut, X, ChevronLeft, ChevronRight } from 'lucide-react'

export type GalleryAction =
  | { type: 'OPEN' }
  | { type: 'CLOSE' }
  | { type: 'TOGGLE_ZOOM' }
  | { type: 'NEXT'; total: number }
  | { type: 'PREV'; total: number }
  | { type: 'SELECT'; index: number }

export interface GalleryState {
  isOpen: boolean
  isZoomed: boolean
  selected: number
}

export function galleryReducer(
  state: GalleryState,
  action: GalleryAction,
): GalleryState {
  switch (action.type) {
    case 'OPEN':
      return { ...state, isOpen: true, isZoomed: false }
    case 'CLOSE':
      return { ...state, isOpen: false, isZoomed: false }
    case 'TOGGLE_ZOOM':
      return { ...state, isZoomed: !state.isZoomed }
    case 'NEXT':
      return {
        ...state,
        selected: (state.selected + 1) % action.total,
        isZoomed: false,
      }
    case 'PREV':
      return {
        ...state,
        selected: (state.selected - 1 + action.total) % action.total,
        isZoomed: false,
      }
    case 'SELECT':
      return { ...state, selected: action.index, isZoomed: false }
    default:
      return state
  }
}

export interface GalleryProps {
  images: string[]
  alt: string
  initialOpen?: boolean
  initialZoomed?: boolean
}

export function Gallery({
  images,
  alt,
  initialOpen = false,
  initialZoomed = false,
}: GalleryProps) {
  const s = useTranslations('Storefront')
  const [state, dispatch] = useReducer(galleryReducer, {
    selected: 0,
    isOpen: initialOpen,
    isZoomed: initialZoomed,
  })
  const { selected, isOpen, isZoomed } = state

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dispatch({ type: 'CLOSE' })
      } else if (e.key === 'ArrowRight' && images.length > 1) {
        dispatch({ type: 'NEXT', total: images.length })
      } else if (e.key === 'ArrowLeft' && images.length > 1) {
        dispatch({ type: 'PREV', total: images.length })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, images.length])

  useEffect(() => {
    if (!isOpen) return

    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [isOpen])

  if (images.length === 0) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-xl bg-[#eceef0] text-sm text-[#75777e]">
        {s('noPhoto')}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Foto principal */}
      <div className="group relative aspect-video overflow-hidden rounded-2xl bg-[#eceef0] shadow-xs">
        <button
          type="button"
          onClick={() => dispatch({ type: 'OPEN' })}
          className="relative block size-full cursor-zoom-in text-left focus:outline-hidden focus-visible:ring-2 focus-visible:ring-black"
          aria-label={s('zoomImage')}
        >
          <Image
            src={images[selected]}
            alt={alt}
            fill
            priority
            sizes="(min-width: 1024px) 66vw, 100vw"
            className="object-cover transition-transform duration-700 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/10" />
          <span className="absolute top-3 right-3 flex size-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-xs transition-transform group-hover:scale-110">
            <ZoomIn className="size-4" />
          </span>
        </button>
        {images.length > 1 && (
          <div className="pointer-events-none absolute bottom-3 right-3 rounded-full bg-black/75 px-3 py-1 text-xs font-bold uppercase tracking-wider text-white backdrop-blur-sm">
            {s('galleryCount', { current: selected + 1, total: images.length })}
          </div>
        )}
      </div>

      {/* Miniaturas en vista normal */}
      {images.length > 1 && (
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-3">
          {images.map((url, i) => (
            <button
              key={i}
              type="button"
              onClick={() => dispatch({ type: 'SELECT', index: i })}
              aria-current={i === selected}
              className={`relative aspect-video overflow-hidden rounded-lg border-2 transition-all ${
                i === selected
                  ? 'border-black ring-2 ring-(--brand) opacity-100'
                  : 'border-transparent opacity-60 hover:opacity-100'
              }`}
            >
              <Image src={url} alt="" fill sizes="140px" className="object-cover" />
            </button>
          ))}
        </div>
      )}

      {/* Modal / Lightbox a pantalla completa con zoom */}
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          onClick={() => dispatch({ type: 'CLOSE' })}
          className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-black/95 p-4 select-none backdrop-blur-xs"
        >
          {/* Barra superior de controles */}
          <div
            className="flex w-full items-center justify-between z-10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-xs font-bold uppercase tracking-wider text-neutral-300">
              {images.length > 1
                ? s('galleryCount', { current: selected + 1, total: images.length })
                : ''}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => dispatch({ type: 'TOGGLE_ZOOM' })}
                aria-label={isZoomed ? s('zoomOut') : s('zoomIn')}
                title={isZoomed ? s('zoomOut') : s('zoomIn')}
                className="flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-white"
              >
                {isZoomed ? <ZoomOut className="size-5" /> : <ZoomIn className="size-5" />}
              </button>
              <button
                type="button"
                onClick={() => dispatch({ type: 'CLOSE' })}
                aria-label={s('close')}
                title={s('close')}
                className="flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-white"
              >
                <X className="size-5" />
              </button>
            </div>
          </div>

          {/* Área principal: Controles de navegación e imagen */}
          <div
            className="relative flex flex-1 w-full items-center justify-center overflow-hidden"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                dispatch({ type: 'CLOSE' })
              }
            }}
          >
            {images.length > 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  dispatch({ type: 'PREV', total: images.length })
                }}
                aria-label={s('previousPhoto')}
                title={s('previousPhoto')}
                className="absolute left-2 sm:left-4 z-10 flex size-11 items-center justify-center rounded-full bg-black/60 text-white transition-all hover:bg-black/90 hover:scale-110 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-white"
              >
                <ChevronLeft className="size-6" />
              </button>
            )}

            <div
              className={`relative flex items-center justify-center max-h-[85vh] max-w-[90vw] transition-all duration-300 ${
                isZoomed
                  ? 'cursor-zoom-out overflow-auto'
                  : 'cursor-zoom-in'
              }`}
              onClick={(e) => {
                e.stopPropagation()
                dispatch({ type: 'TOGGLE_ZOOM' })
              }}
            >
              <Image
                src={images[selected]}
                alt={alt}
                width={1920}
                height={1080}
                unoptimized
                priority
                className={`max-h-[80vh] w-auto max-w-[85vw] object-contain select-none transition-transform duration-300 ${
                  isZoomed ? 'scale-150 sm:scale-200' : 'scale-100'
                }`}
              />
            </div>

            {images.length > 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  dispatch({ type: 'NEXT', total: images.length })
                }}
                aria-label={s('nextPhoto')}
                title={s('nextPhoto')}
                className="absolute right-2 sm:right-4 z-10 flex size-11 items-center justify-center rounded-full bg-black/60 text-white transition-all hover:bg-black/90 hover:scale-110 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-white"
              >
                <ChevronRight className="size-6" />
              </button>
            )}
          </div>

          {/* Carrusel inferior de miniaturas en el modal */}
          {images.length > 1 && (
            <div
              className="z-10 flex max-w-full gap-2 overflow-x-auto py-2 px-4"
              onClick={(e) => e.stopPropagation()}
            >
              {images.map((url, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => dispatch({ type: 'SELECT', index: i })}
                  aria-current={i === selected}
                  className={`relative h-12 w-16 shrink-0 overflow-hidden rounded-md border-2 transition-all ${
                    i === selected
                      ? 'border-white opacity-100 scale-105'
                      : 'border-transparent opacity-50 hover:opacity-100'
                  }`}
                >
                  <Image
                    src={url}
                    alt=""
                    width={80}
                    height={60}
                    unoptimized
                    className="size-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
