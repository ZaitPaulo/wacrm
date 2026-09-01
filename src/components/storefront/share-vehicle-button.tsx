'use client';

import { useTranslations } from 'next-intl';
import { Share2 } from 'lucide-react';
import { useVehicleShare } from '@/hooks/use-vehicle-share';
import type { ShareableVehicle } from '@/lib/showcase/share';

// Botón de compartir de la vitrina, en las dos formas que necesita:
// cuadrado con sólo el ícono junto al CTA de la tarjeta, y ancho
// completo con texto en la ficha del vehículo. Vive acá y no en
// components/ui porque usa la paleta propia de la vitrina (slate sobre
// blanco), independiente de los tokens de tema del CRM.

export function ShareVehicleButton({
  vehicle,
  currency,
  baseUrl,
  variant = 'card',
}: {
  /** Vehículo que se comparte; de él sale el texto del mensaje. */
  vehicle: ShareableVehicle;
  /** Moneda de la cuenta, para el precio del mensaje. */
  currency: string;
  /** Base pública del sitio, calculada en el servidor. Ver el hook. */
  baseUrl: string;
  /**
   * `card` = cuadrado con sólo el ícono, para ir al lado del CTA verde
   * de la tarjeta. `detail` = ancho completo con texto, para la columna
   * de acciones de la ficha.
   */
  variant?: 'card' | 'detail';
}) {
  const s = useTranslations('Storefront');
  const { shareHref, copyLink } = useVehicleShare({ currency, baseUrl });
  const label = s('shareOnWhatsApp');

  // La tarjeta entera es un enlace al detalle (un <Link> superpuesto con
  // z-10), así que este ancla necesita quedar por encima para ser un
  // destino propio, igual que el CTA verde.
  const base =
    'relative z-20 inline-flex items-center justify-center gap-2 rounded-lg' +
    ' border border-[#c5c6cd] bg-white text-[#191c1e] transition-colors' +
    ' hover:bg-[#f2f4f6]';

  return (
    <a
      href={shareHref(vehicle)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => copyLink(vehicle)}
      title={label}
      aria-label={variant === 'card' ? label : undefined}
      className={
        variant === 'card'
          ? `${base} size-11 shrink-0`
          : `${base} w-full px-6 py-4 text-sm font-semibold uppercase tracking-wide`
      }
    >
      <Share2 className={variant === 'card' ? 'size-[18px]' : 'size-5'} />
      {variant === 'detail' && label}
    </a>
  );
}
