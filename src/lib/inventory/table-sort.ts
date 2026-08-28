// ============================================================
// Ordenar y buscar en la tabla de inventario.
//
// La tabla trae los vehículos de la cuenta en una sola respuesta, así
// que ordenar y filtrar ocurre en el navegador. Lo que vive acá es solo
// la parte que no sabe nada de vehículos: comparar dos valores y decidir
// si un texto casa con lo que se escribió. Así se puede probar sin armar
// un vehículo completo ni un árbol de React.
// ============================================================

/**
 * Texto comparable: sin mayúsculas y sin tildes.
 *
 * Sin quitar las tildes, buscar "bogota" no encontraría "BOGOTÁ" y
 * ordenar por matrícula dejaría las ciudades acentuadas fuera de su
 * sitio. Nadie escribe tildes en un buscador con prisa.
 */
export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export type SortDirection = 'asc' | 'desc';

/**
 * Compara dos valores de una misma columna.
 *
 * Dos decisiones que no son obvias:
 *
 * - **Los vacíos van siempre al final**, suba o baje el orden. Un
 *   kilometraje desconocido no es "cero kilómetros" ni "infinitos": es
 *   el dato que no interesa ver, y enterrarlo abajo en los dos sentidos
 *   es lo único que no miente.
 * - **Comparación numérica dentro del texto**, para que "ONIX 2" no
 *   quede después de "ONIX 10" por ser "1" menor que "2".
 */
export function compareSortValues(
  a: string | number | null,
  b: string | number | null,
  dir: SortDirection
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;

  const factor = dir === 'asc' ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') {
    return (a - b) * factor;
  }
  return (
    String(a).localeCompare(String(b), undefined, { numeric: true }) * factor
  );
}

/**
 * Parte lo que se escribió en el buscador en palabras comparables.
 *
 * Se separa por espacios a propósito: con una consulta de dos palabras
 * la intención casi nunca es la frase literal, sino acotar. "kia 2018"
 * quiere los KIA de 2018, no un texto que diga "kia 2018".
 */
export function searchTerms(query: string): string[] {
  return normalize(query).split(/\s+/).filter(Boolean);
}

/**
 * Verdadero si TODAS las palabras aparecen en el texto.
 *
 * `haystack` tiene que venir ya normalizado (por `normalize`), que es
 * como lo arma quien llama para no repetir el trabajo por cada tecla.
 */
export function matchesSearch(haystack: string, terms: string[]): boolean {
  return terms.every((term) => haystack.includes(term));
}
