// ============================================================
// Todo lo que depende de la política de Instagram, en un solo lugar.
//
// Meta cambia estas reglas por su cuenta y sin avisarnos. Concentrarlas
// acá hace que actualizar sea un diff de un archivo, en vez de una
// cacería de constantes repartidas por el módulo.
//
// Solo NÚMEROS de Instagram. La mecánica que los usa —validar el
// texto, contar etiquetas, reconocer una foto ya publicable— es común a
// todas las redes y vive en `src/lib/social/limits.ts`.
//
// Verificado contra la documentación vigente el 2026-08-12:
// https://developers.facebook.com/docs/instagram-platform/content-publishing
//
// El TOPE DE PUBLICACIONES NO ESTÁ ACÁ a propósito: se le pregunta a
// Instagram con getPublishingLimit(). Las propias docs de Meta se
// contradicen sobre ese número —100 en la guía, 50 en la referencia del
// endpoint—, así que cualquier constante nacería vencida y fallaría en
// la dirección peligrosa: creyéndose con margen que no hay.
// ============================================================

import type { NetworkLimits } from '../limits';

/** Máximo de elementos en un carrusel. Fotos de más se descartan. */
export const MAX_CAROUSEL_ITEMS = 10;

/** Máximo de caracteres del texto de la publicación. */
export const CAPTION_MAX_CHARS = 2200;

/** Máximo de etiquetas (#) que Instagram acepta en un texto. */
export const MAX_HASHTAGS = 30;

/** Los tres, como los consume el resto del sistema. */
export const INSTAGRAM_LIMITS: NetworkLimits = {
  maxImages: MAX_CAROUSEL_ITEMS,
  captionMaxChars: CAPTION_MAX_CHARS,
  maxHashtags: MAX_HASHTAGS,
};
