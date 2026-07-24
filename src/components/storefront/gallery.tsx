'use client';

import { useState } from 'react';
import Image from 'next/image';

// Galería de fotos del vehículo: imagen grande + tira de miniaturas
// clickeables. Client component (mantiene el índice seleccionado).
export function Gallery({ images, alt }: { images: string[]; alt: string }) {
  const [selected, setSelected] = useState(0);

  if (images.length === 0) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center rounded-2xl bg-slate-100 text-sm text-slate-400">
        Sin foto
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-slate-100">
        <Image
          src={images[selected]}
          alt={alt}
          fill
          sizes="(min-width: 1024px) 600px, 100vw"
          className="object-cover"
          priority
        />
      </div>
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((url, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setSelected(i)}
              className={`relative size-16 shrink-0 overflow-hidden rounded-lg border-2 transition ${
                i === selected ? 'border-slate-900' : 'border-transparent opacity-70 hover:opacity-100'
              }`}
            >
              <Image src={url} alt="" fill sizes="64px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
