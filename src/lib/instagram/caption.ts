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
// ============================================================

import { formatNumber, formatPrice } from '@/lib/showcase/format';
import {
  BODY_TYPES,
  CONDITIONS,
  FUEL_TYPES,
  TRANSMISSIONS,
  labelOf,
} from '@/lib/inventory/specs';

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
  mileage: number | null;
  transmission: string | null;
  fuel_type: string | null;
  body_type: string | null;
  condition: string | null;
  engine_displacement: string | null;
  /** Ciudad de MATRÍCULA, no dónde está parqueado (migración 511). */
  plate_city: string | null;
  accepts_trade_in: boolean;
}

/** Los datos públicos del negocio que la publicación puede citar. */
export interface AccountForCaption {
  default_currency: string;
  public_whatsapp: string | null;
  public_phone: string | null;
  public_email: string | null;
}

/** Traductor del namespace de la publicación, ya acotado por el llamador. */
type Translator = (key: string, values?: Record<string, string>) => string;

/**
 * Traductor para las etiquetas de especificaciones, que viven en el
 * namespace `Inventory` y no en el de la publicación.
 */
type SpecTranslator = (key: string) => string;

export interface BuildCaptionArgs {
  vehicle: VehicleForCaption;
  account: AccountForCaption;
  /** Namespace de la publicación (`InstagramPost`). */
  t: Translator;
  /** Namespace `Inventory`, para las etiquetas de la ficha técnica. */
  tSpecs: SpecTranslator;
}

/**
 * Arma el texto propuesto.
 *
 * Los datos ausentes SE OMITEN, no se rellenan: una línea
 * "Kilometraje: —" en el feed del cliente se lee como descuido, no como
 * información faltante.
 */
export function buildVehicleCaption(args: BuildCaptionArgs): string {
  const { vehicle: v, account, t, tSpecs } = args;

  const lines: string[] = [];

  // Encabezado: lo que alguien lee antes de decidir si sigue leyendo.
  lines.push(`${v.brand} ${v.model} ${v.year}`);
  lines.push('');
  lines.push(
    t('price', { value: formatPrice(v.price, account.default_currency) })
  );

  if (v.mileage != null) {
    lines.push(t('mileage', { value: formatNumber(v.mileage) }));
  }

  // Ficha técnica: una línea por dato presente, en el orden en que
  // suele preguntarse.
  const specs: string[] = [];
  if (v.transmission) {
    specs.push(labelOf(tSpecs, TRANSMISSIONS, v.transmission));
  }
  if (v.fuel_type) {
    specs.push(labelOf(tSpecs, FUEL_TYPES, v.fuel_type));
  }
  if (v.body_type) {
    specs.push(labelOf(tSpecs, BODY_TYPES, v.body_type));
  }
  if (v.condition) {
    specs.push(labelOf(tSpecs, CONDITIONS, v.condition));
  }
  if (v.engine_displacement) {
    specs.push(v.engine_displacement);
  }
  if (specs.length > 0) {
    lines.push(specs.join(' · '));
  }

  // De la ciudad de matrícula dependen los impuestos y el costo del
  // traspaso: es de las primeras preguntas de cualquier comprador.
  if (v.plate_city) {
    lines.push(t('plateCity', { value: v.plate_city }));
  }

  if (v.accepts_trade_in) {
    lines.push(t('acceptsTradeIn'));
  }

  lines.push('');
  lines.push(buildContactLine(account, t));

  return lines.join('\n').trim();
}

/**
 * La invitación a contactar.
 *
 * Sin canales configurados NO se inventa ninguno: se cae a una
 * invitación genérica. Un número equivocado en el feed es peor que no
 * tener número, porque manda al interesado a otra parte.
 */
function buildContactLine(account: AccountForCaption, t: Translator): string {
  const channel =
    account.public_whatsapp ?? account.public_phone ?? account.public_email;
  return channel ? t('contact', { channel }) : t('contactGeneric');
}
