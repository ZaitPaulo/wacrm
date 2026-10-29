import type { Message } from '@/types'

/**
 * Burbujas optimistas del hilo: id temporal y reemplazo por la fila real.
 *
 * Al enviar, el hilo pinta de una vez una burbuja con id `temp-…` y la
 * cambia por la fila de la base cuando esta llega por realtime.
 *
 * POR QUÉ NO SE BORRAN TODAS LAS `temp-` DE UNA VEZ
 *
 * Antes, cualquier INSERT de la conversación borraba todas las burbujas
 * temporales. Con un mensaje a la vez daba igual, pero con una tanda de
 * fotos enviadas en secuencia (cambio `envio-multiple-imagenes-chat`),
 * la fila real de la foto 1 hacía desaparecer la burbuja de la foto 2,
 * que seguía en vuelo, y también se borraba cualquier burbuja marcada
 * como fallida, que es justo la que el asesor tiene que ver. Ahora se
 * reemplaza solo la que corresponde a la fila que llegó.
 */

/** Prefijo de los ids de burbujas que aún no tienen fila en la base. */
export const OPTIMISTIC_ID_PREFIX = 'temp-'

/**
 * Id temporal único. `Date.now()` solo no alcanza: en una tanda pueden
 * crearse dos burbujas en el mismo milisegundo, y entonces el "enviado"
 * o "falló" de una se aplicaba a la otra.
 */
export function newOptimisticId(): string {
  return `${OPTIMISTIC_ID_PREFIX}${crypto.randomUUID()}`
}

export function isOptimisticId(id: string): boolean {
  return id.startsWith(OPTIMISTIC_ID_PREFIX)
}

/**
 * Agrega al hilo una fila que llegó por realtime y quita la burbuja
 * optimista que le corresponde, si la hay.
 *
 * Solo una fila del asesor puede reemplazar una burbuja optimista: un
 * mensaje del cliente o del bot que llega mientras tanto no toca nada.
 * Las fallidas nunca se reemplazan, porque su envío no produjo fila. El
 * emparejamiento busca, en orden:
 *   1. la burbuja con la misma `media_url` (un adjunto es inequívoco);
 *   2. la más antigua con el mismo `content_type`;
 *   3. la más antigua de todas, para que un desajuste de tipo no deje la
 *      burbuja duplicada para siempre.
 */
export function mergeIncomingMessage(prev: Message[], incoming: Message): Message[] {
  if (prev.some((m) => m.id === incoming.id)) return prev

  if (incoming.sender_type !== 'agent') return [...prev, incoming]

  const candidates = prev.filter((m) => isOptimisticId(m.id) && m.status !== 'failed')
  const match =
    (incoming.media_url
      ? candidates.find((m) => m.media_url === incoming.media_url)
      : undefined) ??
    candidates.find((m) => m.content_type === incoming.content_type) ??
    candidates[0]

  const rest = match ? prev.filter((m) => m !== match) : prev
  return [...rest, incoming]
}
