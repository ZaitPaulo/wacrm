/**
 * A quién se le manda un mensaje de WhatsApp, y en qué campo va.
 *
 * Meta admite dos formas de nombrar al destinatario y NO son
 * intercambiables:
 *
 *   `to`         el teléfono, solo dígitos. Lo de siempre.
 *   `recipient`  un BSUID — identificador con alcance de negocio, con
 *                la forma `CO.4481978948757066`. Es la única forma de
 *                alcanzar a quien adoptó un nombre de usuario, porque
 *                de esa persona no recibimos el número.
 *
 * Mandar un BSUID en `to` no funciona, y mandar los dos tampoco.
 *
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/
 */

/**
 * ¿Este destinatario es un teléfono?
 *
 * Los dos formatos son inequívocos: un teléfono normalizado es solo
 * dígitos, y un BSUID lleva el punto separando el código de país. Todo
 * lo que llega a las funciones de envío pasa antes por
 * `sanitizePhoneForMeta`, así que un número no puede traer signos que
 * lo hagan pasar por BSUID.
 */
export function isPhoneRecipient(recipient: string): boolean {
  return /^\d+$/.test(recipient);
}

/**
 * El campo del payload que le corresponde a este destinatario.
 *
 * Existe para que la decisión se tome UNA vez. Las siete funciones de
 * envío de `meta-api.ts` arman su propio cuerpo, y resolverlo dentro de
 * cada una serían siete oportunidades de olvidarse en la octava — la
 * que alguien agregue dentro de seis meses.
 */
export function recipientField(
  recipient: string
): { to: string } | { recipient: string } {
  return isPhoneRecipient(recipient) ? { to: recipient } : { recipient };
}
