// ============================================================
// Todo lo que depende de la política de Meta, en un solo lugar.
//
// Meta cambia estas reglas por su cuenta y sin avisarnos. Concentrarlas
// acá hace que actualizar sea un diff de un archivo, en vez de una
// cacería de constantes repartidas por el módulo.
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

/** Máximo de elementos en un carrusel. Fotos de más se descartan. */
export const MAX_CAROUSEL_ITEMS = 10;

/** Máximo de caracteres del texto de la publicación. */
export const CAPTION_MAX_CHARS = 2200;

/** Máximo de etiquetas (#) que Instagram acepta en un texto. */
export const MAX_HASHTAGS = 30;

/**
 * El único formato de imagen que Instagram publica.
 *
 * El bucket `showcase-media` acepta además PNG y WebP (migración 506),
 * así que las fotos de un vehículo pueden estar perfectamente cargadas
 * y aun así no ser publicables. Lo resuelve la conversión previa, no un
 * filtro: ver `src/lib/instagram/images.ts`.
 */
export const PUBLISHABLE_IMAGE_MIME = 'image/jpeg';

/** Extensiones que ya están en el formato publicable. */
const JPEG_EXTENSIONS = ['.jpg', '.jpeg'];

/**
 * True si la URL apunta a algo que Instagram ya acepta tal cual.
 *
 * Se decide por la extensión y no por el `Content-Type` real: la
 * comprobación corre sobre URLs del bucket, donde la extensión la puso
 * el uploader a partir del MIME validado, y evita una petición de red
 * por foto solo para clasificar. Un falso negativo cuesta una
 * conversión de más; un falso positivo lo atrapa Instagram al publicar.
 */
export function isPublishableImageUrl(url: string): boolean {
  const path = url.split('?')[0].toLowerCase();
  return JPEG_EXTENSIONS.some((ext) => path.endsWith(ext));
}

/** Cuenta las etiquetas de un texto, para validar contra MAX_HASHTAGS. */
export function countHashtags(caption: string): number {
  return (caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
}

export type CaptionProblem = 'too_long' | 'too_many_hashtags';

/**
 * Valida el texto contra los límites de Instagram.
 *
 * Se usa al EDITAR, no al publicar: descubrir el exceso por el rechazo
 * de Instagram desperdicia una aprobación, que es un recurso escaso
 * cuando hay un tope diario de por medio.
 *
 * Devuelve `null` cuando el texto está bien.
 */
export function validateCaption(caption: string): CaptionProblem | null {
  // [...caption] cuenta puntos de código, no unidades UTF-16: un emoji
  // fuera del plano básico vale 1 y no 2, que es como lo cuenta Meta.
  if ([...caption].length > CAPTION_MAX_CHARS) return 'too_long';
  if (countHashtags(caption) > MAX_HASHTAGS) return 'too_many_hashtags';
  return null;
}
