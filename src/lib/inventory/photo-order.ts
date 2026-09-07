// ============================================================
// El orden de las fotos de un vehículo, como operaciones puras.
//
// Vive fuera del componente porque acá está la regla de negocio y no
// el gesto: el orden de `inventory_vehicles.images` decide la portada
// de la vitrina, el encuadre del carrusel y —cuando el vehículo tiene
// más fotos que el tope de la red— CUÁLES fotos llegan a publicarse.
// Eso se prueba sin DOM.
// ============================================================

/**
 * Mueve la foto de `from` a `to`, desplazando el resto.
 *
 * Índices fuera de rango devuelven el arreglo igual en vez de lanzar:
 * un arrastre sobre algo que ya no está es un no-evento, no un error.
 */
export function reorderImages(
  images: string[],
  from: number,
  to: number
): string[] {
  if (from === to) return images;
  if (from < 0 || from >= images.length) return images;
  if (to < 0 || to >= images.length) return images;

  const next = [...images];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Lleva una foto al primer lugar conservando el orden relativo del
 * resto. Es `reorderImages(images, index, 0)`, con nombre propio
 * porque es la operación que la gente quiere casi siempre: cambiar la
 * portada, no acomodar la secuencia entera.
 */
export function makeCoverImage(images: string[], index: number): string[] {
  return reorderImages(images, index, 0);
}

/**
 * A partir de qué posición las fotos dejan de publicarse.
 *
 * Devuelve `null` cuando no hay nada que señalar —no se conoce ningún
 * tope, o todas entran—, y el tope en caso contrario. Se calcula
 * contra el MÁS ESTRICTO de los máximos: una foto que una red no
 * publica ya está fuera de algo, y esconderlo detrás del promedio
 * sería mentir sobre la red más chica.
 */
export function photoCutoff(
  imageCount: number,
  maxImages: number[]
): number | null {
  const finite = maxImages.filter((n) => Number.isFinite(n) && n > 0);
  if (finite.length === 0) return null;

  const strictest = Math.min(...finite);
  return imageCount > strictest ? strictest : null;
}
