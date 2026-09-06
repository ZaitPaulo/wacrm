'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import Image from 'next/image'

export function Gallery({ images, alt }: { images: string[]; alt: string }) {
  const s = useTranslations('Storefront')
  const [selected, setSelected] = useState(0)

  if (images.length === 0) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-xl bg-[#eceef0] text-sm text-[#75777e]">
        {s('noPhoto')}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="group relative aspect-video overflow-hidden rounded-2xl bg-[#eceef0] shadow-xs">
        <Image
          src={images[selected]}
          alt={alt}
          fill
          priority
          sizes="(min-width: 1024px) 66vw, 100vw"
          className="object-cover transition-transform duration-700 group-hover:scale-105"
        />
        {images.length > 1 && (
          <div className="absolute bottom-3 right-3 rounded-full bg-black/75 px-3 py-1 text-xs font-bold uppercase tracking-wider text-white backdrop-blur-sm">
            {s('galleryCount', { current: selected + 1, total: images.length })}
          </div>
        )}
      </div>

      {images.length > 1 && (
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-3">
          {images.map((url, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setSelected(i)}
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
    </div>
  )
}
