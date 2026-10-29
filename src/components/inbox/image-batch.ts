/**
 * Reglas de una tanda de imágenes del composer (cambio
 * `envio-multiple-imagenes-chat`).
 *
 * Funciones puras, sin DOM ni subida: deciden qué archivos de una
 * selección, de lo soltado o de lo pegado entran a la tira, antes de
 * subir nada. Lo que sobra se descarta acá y no llega al bucket, así no
 * quedan objetos huérfanos.
 */

/** Máximo de imágenes en preparación por tanda. */
export const MAX_BATCH_IMAGES = 10;

/** Tipos de imagen que acepta el bucket `chat-media` (migración 023). */
export const BATCH_IMAGE_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
];

/** Lo mínimo de un `File` que miran las reglas; así se prueba sin DOM. */
export interface BatchCandidate {
  name: string;
  type: string;
  size: number;
}

export interface BatchSelection<T extends BatchCandidate> {
  /** Entran a la tira, en el orden recibido. */
  accepted: T[];
  /** No son una imagen admitida (p. ej. un PDF soltado junto a fotos). */
  wrongType: T[];
  /** Son imagen, pero pesan más que el límite. */
  tooLarge: T[];
  /** Válidas, pero ya no cabían en la tanda. */
  overLimit: T[];
}

/**
 * Reparte una selección entre lo que entra y lo que se descarta.
 *
 * El tope se aplica después de filtrar por tipo y peso: un PDF o una
 * foto demasiado pesada no le quitan cupo a una foto válida.
 */
export function selectBatchImages<T extends BatchCandidate>(
  files: readonly T[],
  alreadyStaged: number,
  maxBytes: number
): BatchSelection<T> {
  const result: BatchSelection<T> = {
    accepted: [],
    wrongType: [],
    tooLarge: [],
    overLimit: [],
  };
  let room = Math.max(0, MAX_BATCH_IMAGES - alreadyStaged);

  for (const file of files) {
    if (!BATCH_IMAGE_TYPES.includes(file.type)) {
      result.wrongType.push(file);
    } else if (file.size > maxBytes) {
      result.tooLarge.push(file);
    } else if (room === 0) {
      result.overLimit.push(file);
    } else {
      result.accepted.push(file);
      room -= 1;
    }
  }
  return result;
}
