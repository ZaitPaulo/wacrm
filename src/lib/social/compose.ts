// ============================================================
// El borrador completo: qué imágenes van y con qué texto.
//
// Separado de caption.ts porque son dos preguntas distintas —qué se
// cuenta y qué se muestra— y solo la segunda puede impedir que la
// publicación exista.
// ============================================================

import type { NetworkLimits } from './limits';
import { buildVehicleCaption, type BuildCaptionArgs } from './caption';

/** Por qué un vehículo no puede publicarse. Queda registrado en la fila. */
export type ComposeSkipReason = 'no_images';

export type ComposeResult =
  | { ok: true; caption: string; imageUrls: string[] }
  | { ok: false; reason: ComposeSkipReason };

export interface ComposeArgs extends BuildCaptionArgs {
  /** `inventory_vehicles.images`, en el orden en que se cargaron. */
  images: string[] | null;
  /**
   * Los de la red a la que va esta publicación.
   *
   * Se reciben en vez de leerse de un módulo fijo porque el máximo de
   * fotos no es el mismo en todas las redes: un vehículo de doce fotos
   * se recorta para una y no para la otra, y componer con el máximo
   * ajeno descartaría fotos que el destino real sí aceptaba.
   */
  limits: NetworkLimits;
}

/**
 * Arma el borrador de un vehículo.
 *
 * Sin imágenes no hay publicación: la publicación es una ficha visual
 * del vehículo y no hay nada que armar. Se devuelve el motivo en vez de
 * lanzar, porque "este vehículo no se puede publicar todavía" es un
 * resultado normal del encolado y no un error — y si mañana le cargan
 * fotos, se prepara.
 *
 * El orden de las imágenes importa más de lo que parece: Instagram
 * recorta todo el carrusel según la primera, así que se respeta el que
 * eligió quien cargó el vehículo y las que sobran se descartan por el
 * final.
 */
export function composeVehiclePost(args: ComposeArgs): ComposeResult {
  const { images, limits, ...captionArgs } = args;

  const imageUrls = (images ?? []).filter((url) => url.trim().length > 0);
  if (imageUrls.length === 0) {
    return { ok: false, reason: 'no_images' };
  }

  return {
    ok: true,
    caption: buildVehicleCaption(captionArgs),
    imageUrls: imageUrls.slice(0, limits.maxImages),
  };
}
