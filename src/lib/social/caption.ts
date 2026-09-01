// ============================================================
// El texto de la publicación, armado desde la ficha del vehículo.
//
// Función PURA con el traductor inyectado, igual que `labelOf` en
// src/lib/inventory/specs.ts: se puede testear por igualdad sin montar
// next-intl ni tocar la base.
//
// La IA no entra acá. El borrador siempre sale de esta plantilla
// (decisión 9 del design); reescribirlo con la IA de la cuenta es algo
// que pide una persona desde la pantalla de revisión, y una cuenta sin
// IA configurada tiene la cola igual de funcional.
//
// EL FORMATO NO ES NUESTRO. Calca el que el negocio ya venía publicando
// a mano —mayúsculas, una línea por dato, SOAT y tecnomecánica, los dos
// precios y el cierre comercial—, porque su feed es suyo y una
// publicación que se ve distinta a las de al lado se lee como ajena.
// Cambiarlo "para que quede más prolijo" es romperlo.
// ============================================================

import { formatNumber, formatPrice } from '@/lib/showcase/format';

/**
 * Lo que la publicación puede contar de un vehículo.
 *
 * ESTA LISTA ES LA DEFENSA DEL DATO RESERVADO, y por eso es explícita
 * en vez de `Partial<InventoryVehicle>`: lo que no está acá no puede
 * aparecer en el texto ni por descuido ni por un `select=*` que crezca
 * mañana. Quedan fuera a propósito:
 *
 *   - el costo de adquisición, que ni siquiera vive en esta tabla
 *     (`vehicle_acquisitions`, migración 508, RLS de 'admin');
 *   - `internal_notes`, que el knowledge base sí usa porque alimenta
 *     respuestas internas — una publicación es contenido público;
 *   - `vin` y `license_plate`, que identifican al vehículo ante
 *     terceros y no le sirven a quien está mirando el feed.
 */
export interface VehicleForCaption {
  brand: string;
  model: string;
  year: number;
  price: number;
  /** Precio con garantía incluida. El negocio publica los dos. */
  warranty_price: number | null;
  mileage: number | null;
  transmission: string | null;
  engine_displacement: string | null;
  /** Ciudad de MATRÍCULA, no dónde está parqueado (migración 511). */
  plate_city: string | null;
  /** Vencimiento del SOAT, en ISO (`YYYY-MM-DD`). */
  soat_expires_at: string | null;
  /** Vencimiento de la tecnomecánica, en ISO (`YYYY-MM-DD`). */
  tecnomecanica_expires_at: string | null;
}

/** Los datos públicos del negocio que la publicación puede citar. */
export interface AccountForCaption {
  default_currency: string;
  /** Nombre comercial, que cierra la publicación tras las etiquetas. */
  public_name: string | null;
  /** Dirección del local, para quien quiera pasar a verlo. */
  public_address: string | null;
  public_whatsapp: string | null;
  public_phone: string | null;
  public_email: string | null;
}

/** Traductor del namespace de la publicación, ya acotado por el llamador. */
type Translator = (key: string, values?: Record<string, string>) => string;

export interface BuildCaptionArgs {
  vehicle: VehicleForCaption;
  account: AccountForCaption;
  /** Namespace de la publicación (`SocialPost`). */
  t: Translator;
}

/**
 * Arma el texto propuesto.
 *
 * Los datos ausentes SE OMITEN, no se rellenan: una línea
 * "Kilometraje: —" en el feed del cliente se lee como descuido, no como
 * información faltante. La ÚNICA excepción son el SOAT y la
 * tecnomecánica, que se escriben "NA" cuando faltan porque así los
 * publica el negocio: ahí el vacío es la respuesta, no un olvido, y
 * omitir la línea haría dudar al comprador en vez de informarlo.
 */
export function buildVehicleCaption(args: BuildCaptionArgs): string {
  const { vehicle: v, account, t } = args;

  const lines: string[] = [];

  // Encabezado: marca y línea, sin el año, que va en su propio renglón
  // debajo — es como se lee de un vistazo en el feed.
  lines.push(t('title', { vehicle: `${v.brand} ${v.model}` }));
  lines.push(t('modelYear', { value: String(v.year) }));

  if (v.mileage != null) {
    lines.push(t('mileage', { value: formatNumber(v.mileage) }));
  }

  // `other` no se traduce a nada que informe, así que no ocupa línea.
  if (v.transmission && v.transmission !== 'other') {
    lines.push(t(`transmission.${v.transmission}`));
  }

  if (v.engine_displacement) {
    lines.push(t('engine', { value: v.engine_displacement }));
  }

  // De la ciudad de matrícula dependen los impuestos y el costo del
  // traspaso: es de las primeras preguntas de cualquier comprador.
  if (v.plate_city) {
    lines.push(t('plateCity', { value: v.plate_city }));
  }

  lines.push(t('soat', { value: formatDocDate(v.soat_expires_at, t) }));
  lines.push(
    t('tecno', { value: formatDocDate(v.tecnomecanica_expires_at, t) })
  );

  lines.push(
    t('salePrice', { value: formatPrice(v.price, account.default_currency) })
  );
  if (v.warranty_price != null) {
    lines.push(
      t('warrantyPrice', {
        value: formatPrice(v.warranty_price, account.default_currency),
      })
    );
  }

  // Cierre comercial: lo mismo en toda publicación, y por eso vive en el
  // catálogo y no acá.
  lines.push(t('separator'));
  lines.push(t('financing'));
  if (account.public_address) {
    lines.push(account.public_address);
  }
  lines.push(t('cta'));
  lines.push(buildContactLine(account, t));

  const tail = [t('hashtags'), account.public_name].filter(Boolean).join(' ');
  lines.push(tail);

  return lines.join('\n').trim();
}

/**
 * Fecha de vencimiento como la escribe el negocio: `26 NOV 2026`.
 *
 * Se parte la cadena ISO en vez de construir un `Date`: un
 * `new Date('2026-11-26')` es medianoche UTC, y formatearlo en un huso
 * al oeste devuelve el día anterior. Un SOAT que vence un día antes de
 * lo que dice el papel es un problema de verdad, no un detalle.
 *
 * Los meses salen del catálogo para no clavar un idioma en un archivo
 * que no tiene ninguno.
 */
function formatDocDate(iso: string | null, t: Translator): string {
  if (!iso) return t('notAvailable');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return t('notAvailable');
  const [, year, month, day] = match;
  const months = t('monthsShort').split(',');
  const name = months[Number(month) - 1]?.trim();
  if (!name) return t('notAvailable');
  return `${day} ${name} ${year}`;
}

/**
 * La invitación a contactar.
 *
 * Sin canales configurados NO se inventa ninguno: se cae a una
 * invitación genérica. Un número equivocado en el feed es peor que no
 * tener número, porque manda al interesado a otra parte — y en este
 * sistema, además, lo manda a un teléfono que el CRM no escucha, así
 * que ese interesado no existe para nadie.
 */
function buildContactLine(account: AccountForCaption, t: Translator): string {
  const channel =
    account.public_whatsapp ?? account.public_phone ?? account.public_email;
  return channel ? t('contact', { channel }) : t('contactGeneric');
}
