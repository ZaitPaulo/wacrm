/**
 * Llenado y validación de las variables de una plantilla que un asesor
 * envía a mano desde la bandeja o la ficha del contacto.
 *
 * Existe por el 2026-09-28: salieron diez "Hola 1, ¿sigues buscando
 * vehículo?…". El selector obligaba a llenar {{1}} a mano, no conocía al
 * contacto y aceptaba cualquier cosa, así que para poder enviar se
 * escribía "1". Ahora el saludo viene con el primer nombre y un valor de
 * relleno no deja enviar.
 */

/** Saludos tras los que una variable es, en la práctica, el nombre. */
const GREETING = /(?:^|[\s¡¿])(hola|buen d[ií]a|buenos d[ií]as|buenas tardes|buenas noches|buenas)[\s,]*\{\{(\d+)\}\}/gi

/** Índices de las variables `{{n}}` que siguen a un saludo. */
export function greetingVariableIndices(bodyText: string): number[] {
  const indices = new Set<number>()
  for (const match of bodyText.matchAll(GREETING)) indices.add(Number(match[2]))
  return [...indices]
}

/**
 * El primer nombre para saludar: la primera palabra de al menos dos
 * letras, con mayúscula inicial. `null` si el nombre del contacto es un
 * emoji, un número o una letra suelta: mejor un campo vacío que el
 * asesor llena, que un "Hola ⭐".
 */
export function firstNameForGreeting(name: string | null | undefined): string | null {
  if (!name) return null
  const word = name.match(/\p{L}{2,}/u)?.[0]
  if (!word) return null
  return word.charAt(0).toLocaleUpperCase('es') + word.slice(1).toLocaleLowerCase('es')
}

/**
 * ¿Es un valor de relleno? Solo dígitos o un único carácter. Un campo
 * vacío NO cuenta aquí: eso ya lo ataja la regla de que toda variable
 * es obligatoria, y cada regla tiene su propio aviso.
 */
export function isPlaceholderValue(value: string): boolean {
  const v = value.trim()
  if (v === '') return false
  return /^\d+$/.test(v) || [...v].length === 1
}
