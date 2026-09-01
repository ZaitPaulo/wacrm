// ============================================================
// Todo lo que depende de la política de Facebook, en un solo lugar.
//
// Mismo criterio que `instagram/limits.ts`: solo NÚMEROS de esta red.
// La mecánica que los usa vive en `src/lib/social/limits.ts`.
//
// Verificado contra la documentación vigente el 2026-09-01:
// https://developers.facebook.com/docs/graph-api/reference/page/photos/
// https://developers.facebook.com/docs/graph-api/reference/page/feed/
//
// LO IMPORTANTE DE ESA VERIFICACIÓN ES LO QUE NO DICE. A diferencia de
// Instagram, que publica sus topes, la referencia de páginas no
// documenta ni un máximo de caracteres ni un máximo de fotos por
// entrada. Los valores de acá son NUESTROS, no de Meta, y por eso se
// eligen del lado seguro: pasarse los descubre Meta con un rechazo, que
// queda como fallo de contenido con su motivo.
// ============================================================

import type { NetworkLimits } from '../limits';

/**
 * Máximo de fotos en una entrada.
 *
 * Meta no lo documenta. Se toma el mismo que Instagram a propósito: no
 * hay razón para que un vehículo se recorte distinto en cada red cuando
 * ninguna de las dos publica el número, y un valor más alto solo
 * serviría para descubrir el tope real por un rechazo — que en esta red
 * llega DESPUÉS de haber subido las fotos, no antes.
 *
 * Si algún día Facebook documenta el suyo, este es el único lugar que
 * hay que tocar.
 */
export const MAX_ATTACHED_PHOTOS = 10;

/**
 * Máximo de caracteres del texto de la entrada.
 *
 * Es el tope histórico del cuerpo de una publicación de Facebook, y es
 * casi treinta veces el de Instagram: en la práctica ningún texto
 * armado desde una ficha de vehículo se le acerca. Está igual porque
 * `validateCaption` necesita un número, no porque sea una restricción
 * real de este caso de uso.
 */
export const MESSAGE_MAX_CHARS = 63_206;

/**
 * Facebook NO limita las etiquetas, y por eso acá va `null`.
 *
 * No es un detalle: aplicarle el tope de 30 de Instagram rechazaría al
 * guardar un texto que en Facebook se publica sin problema. Es
 * exactamente el caso que motivó separar los límites por red.
 */
export const FACEBOOK_LIMITS: NetworkLimits = {
  maxImages: MAX_ATTACHED_PHOTOS,
  captionMaxChars: MESSAGE_MAX_CHARS,
  maxHashtags: null,
};
