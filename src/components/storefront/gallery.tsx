'use client'

import { useReducer, useEffect, useRef, useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import Image from 'next/image'
import { ZoomIn, ZoomOut, X, ChevronLeft, ChevronRight } from 'lucide-react'

/** Escala mínima: la foto entera, ajustada al visor. */
export const MIN_SCALE = 1
export const MAX_SCALE = 4
/** Salto de la rueda del ratón y de los botones + / −. */
export const ZOOM_STEP = 0.5
/** A cuánto salta el botón de lupa desde la vista ajustada. */
export const TOGGLE_SCALE = 2.5

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

export type GalleryAction =
  | { type: 'OPEN' }
  | { type: 'CLOSE' }
  | { type: 'TOGGLE_ZOOM' }
  | { type: 'ZOOM_BY'; delta: number }
  | { type: 'PAN'; dx: number; dy: number; maxX: number; maxY: number }
  | { type: 'NEXT'; total: number }
  | { type: 'PREV'; total: number }
  | { type: 'SELECT'; index: number }

export interface GalleryState {
  isOpen: boolean
  /** 1 = ajustada al visor. Por encima, la foto se recorre arrastrando. */
  scale: number
  offsetX: number
  offsetY: number
  selected: number
}

/** Vista sin ampliar: escala 1 y centrada. */
const FIT = { scale: MIN_SCALE, offsetX: 0, offsetY: 0 }

export function galleryReducer(
  state: GalleryState,
  action: GalleryAction,
): GalleryState {
  switch (action.type) {
    case 'OPEN':
      return { ...state, isOpen: true, ...FIT }
    case 'CLOSE':
      return { ...state, isOpen: false, ...FIT }
    case 'TOGGLE_ZOOM':
      return state.scale > MIN_SCALE
        ? { ...state, ...FIT }
        : { ...state, scale: TOGGLE_SCALE, offsetX: 0, offsetY: 0 }
    case 'ZOOM_BY': {
      const scale = clamp(state.scale + action.delta, MIN_SCALE, MAX_SCALE)
      // Al volver a la vista ajustada se recentra: si no, la foto se
      // quedaría desplazada sin que quede margen para arrastrarla.
      if (scale === MIN_SCALE) return { ...state, ...FIT }
      // El desplazamiento se reescala con la ampliación para que el punto
      // que se está mirando no salte al cambiar de nivel.
      const ratio = scale / state.scale
      return {
        ...state,
        scale,
        offsetX: state.offsetX * ratio,
        offsetY: state.offsetY * ratio,
      }
    }
    case 'PAN':
      return {
        ...state,
        offsetX: clamp(state.offsetX + action.dx, -action.maxX, action.maxX),
        offsetY: clamp(state.offsetY + action.dy, -action.maxY, action.maxY),
      }
    case 'NEXT':
      return {
        ...state,
        selected: (state.selected + 1) % action.total,
        ...FIT,
      }
    case 'PREV':
      return {
        ...state,
        selected: (state.selected - 1 + action.total) % action.total,
        ...FIT,
      }
    case 'SELECT':
      return { ...state, selected: action.index, ...FIT }
    default:
      return state
  }
}

export interface GalleryProps {
  images: string[]
  alt: string
  initialOpen?: boolean
  initialScale?: number
}

export function Gallery({
  images,
  alt,
  initialOpen = false,
  initialScale = MIN_SCALE,
}: GalleryProps) {
  const s = useTranslations('Storefront')
  const [state, dispatch] = useReducer(galleryReducer, {
    selected: 0,
    isOpen: initialOpen,
    scale: initialScale,
    offsetX: 0,
    offsetY: 0,
  })
  const { selected, isOpen, scale, offsetX, offsetY } = state
  const isZoomed = scale > MIN_SCALE

  // Marco del visor y lienzo que lleva la transformación. Se miden en vivo
  // para saber cuánto sobresale la foto y no dejar arrastrarla más allá.
  const frameRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef({ active: false, x: 0, y: 0, moved: false })
  // El arrastre en curso sí necesita re-render —cambia el cursor y apaga la
  // transición—, así que va en estado y no solo en la ref.
  const [isDragging, setIsDragging] = useState(false)

  const panBounds = useCallback(() => {
    const frame = frameRef.current?.getBoundingClientRect()
    const stage = stageRef.current?.getBoundingClientRect()
    if (!frame || !stage) return { maxX: 0, maxY: 0 }
    return {
      maxX: Math.max(0, (stage.width - frame.width) / 2),
      maxY: Math.max(0, (stage.height - frame.height) / 2),
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dispatch({ type: 'CLOSE' })
      } else if (e.key === 'ArrowRight' && images.length > 1) {
        dispatch({ type: 'NEXT', total: images.length })
      } else if (e.key === 'ArrowLeft' && images.length > 1) {
        dispatch({ type: 'PREV', total: images.length })
      } else if (e.key === '+' || e.key === '=') {
        dispatch({ type: 'ZOOM_BY', delta: ZOOM_STEP })
      } else if (e.key === '-') {
        dispatch({ type: 'ZOOM_BY', delta: -ZOOM_STEP })
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

            {/* Visor. `overflow-hidden` a propósito: la ampliación se
                recorre arrastrando, no con las barras del navegador —que
                aparecían porque `scale()` no cambia el tamaño de caja, así
                que el contenedor seguía midiendo lo de antes y encajonaba
                la foto en una columna con scrollbars encima. */}
            <div
              ref={frameRef}
              className={`relative flex h-full w-full items-center justify-center overflow-hidden ${
                !isZoomed ? 'cursor-zoom-in' : isDragging ? 'cursor-grabbing' : 'cursor-grab'
              }`}
              onWheel={(e) => {
                e.stopPropagation()
                dispatch({
                  type: 'ZOOM_BY',
                  delta: e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP,
                })
              }}
              onPointerDown={(e) => {
                if (!isZoomed) return
                e.stopPropagation()
                dragRef.current = { active: true, x: e.clientX, y: e.clientY, moved: false }
                setIsDragging(true)
                e.currentTarget.setPointerCapture(e.pointerId)
              }}
              onPointerMove={(e) => {
                if (!dragRef.current.active) return
                const dx = e.clientX - dragRef.current.x
                const dy = e.clientY - dragRef.current.y
                if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragRef.current.moved = true
                dragRef.current.x = e.clientX
                dragRef.current.y = e.clientY
                const { maxX, maxY } = panBounds()
                dispatch({ type: 'PAN', dx, dy, maxX, maxY })
              }}
              onPointerUp={(e) => {
                if (dragRef.current.active) {
                  e.currentTarget.releasePointerCapture(e.pointerId)
                  dragRef.current.active = false
                  setIsDragging(false)
                }
              }}
              onPointerCancel={() => {
                dragRef.current.active = false
                setIsDragging(false)
              }}
              onClick={(e) => {
                e.stopPropagation()
                // Un arrastre termina en click; solo alterna si no se movió.
                if (dragRef.current.moved) {
                  dragRef.current.moved = false
                  return
                }
                dispatch({ type: 'TOGGLE_ZOOM' })
              }}
            >
              <div
                ref={stageRef}
                className="flex items-center justify-center will-change-transform"
                style={{
                  transform: `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${scale})`,
                  transition: isDragging ? 'none' : 'transform 200ms ease-out',
                }}
              >
                <Image
                  src={images[selected]}
                  alt={alt}
                  width={1920}
                  height={1080}
                  unoptimized
                  priority
                  draggable={false}
                  className="max-h-[78vh] max-w-[88vw] w-auto h-auto object-contain select-none pointer-events-none"
                />
              </div>
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
