// ============================================================
// El borrador completo: qué imágenes van y con qué texto.
//
// Separado de caption.ts porque son dos preguntas distintas —qué se
// cuenta y qué se muestra— y solo la segunda puede impedir que la
// publicación exista.
// ============================================================

import { MAX_CAROUSEL_ITEMS } from './limits';
import { buildVehicleCaption, type BuildCaptionArgs } from './caption';

/** Por qué un vehículo no puede publicarse. Queda registrado en la fila. */
export type ComposeSkipReason = 'no_images';

export type ComposeResult =
  | { ok: true; caption: string; imageUrls: string[] }
  | { ok: false; reason: ComposeSkipReason };

export interface ComposeArgs extends BuildCaptionArgs {
  /** `inventory_vehicles.images`, en el orden en que se cargaron. */
  images: string[] | null;
}

/**
 * Arma el borrador de un vehículo.
 *
 * Sin imágenes no hay publicación: Instagram exige contenido visual y
 * no hay nada que armar. Se devuelve el motivo en vez de lanzar, porque
 * "este vehículo no se puede publicar todavía" es un resultado normal
 * del encolado y no un error — y si mañana le cargan fotos, se prepara.
 *
 * El orden de las imágenes importa más de lo que parece: Instagram
 * recorta todo el carrusel según la primera, así que se respeta el que
 * eligió quien cargó el vehículo y las que sobran se descartan por el
 * final.
 */
export function composeVehiclePost(args: ComposeArgs): ComposeResult {
  const { images, ...captionArgs } = args;

  const imageUrls = (images ?? []).filter((url) => url.trim().length > 0);
  if (imageUrls.length === 0) {
    return { ok: false, reason: 'no_images' };
  }

  return {
    ok: true,
    caption: buildVehicleCaption(captionArgs),
    imageUrls: imageUrls.slice(0, MAX_CAROUSEL_ITEMS),
  };
}
