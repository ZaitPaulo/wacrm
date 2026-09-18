import type { InventoryEntry } from './inventory-index'

// ============================================================
// Ningún vehículo nombrado sale sin su enlace.
//
// El prompt ya pide mandar la ficha de cada carro que se nombra, y el
// índice ya trae el enlace. Aun así, el 2026-09-17 el bot ofreció una
// Sorento, un March y un Logan sin enlace: una instrucción es una
// sugerencia. Esto lo garantiza por código, sobre el texto final y sin
// otra generación: busca los vehículos del inventario que la respuesta
// nombra y agrega al final los enlaces que falten.
// ============================================================

/** Tope de enlaces agregados: el prompt no ofrece más de 3 por mensaje. */
const MAX_ADDED_LINKS = 3

/** Cuánto texto puede haber entre el modelo y el año ("Sorento Radical
 *  2015", "Beat LT 2020"). Sin cruzar un punto ni un salto de línea: el
 *  año de la frase siguiente es de otro carro. */
const YEAR_WINDOW = 25

/** Palabras con que empiezan algunos modelos y que no los distinguen:
 *  "NEW SPORTAGE LX" se nombra "Sportage". */
const GENERIC_PREFIXES = new Set(['new', 'all', 'nuevo', 'nueva'])

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** "RIO UB EX" → "Rio UB EX": las palabras de hasta dos letras, o de
 *  tres sin vocales, son siglas de versión (LT, EX, LTZ) y se quedan en
 *  mayúsculas. */
function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) =>
      /^(\p{L}{1,2}|[^\WaeiouAEIOU\d_]{3})$/u.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join(' ')
}

interface Mention {
  entry: InventoryEntry
  /** Palabras del modelo con que se lo encontró; más es más preciso. */
  strength: number
  /** Posición de la mención, para agregar los enlaces en ese orden. */
  at: number
}

/** Dónde nombra el texto a este vehículo, o null. Prueba del nombre más
 *  preciso al más corto, siempre con el año a continuación:
 *    - el modelo completo ("March Advance")
 *    - si empieza corto, sus dos primeras palabras ("BT 50")
 *    - su primera palabra ("March" por "MARCH ADVANCE")
 *    - si es de uno o dos caracteres, con la marca ("Mazda 3"): solo,
 *      un "3" aparece en cualquier parte. */
function findMention(text: string, entry: InventoryEntry): Mention | null {
  // El guion cuenta como separador: "BT-50", "BT 50" y "BT50" son el mismo.
  const words = normalize(entry.model).split(/[\s-]+/).filter(Boolean)
  while (words.length > 1 && GENERIC_PREFIXES.has(words[0])) words.shift()
  if (words.length === 0) return null

  const short = words[0].length < 3
  const candidates = [words]
  if (words.length > 2 && short) candidates.push(words.slice(0, 2))
  if (words.length > 1 && !short) candidates.push([words[0]])
  if (short) candidates.push([...normalize(entry.brand).split(/\s+/), words[0]])

  for (const phrase of candidates) {
    const re = new RegExp(
      `(?<![\\p{L}\\p{N}])${phrase.map(escapeRegExp).join('[\\s-]*')}(?![\\p{L}\\p{N}])` +
        `[^\\n.!?]{0,${YEAR_WINDOW}}?(?<!\\d)${entry.year}(?!\\d)`,
      'u',
    )
    const m = re.exec(text)
    if (m) return { entry, strength: phrase.length, at: m.index }
  }
  return null
}

/** Formas en que la respuesta puede escribir el precio. */
function priceForms(price: number): string[] {
  const dotted = Math.round(price).toLocaleString('de-DE')
  const millions = price / 1_000_000
  return [dotted, `${millions} millones`, `${String(millions).replace('.', ',')} millones`]
}

/**
 * Devuelve `text` con el enlace de cada vehículo nombrado que no lo trae,
 * agregado al final. Si no falta ninguno, devuelve `text` sin cambios.
 *
 * Varios vehículos pueden compartir modelo y año; el precio escrito en el
 * texto desempata, y si no desempata se mandan todos. Que uno del grupo
 * ya tenga su enlace basta: el modelo eligió cuál.
 */
export function ensureVehicleLinks(text: string, entries: readonly InventoryEntry[]): string {
  const norm = normalize(text)
  const linked = (e: InventoryEntry) =>
    (e.url != null && text.includes(e.url)) || text.includes(`/vehiculo/${e.id}`)

  const mentions = entries
    .filter((e) => e.url != null)
    .map((e) => findMention(norm, e))
    .filter((m): m is Mention => m !== null)

  // Agrupa por dónde se nombró: dos vehículos encontrados en la misma
  // mención son la misma frase, y solo el que mejor calza la ocupa.
  const groups = new Map<number, Mention[]>()
  for (const m of mentions) {
    const g = groups.get(m.at) ?? []
    g.push(m)
    groups.set(m.at, g)
  }

  const missing: InventoryEntry[] = []
  for (const at of [...groups.keys()].sort((a, b) => a - b)) {
    const group = groups.get(at)!
    const best = Math.max(...group.map((m) => m.strength))
    let chosen = group.filter((m) => m.strength === best).map((m) => m.entry)
    if (chosen.some(linked)) continue

    const byPrice = chosen.filter((e) => priceForms(e.price).some((f) => norm.includes(f)))
    if (byPrice.length > 0) chosen = byPrice

    for (const e of chosen) {
      if (!missing.includes(e)) missing.push(e)
    }
  }

  if (missing.length === 0) return text

  const lines = missing
    .slice(0, MAX_ADDED_LINKS)
    .map((e) => `${titleCase(e.brand)} ${titleCase(e.model)} ${e.year}: ${e.url}`)
  return `${text.trimEnd()}\n\n${lines.join('\n')}`
}
