// ============================================================
// Compresión de imágenes en el navegador, ANTES de subirlas.
//
// El bucket `showcase-media` corta en 5 MB y una foto de celular
// moderno pesa entre 3 y 12 MB, así que sin esto buena parte de las
// fotos de un vehículo fallan al subir — y el usuario solo ve el
// mensaje crudo de Supabase, en inglés, sin decirle que el problema es
// el peso.
//
// Se convierte a WebP porque a igual calidad percibida pesa bastante
// menos que JPEG y, a diferencia de él, conserva la transparencia (lo
// que importa para el logo del negocio). Que las fotos queden en WebP
// NO rompe la publicación en Instagram: `lib/social/images.ts` las
// convierte a JPEG con sharp antes de publicar, y
// `isPublishableImageUrl` ya clasifica un `.webp` como "hay que
// convertir".
//
// Todo esto corre en el cliente: usa canvas y no puede ejecutarse en el
// servidor. Los helpers puros están exportados aparte para poder
// probarlos sin un DOM.
// ============================================================

/** Lado mayor al que se redimensiona. Suficiente para pantalla grande. */
export const IMAGE_MAX_DIMENSION = 1920;

/** Calidad de WebP. Por encima de ~0.85 el archivo crece sin verse mejor. */
export const WEBP_QUALITY = 0.82;

/**
 * Tipos que NO se tocan:
 * - `gif`: recomprimir en WebP por canvas se queda con el primer
 *   fotograma y mata la animación.
 * - `svg`: es vectorial; rasterizarlo sería empeorarlo.
 */
const SKIPPED_TYPES = new Set(['image/gif', 'image/svg+xml']);

/**
 * Dimensiones de destino conservando la proporción.
 *
 * Solo reduce: una foto que ya es más pequeña que el tope se queda como
 * está, porque ampliarla inventaría píxeles y engordaría el archivo.
 */
export function targetDimensions(
  width: number,
  height: number,
  max: number = IMAGE_MAX_DIMENSION,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  // `round` y no `floor`: con floor, una imagen de proporción exacta
  // pierde un píxel y deja un borde transparente de 1 px al dibujarla.
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Cambia la extensión a `.webp`.
 *
 * Importa más de lo que parece: `buildMediaPath` deduce la extensión del
 * objeto en Storage a partir del nombre del archivo, así que un WebP
 * llamado `foto.jpg` acabaría guardado como `.jpg` — y entonces
 * `isPublishableImageUrl` lo daría por publicable en Instagram sin
 * serlo.
 */
export function toWebpName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '');
  return `${base || 'imagen'}.webp`;
}

/** Decodifica el archivo a algo dibujable en un canvas. */
async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file);
  }
  // Safari antiguo no trae createImageBitmap para File.
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('No se pudo decodificar la imagen'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
}

export interface CompressImageOptions {
  maxDimension?: number;
  quality?: number;
}

/**
 * Devuelve una versión redimensionada y recomprimida en WebP del
 * archivo. **Nunca lanza**: ante cualquier fallo devuelve el original,
 * porque perder la posibilidad de subir una foto es peor que subirla
 * pesada, y el tope del bucket sigue ahí como red.
 *
 * También devuelve el original cuando el WebP sale más grande, que pasa
 * con imágenes ya optimizadas o muy pequeñas.
 */
export async function compressImage(
  file: File,
  options: CompressImageOptions = {},
): Promise<File> {
  const { maxDimension = IMAGE_MAX_DIMENSION, quality = WEBP_QUALITY } = options;

  if (!file.type.startsWith('image/') || SKIPPED_TYPES.has(file.type)) {
    return file;
  }

  try {
    const source = await decode(file);
    const sourceWidth = 'width' in source ? source.width : 0;
    const sourceHeight = 'height' in source ? source.height : 0;
    if (!sourceWidth || !sourceHeight) return file;

    const { width, height } = targetDimensions(sourceWidth, sourceHeight, maxDimension);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(source as CanvasImageSource, 0, 0, width, height);

    // Liberar la memoria del bitmap antes de codificar: en un móvil con
    // varias fotos en cola, mantenerlo vivo es lo que dispara el fallo
    // por memoria.
    if ('close' in source) source.close();

    const blob = await toBlob(canvas, quality);
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], toWebpName(file.name), {
      type: 'image/webp',
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}
