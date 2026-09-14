/**
 * Búsqueda de contactos para los selectores (el propietario de un
 * vehículo, por ejemplo). Pura, para que se pruebe sin montar nada.
 *
 * Tolerante a como escribe la gente: sin distinguir mayúsculas ni
 * tildes ("jose" encuentra a "José"), por palabras en cualquier orden
 * ("plata jose"), y por teléfono con cualquier formato en cuanto la
 * búsqueda trae tres dígitos o más.
 */

export interface PickableContact {
  id: string;
  name: string | null;
  phone: string | null;
}

/** Sin tildes y en minúsculas. */
function fold(s: string): string {
  // NFD separa la tilde de su letra; el rango son las marcas combinantes.
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Los contactos que coinciden, hasta `limit`, y cuántos quedaron fuera
 * del tope. Una lista de miles de filas no se puede recorrer a ojo: el
 * tope obliga a escribir, y `hidden` le dice al usuario que hay más.
 */
export function filterContacts(
  contacts: PickableContact[],
  query: string,
  limit: number
): { shown: PickableContact[]; hidden: number } {
  const words = fold(query.trim()).split(/\s+/).filter(Boolean);
  const digits = query.replace(/\D/g, '');

  const matches =
    words.length === 0
      ? contacts
      : contacts.filter((c) => {
          const name = fold(c.name ?? '');
          if (words.every((w) => name.includes(w))) return true;
          return digits.length >= 3 && (c.phone ?? '').replace(/\D/g, '').includes(digits);
        });

  return {
    shown: matches.slice(0, limit),
    hidden: Math.max(0, matches.length - limit),
  };
}
