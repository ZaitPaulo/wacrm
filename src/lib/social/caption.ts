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
// EL FORMATO NO ES NUESTRO: lo define el negocio en una PLANTILLA que
// edita desde Ajustes → Publicaciones (`accounts.social_post_template`,
// migración 545). La de defecto vive en el catálogo
// (`SocialPost.defaultTemplate`) y calca lo que el negocio publica a
// mano. Este archivo solo sabe interpretarla: qué vale cada variable y
// cuándo una línea no tiene nada que decir.
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
  /**
   * Plantilla propia de la cuenta. Nula o vacía = `defaultTemplate`.
   * Opcional para que un llamador que no la lee (tests, vista previa
   * sin guardar) no tenga que inventarla.
   */
  social_post_template?: string | null;
}

/** Traductor del namespace de la publicación, ya acotado por el llamador. */
type Translator = (key: string, values?: Record<string, string>) => string;

export interface BuildCaptionArgs {
  vehicle: VehicleForCaption;
  account: AccountForCaption;
  /** Namespace de la publicación (`SocialPost`). */
  t: Translator;
  /**
   * La plantilla por defecto, CRUDA (`t.raw('defaultTemplate')`).
   *
   * No se pide por `t` porque el catálogo de next-intl es ICU: un
   * `{marca}` en el mensaje se leería como un argumento sin valor y
   * rompería el formateo. La plantilla se interpreta acá, no allá.
   */
  defaultTemplate: string;
}

/**
 * Las variables que una plantilla puede citar, y ninguna más.
 *
 * Catálogo CERRADO por la misma razón que `VehicleForCaption` es
 * explícita: lo que no está acá no puede llegar al feed. Y lo usa el
 * validador de `/api/account` para rechazar una variable mal escrita al
 * guardar, en vez de publicarla tal cual como `{precio_garantia}`.
 */
export const CAPTION_VARIABLES = [
  'marca',
  'modelo',
  'año',
  'kilometraje',
  'transmision',
  'motor',
  'ciudad_placa',
  'soat',
  'tecno',
  'precio',
  'precio_sin_garantia',
  'direccion',
  'contacto',
  'nombre',
] as const;

export type CaptionVariable = (typeof CAPTION_VARIABLES)[number];

/** Nombres alternativos que se aceptan: la ñ no siempre sale del teclado. */
const ALIASES: Record<string, CaptionVariable> = { anio: 'año' };

/** Largo máximo de una plantilla propia. Instagram corta en 2200. */
export const MAX_TEMPLATE_LENGTH = 2000;

const VARIABLE_RE = /\{([^{}\s]+)\}/g;

function canonical(name: string): CaptionVariable | null {
  if ((CAPTION_VARIABLES as readonly string[]).includes(name)) {
    return name as CaptionVariable;
  }
  return ALIASES[name] ?? null;
}

/** Las variables de la plantilla que no existen, sin repetir. */
export function unknownTemplateVariables(template: string): string[] {
  const unknown = new Set<string>();
  for (const [, name] of template.matchAll(VARIABLE_RE)) {
    if (!canonical(name)) unknown.add(name);
  }
  return [...unknown];
}

/**
 * Arma el texto propuesto a partir de la plantilla de la cuenta.
 *
 * La plantilla se lee LÍNEA POR LÍNEA: si alguna variable de una línea
 * no tiene dato, la línea entera no sale. Así "PLACAS DE {ciudad_placa}"
 * desaparece cuando no hay ciudad, sin pedirle a quien edita una
 * sintaxis de condicionales: una línea "Kilometraje: —" en el feed del
 * cliente se lee como descuido, no como información faltante. Las
 * líneas sin variables salen siempre, tal cual.
 *
 * `{soat}` y `{tecno}` NUNCA quedan vacías: valen "NA" cuando falta la
 * fecha, porque así lo publica el negocio —ahí el vacío es la
 * respuesta, no un olvido—. `{contacto}` tampoco: sin canales cae a la
 * invitación genérica.
 */
export function buildVehicleCaption(args: BuildCaptionArgs): string {
  const { account, defaultTemplate } = args;
  const values = captionValues(args);

  const template = account.social_post_template?.trim()
    ? account.social_post_template
    : defaultTemplate;

  const lines: string[] = [];
  for (const line of template.split(/\r?\n/)) {
    let missing = false;
    const rendered = line.replace(VARIABLE_RE, (whole, name: string) => {
      const key = canonical(name);
      // Una variable desconocida se deja tal cual: el validador ya no
      // deja guardarla, y si llegara igual es mejor verla en la cola
      // que perder la línea en silencio.
      if (!key) return whole;
      const value = values[key];
      if (!value) missing = true;
      return value;
    });
    if (!missing) lines.push(rendered.trimEnd());
  }

  return lines.join('\n').trim();
}

/** Lo que vale cada variable para este vehículo. `''` = sin dato. */
function captionValues(
  args: BuildCaptionArgs
): Record<CaptionVariable, string> {
  const { vehicle: v, account, t } = args;
  const currency = account.default_currency;
  return {
    marca: v.brand,
    modelo: v.model,
    año: String(v.year),
    kilometraje: v.mileage != null ? formatNumber(v.mileage) : '',
    // `other` no se traduce a nada que informe, así que no ocupa línea.
    transmision:
      v.transmission && v.transmission !== 'other'
        ? t(`transmission.${v.transmission}`)
        : '',
    motor: v.engine_displacement ?? '',
    // Ciudad de matrícula: de ella dependen impuestos y traspaso.
    ciudad_placa: v.plate_city ?? '',
    soat: formatDocDate(v.soat_expires_at, t),
    tecno: formatDocDate(v.tecnomecanica_expires_at, t),
    // El negocio publica el precio CON garantía. Sin él cargado se cae
    // al de venta: un vehículo sin precio en el feed no vende.
    precio: formatPrice(v.warranty_price ?? v.price, currency),
    precio_sin_garantia: formatPrice(v.price, currency),
    direccion: account.public_address ?? '',
    contacto: buildContactLine(account, t),
    nombre: account.public_name ?? '',
  };
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
