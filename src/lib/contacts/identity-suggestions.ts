import type { MessageChannel } from './channel-identity';

// ============================================================
// Sospechar que dos fichas son la misma persona.
//
// SOSPECHAR, no concluir. Todo lo que sale de acá es una sugerencia que
// alguien tiene que confirmar: unificar mal mezcla el historial, los
// documentos y las operaciones de dos clientes distintos, y ese daño es
// mayor y más difícil de revertir que el de mantener dos fichas.
//
// El único dato que comparten un contacto de WhatsApp y uno de
// Instagram es el NOMBRE. No hay teléfono del otro lado, ni correo, ni
// nada que Meta cruce entre productos.
// ============================================================

export interface SuggestionCandidate {
  contactId: string;
  /** Nombre tal como lo informó la plataforma. */
  name: string | null;
  /** Canales en los que ese contacto tiene identidad. */
  channels: MessageChannel[];
  /** Cuando no es null, la ficha ya está absorbida por otra. */
  mergedInto?: string | null;
}

export interface IdentitySuggestion {
  /** Las dos fichas, en orden estable (la más antigua primero). */
  contactIds: [string, string];
  /** Lo que las hizo parecerse. Hoy solo hay un motivo. */
  reason: 'same_name';
  /** El valor que coincidió, para mostrarlo en la sugerencia. */
  matchedOn: string;
}

/**
 * Normaliza un nombre para compararlo.
 *
 * Minúsculas, sin acentos, sin espacios de más. "José  Pérez" y "jose
 * perez" son la misma persona escribiendo su nombre en dos teclados
 * distintos, que es exactamente lo que pasa entre WhatsApp e Instagram.
 */
export function normalizeName(name: string): string {
  return (
    name
      .normalize('NFD')
      // Marcas diacríticas combinantes: lo que NFD separó de cada letra.
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
  );
}

/**
 * True si el nombre alcanza para molestar a una persona con una
 * sugerencia.
 *
 * Se exigen al menos dos palabras. Un solo nombre de pila coincide
 * demasiado —hay muchas Anas— y una lista de sugerencias en la que la
 * mayoría son falsas es una lista que nadie lee, que es el mismo
 * fracaso que una cola de publicaciones que nadie revisa.
 */
export function isDistinctiveName(normalized: string): boolean {
  return normalized.split(' ').filter(Boolean).length >= 2;
}

/**
 * Propone pares de fichas que podrían ser la misma persona.
 *
 * Reglas, todas conservadoras a propósito:
 *   - el nombre normalizado coincide y es distintivo;
 *   - las fichas NO comparten ningún canal — dos contactos de WhatsApp
 *     con el mismo nombre son dos personas distintas, y si fueran la
 *     misma ya los habría unido la deduplicación por teléfono;
 *   - ninguna de las dos está ya absorbida por otra.
 *
 * Función pura: recibe los candidatos y devuelve los pares. Quien la
 * llama decide de dónde salen y qué hace con el resultado.
 */
export function suggestIdentityLinks(
  candidates: SuggestionCandidate[]
): IdentitySuggestion[] {
  const porNombre = new Map<string, SuggestionCandidate[]>();

  for (const c of candidates) {
    if (c.mergedInto) continue;
    if (!c.name) continue;

    const normalized = normalizeName(c.name);
    if (!normalized || !isDistinctiveName(normalized)) continue;

    const grupo = porNombre.get(normalized) ?? [];
    grupo.push(c);
    porNombre.set(normalized, grupo);
  }

  const out: IdentitySuggestion[] = [];

  for (const [normalized, grupo] of porNombre) {
    if (grupo.length < 2) continue;

    for (let i = 0; i < grupo.length; i++) {
      for (let j = i + 1; j < grupo.length; j++) {
        const a = grupo[i];
        const b = grupo[j];

        // Mismo canal = personas distintas. Si fueran la misma, la
        // identidad de canal ya las habría resuelto como una sola.
        if (comparteCanal(a, b)) continue;

        out.push({
          contactIds: [a.contactId, b.contactId],
          reason: 'same_name',
          matchedOn: normalized,
        });
      }
    }
  }

  return out;
}

function comparteCanal(
  a: SuggestionCandidate,
  b: SuggestionCandidate
): boolean {
  return a.channels.some((channel) => b.channels.includes(channel));
}
