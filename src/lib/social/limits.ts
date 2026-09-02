// ============================================================
// Los límites de una red, y la validación que se apoya en ellos.
//
// Acá vive la MECÁNICA —contar etiquetas, medir el texto, reconocer una
// foto que ya está en formato publicable—. Los NÚMEROS viven en cada
// red, porque los fija Meta por separado para cada una y los cambia sin
// avisar: `instagram/limits.ts`, `facebook/limits.ts`.
//
// La separación importa por un caso concreto: el tope de caracteres de
// Instagram no es el de Facebook, y advertirle a quien escribe el texto
// de Facebook por un límite que en su destino no existe le impide
// publicar algo perfectamente válido.
// ============================================================

/**
 * Lo que una red admite en una publicación.
 *
 * `maxHashtags` es `null` cuando la red no pone un tope: entonces no se
 * valida, en vez de inventarle uno. Es el mismo criterio con que no se
 * supone un tope de publicaciones donde la red no lo informa.
 */
export interface NetworkLimits {
  /** Máximo de imágenes en una publicación. Las de más se descartan. */
  maxImages: number;
  /** Máximo de caracteres del texto. */
  captionMaxChars: number;
  /** Máximo de etiquetas (#), o `null` si la red no limita. */
  maxHashtags: number | null;
}

/**
 * El formato de imagen al que se convierte antes de publicar.
 *
 * Instagram no publica otra cosa; Facebook acepta más, pero se
 * convierte igual para que las dos redes compartan la misma copia (ver
 * decisión 9 del design). El bucket `showcase-media` acepta además PNG
 * y WebP (migración 506), así que la conversión no es opcional.
 */
export const PUBLISHABLE_IMAGE_MIME = 'image/jpeg';

/** Extensiones que ya están en el formato publicable. */
const JPEG_EXTENSIONS = ['.jpg', '.jpeg'];

/**
 * True si la URL apunta a algo que ya se puede publicar tal cual.
 *
 * Se decide por la extensión y no por el `Content-Type` real: la
 * comprobación corre sobre URLs del bucket, donde la extensión la puso
 * el uploader a partir del MIME validado, y evita una petición de red
 * por foto solo para clasificar. Un falso negativo cuesta una
 * conversión de más; un falso positivo lo atrapa la red al publicar.
 */
export function isPublishableImageUrl(url: string): boolean {
  const path = url.split('?')[0].toLowerCase();
  return JPEG_EXTENSIONS.some((ext) => path.endsWith(ext));
}

/** Cuenta las etiquetas de un texto, para validar contra el tope. */
export function countHashtags(caption: string): number {
  return (caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
}

export type CaptionProblem = 'too_long' | 'too_many_hashtags';

/**
 * Valida el texto contra los límites de la red a la que va.
 *
 * Se usa al EDITAR, no al publicar: descubrir el exceso por el rechazo
 * de la red desperdicia una aprobación, que es un recurso escaso cuando
 * hay un tope por periodo de por medio.
 *
 * Devuelve `null` cuando el texto está bien.
 *
 * @param limits Los de la red de esa publicación, nunca los de otra.
 */
export function validateCaption(
  caption: string,
  limits: NetworkLimits
): CaptionProblem | null {
  // [...caption] cuenta puntos de código, no unidades UTF-16: un emoji
  // fuera del plano básico vale 1 y no 2, que es como lo cuenta Meta.
  if ([...caption].length > limits.captionMaxChars) return 'too_long';
  if (limits.maxHashtags !== null && countHashtags(caption) > limits.maxHashtags) {
    return 'too_many_hashtags';
  }
  return null;
}

/**
 * El límite más estricto de un conjunto de redes.
 *
 * Existe porque la cola publica en varias redes con UN SOLO texto: un
 * texto que una de ellas rechazaría no sirve para ese botón, y
 * descubrirlo al publicar desperdicia la aprobación.
 *
 * `maxHashtags` se queda con el tope más bajo de los que existen, y en
 * `null` solo si NINGUNA red limita: basta con que una lo haga para que
 * el texto compartido tenga que respetarlo.
 *
 * Con una sola red devuelve la suya, así que una red de límites amplios
 * no arrastra los de otra que ya no interviene.
 */
export function strictestLimits(limits: NetworkLimits[]): NetworkLimits | null {
  if (limits.length === 0) return null;

  return limits.reduce((a, b) => ({
    maxImages: Math.min(a.maxImages, b.maxImages),
    captionMaxChars: Math.min(a.captionMaxChars, b.captionMaxChars),
    maxHashtags:
      a.maxHashtags === null
        ? b.maxHashtags
        : b.maxHashtags === null
          ? a.maxHashtags
          : Math.min(a.maxHashtags, b.maxHashtags),
  }));
}
