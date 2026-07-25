'use client';

import { useState } from 'react';
import Image from 'next/image';

// Galería de fotos del vehículo (estilo Loramotors): imagen grande
// aspect-video + tira de miniaturas en grilla. Client component.
export function Gallery({ images, alt }: { images: string[]; alt: string }) {
  const [selected, setSelected] = useState(0);

  if (images.length === 0) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-xl bg-[#eceef0] text-sm text-[#75777e]">
        Sin foto
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="group relative aspect-video overflow-hidden rounded-xl bg-[#eceef0]">
        <Image
          src={images[selected]}
          alt={alt}
          fill
          priority
          sizes="(min-width: 1024px) 66vw, 100vw"
          className="object-cover transition-transform duration-700 group-hover:scale-105"
        />
      </div>
      {images.length > 1 && (
        <div className="grid grid-cols-4 gap-4">
          {images.map((url, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setSelected(i)}
              className={`relative aspect-video overflow-hidden rounded-lg border-2 transition ${
                i === selected
                  ? 'border-black'
                  : 'border-transparent opacity-70 hover:opacity-100'
              }`}
            >
              <Image src={url} alt="" fill sizes="140px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
