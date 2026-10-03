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

/**
 * Ordena los archivos recién elegidos por nombre, con orden natural.
 *
 * Existe porque el `FileList` de `<input type="file" multiple>` NO
 * llega en el orden que la persona ve: el estándar no fija ninguno y
 * cada plataforma entrega el suyo. El diálogo de Windows, por ejemplo,
 * pone primero el archivo que tenía el foco —el último clic de la
 * selección—, así que elegir "01.jpg" y luego Mayús+clic en "10.jpg"
 * devuelve 10, 01, 02… y la portada (la que lleva el diseño del feed)
 * cae en el segundo lugar sin que nadie la haya movido.
 *
 * El nombre es lo único estable que tenemos y es el orden que se ve en
 * el explorador: `numeric` hace que "foto 2" vaya antes que "foto 10" y
 * `sensitivity: 'base'` ignora mayúsculas y tildes. `sort` es estable,
 * así que dos nombres equivalentes conservan el orden de llegada.
 *
 * La base se compara antes que la extensión: con el nombre entero, el
 * espacio (que va antes que el punto) mandaba "foto (2).jpg" delante de
 * "foto.jpg", y la copia le quitaba la portada al original. La extensión
 * solo desempata dos bases equivalentes.
 *
 * Genérica sobre `{ name }` para probarla sin `File`. No muta la lista.
 */
export function sortFilesByName<T extends { name: string }>(
  files: readonly T[]
): T[] {
  const compare = (x: string, y: string) =>
    x.localeCompare(y, 'es', { numeric: true, sensitivity: 'base' });

  return [...files].sort((a, b) => {
    const [baseA, extA] = splitExtension(a.name);
    const [baseB, extB] = splitExtension(b.name);
    return compare(baseA, baseB) || compare(extA, extB);
  });
}

/**
 * Separa "nombre.ext" en base y extensión por el ÚLTIMO punto: las
 * descargas de WhatsApp Web llevan la hora con puntos en la base
 * ("… at 10.15.32 AM.jpeg"). Sin punto, o con el punto solo al inicio
 * (".jpg", un archivo oculto), todo el nombre es la base.
 */
function splitExtension(name: string): [string, string] {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return [name, ''];
  return [name.slice(0, dot), name.slice(dot + 1)];
}
