'use client';

// ============================================================
// Compartir un vehículo por WhatsApp, del lado del cliente.
//
// El armado del mensaje vive en `@/lib/showcase/share` (puro y probado);
// acá sólo queda lo que necesita navegador: traducciones para las
// etiquetas de especificaciones y la copia al portapapeles.
//
// Se usa desde los tres puntos donde aparece el botón —tarjeta de la
// vitrina, ficha del vehículo e inventario del CRM— y cada uno pinta su
// propio botón, porque la vitrina tiene su paleta y el CRM la suya.
// ============================================================

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  publicBaseUrl,
  vehicleShareMessage,
  vehicleShareUrl,
  whatsappShareHref,
  type ShareableVehicle,
} from '@/lib/showcase/share';

interface Options {
  /** Moneda de la cuenta, para el precio del mensaje. */
  currency: string;
  /**
   * Base pública del sitio. Las páginas de la vitrina la pasan desde el
   * servidor (ya la calculan para su metadata), y así el enlace del
   * primer render es el mismo que el del cliente. Si se omite se
   * resuelve con `publicBaseUrl()` — suficiente para el CRM, que es
   * cliente puro.
   */
  baseUrl?: string;
}

/**
 * Devuelve las dos piezas del botón de compartir: el enlace que abre
 * WhatsApp con la ficha redactada (`shareHref`) y el manejador que copia
 * el link al portapapeles (`copyLink`).
 *
 * Van juntas y no en un componente porque cada pantalla pinta su propio
 * botón: la vitrina con su paleta propia, el CRM con los tokens del
 * tema. Lo único que tienen que compartir es el mensaje.
 *
 * Ambas reciben el vehículo por parámetro en vez de fijarlo en el hook,
 * para que una tabla de 136 filas llame al hook una vez y no una por
 * fila.
 *
 * Uso:
 *   const { shareHref, copyLink } = useVehicleShare({ currency });
 *   <a href={shareHref(v)} onClick={() => copyLink(v)} target="_blank">
 */
export function useVehicleShare({ currency, baseUrl }: Options) {
  const t = useTranslations('Inventory');
  const c = useTranslations('Common');

  /** URL pública de la ficha del vehículo. Base explícita si la hay. */
  const linkOf = useCallback(
    (vehicle: ShareableVehicle) =>
      vehicleShareUrl(baseUrl || publicBaseUrl(), vehicle.id),
    [baseUrl],
  );

  /** Enlace `wa.me` con la ficha ya escrita y sin destinatario. */
  const shareHref = useCallback(
    (vehicle: ShareableVehicle) =>
      whatsappShareHref(
        vehicleShareMessage(vehicle, { currency, url: linkOf(vehicle), t }),
      ),
    [currency, linkOf, t],
  );

  /**
   * Copia el link al portapapeles, para quien prefiere pegarlo a mano.
   *
   * Va como `onClick` del mismo ancla que abre WhatsApp, así que NO
   * espera a la promesa: hacerlo cedería el gesto del usuario y algunos
   * navegadores cancelarían la navegación al pasarla a segundo plano.
   *
   * Falla en silencio a propósito. `navigator.clipboard` no existe fuera
   * de contexto seguro (un despliegue por http a secas), y ahí lo que
   * importa —abrir WhatsApp con el mensaje— igual funciona: un error en
   * rojo cada vez que se comparte sería peor que no avisar.
   */
  const copyLink = useCallback(
    (vehicle: ShareableVehicle) => {
      navigator.clipboard
        ?.writeText(linkOf(vehicle))
        .then(() => toast.success(c('linkCopied')))
        .catch((err) => console.warn('[share] no se pudo copiar el link:', err));
    },
    [linkOf, c],
  );

  return { shareHref, copyLink };
}
