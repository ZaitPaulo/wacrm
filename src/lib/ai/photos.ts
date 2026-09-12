import sharp from 'sharp'
import type { SupabaseClient } from '@supabase/supabase-js'
import { downloadMedia, getMediaUrl } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { aiVisionDownloadTimeoutMs, aiVisionMaxImages } from './defaults'
import type { ChatImage, ChatMessage } from './types'

// ============================================================
// Las fotos del cliente, como imagen para el modelo.
//
// El modelo antes solo leia texto: una captura de un carro publicado
// llegaba, a lo sumo, como su pie de foto. Aqui se eligen las fotos que
// el cliente mando desde nuestra ultima respuesta, se bajan de Meta —no
// se guardan en ningun lado nuestro— y se reducen antes de mandarlas.
//
// NADA DE ESTO LANZA. Una foto que no se puede usar se descarta y la
// respuesta sale igual con el texto: la alternativa es el traspaso por
// "fallo del proveedor", que es justo lo que motivo este modulo.
// ============================================================

/**
 * Lado maximo de la foto que recibe el modelo.
 *
 * Lo tipico es la captura vertical de un celular con el precio y el
 * kilometraje en letra chica; a 768 px de alto ese texto deja de leerse.
 * 1536 deja la captura en ~692×1536 —dos bloques de Gemini, 516 tokens—
 * y queda bajo los 1568 px a partir de los cuales Anthropic reescala.
 */
const VISION_MAX_SIDE_PX = 1536

/** Suficiente para que el texto de una captura siga nitido. */
const VISION_JPEG_QUALITY = 80

/**
 * Cuantos mensajes recientes se miran para encontrar las fotos nuevas.
 * Solo importan los posteriores a nuestra ultima respuesta, que en una
 * conversacion de WhatsApp son un punado.
 */
const PHOTO_SCAN_LIMIT = 30

/** `media_url` de una foto entrante: el proxy que la baja de Meta. */
const WHATSAPP_MEDIA_PROXY = /^\/api\/whatsapp\/media\/([^/?#]+)$/

/** Una fila de la busqueda de fotos nuevas. */
export interface PhotoScanRow {
  id: string
  sender_type: 'customer' | 'agent' | 'bot'
  content_type: string
  status: string | null
  media_url: string | null
}

/**
 * Lo que se sabe de las fotos nuevas. `count` son las que habia, aunque
 * no se hayan podido bajar: una foto sola que fallo sigue siendo un
 * mensaje del cliente, y el modelo tiene que saber que existio.
 */
export interface NewPhotos {
  count: number
  images: ChatImage[]
}

const NO_PHOTOS: NewPhotos = { count: 0, images: [] }

/**
 * Las fotos del cliente posteriores a nuestra ultima respuesta, las mas
 * recientes hasta `max`, devueltas en orden de lectura (la mas vieja
 * primero).
 *
 * `rowsNewestFirst` viene ordenado por `created_at` y luego `id`,
 * descendente — el mismo orden total con que `hasOutboundSince` decide
 * que va antes de que. "Nuestra ultima respuesta" es cualquier mensaje
 * del negocio que no fallo: uno fallido nunca le llego al cliente, y las
 * fotos de antes siguen sin respuesta.
 */
export function pickNewCustomerPhotos(
  rowsNewestFirst: PhotoScanRow[],
  max: number,
): PhotoScanRow[] {
  if (max <= 0) return []
  const picked: PhotoScanRow[] = []
  for (const row of rowsNewestFirst) {
    if (row.sender_type !== 'customer') {
      if (row.status !== 'failed') break
      continue
    }
    if (row.content_type === 'image') {
      picked.push(row)
      if (picked.length === max) break
    }
  }
  return picked.reverse()
}

/**
 * Baja las fotos de Meta y las deja listas para el modelo, en el mismo
 * orden. Cada foto que falla —URL que no es del proxy, error de Meta,
 * tiempo agotado, sticker— simplemente no aparece.
 */
export async function downloadPhotos(args: {
  db: SupabaseClient
  accountId: string
  photos: PhotoScanRow[]
  timeoutMs: number
}): Promise<ChatImage[]> {
  const { db, accountId, photos, timeoutMs } = args

  const mediaIds = photos.map((p) => p.media_url?.match(WHATSAPP_MEDIA_PROXY)?.[1] ?? null)
  if (!mediaIds.some(Boolean)) return []

  const accessToken = await whatsappAccessToken(db, accountId)
  if (!accessToken) return []

  const images = await Promise.all(
    mediaIds.map((mediaId) =>
      mediaId
        ? fetchPhoto(mediaId, accessToken, timeoutMs).catch((err) => {
            console.warn(
              `[ai photos] media ${mediaId} skipped:`,
              err instanceof Error ? err.message : err,
            )
            return null
          })
        : null,
    ),
  )
  return images.filter((img): img is ChatImage => img !== null)
}

/**
 * Las fotos nuevas del cliente, bajadas y reducidas. Nunca lanza: ante
 * cualquier fallo devuelve lo que alcanzo a tener.
 *
 * Con `AI_VISION_MAX_IMAGES=0` ni siquiera consulta la base.
 */
export async function loadNewCustomerPhotos(
  db: SupabaseClient,
  args: { accountId: string; conversationId: string },
): Promise<NewPhotos> {
  const max = aiVisionMaxImages()
  if (max === 0) return NO_PHOTOS

  try {
    const { data, error } = await db
      .from('messages')
      .select('id, sender_type, content_type, status, media_url')
      .eq('conversation_id', args.conversationId)
      .order('created_at', { ascending: false })
      // WhatsApp da segundos: dos mensajes de una rafaga comparten
      // `created_at`, y el id es lo que los ordena sin empate.
      .order('id', { ascending: false })
      .limit(PHOTO_SCAN_LIMIT)
    if (error) throw error

    const photos = pickNewCustomerPhotos((data ?? []) as PhotoScanRow[], max)
    if (photos.length === 0) return NO_PHOTOS

    const images = await downloadPhotos({
      db,
      accountId: args.accountId,
      photos,
      timeoutMs: aiVisionDownloadTimeoutMs(),
    })
    return { count: photos.length, images }
  } catch (err) {
    console.warn('[ai photos] could not load the customer photos:', err)
    return NO_PHOTOS
  }
}

/**
 * Pega las fotos nuevas a la conversacion que recibe el modelo.
 *
 * Todo lo que llego despues de nuestra ultima respuesta forma el ultimo
 * turno del cliente, asi que ahi van. Una foto con pie ya esta en el
 * texto como `[Foto] …`; una foto sola no aparece en el texto y la
 * conversacion termina en un turno nuestro, asi que se agrega el del
 * cliente. Si la foto no se pudo bajar, el turno `[Foto]` va igual, sin
 * imagen: el modelo sabe que hubo una foto y pregunta en vez de suponer.
 */
export function attachPhotos(messages: ChatMessage[], photos: NewPhotos): ChatMessage[] {
  if (photos.count === 0) return messages

  const out = messages.map((m) => ({ ...m }))
  const last = out.at(-1)
  if (last?.role === 'user') {
    if (photos.images.length) last.images = [...(last.images ?? []), ...photos.images]
    return out
  }

  const turn: ChatMessage = { role: 'user', content: '[Foto]' }
  if (photos.images.length) turn.images = [...photos.images]
  out.push(turn)
  return out
}

/** El token de WhatsApp de la cuenta, descifrado; null si no se puede. */
async function whatsappAccessToken(
  db: SupabaseClient,
  accountId: string,
): Promise<string | null> {
  try {
    const { data, error } = await db
      .from('whatsapp_config')
      .select('access_token')
      .eq('account_id', accountId)
      .maybeSingle()
    const encrypted = (data as { access_token?: string } | null)?.access_token
    if (error || !encrypted) return null
    return decrypt(encrypted)
  } catch (err) {
    console.warn('[ai photos] WhatsApp token unavailable:', err)
    return null
  }
}

/**
 * Una foto, de Meta al formato del modelo. Devuelve null para un
 * sticker; lanza en cualquier otro fallo (quien llama lo descarta).
 */
async function fetchPhoto(
  mediaId: string,
  accessToken: string,
  timeoutMs: number,
): Promise<ChatImage | null> {
  const { buffer, mimeTypes } = await withTimeout(
    (async () => {
      const info = await getMediaUrl({ mediaId, accessToken })
      const media = await downloadMedia({ downloadUrl: info.url, accessToken })
      return { buffer: media.buffer, mimeTypes: [info.mimeType, media.contentType] }
    })(),
    timeoutMs,
    `foto ${mediaId}`,
  )

  // La base guarda los stickers como `image` y no conserva el MIME, asi
  // que se reconocen aqui: WhatsApp los manda en webp y las fotos en
  // JPEG. Una foto real en webp se perderia, y degrada a la etiqueta.
  if (mimeTypes.some((t) => t?.toLowerCase().startsWith('image/webp'))) return null

  const jpeg = await sharp(buffer)
    // Aplica la orientacion EXIF: el modelo no recibe metadatos, y una
    // foto de celular tomada en vertical llegaria acostada.
    .rotate()
    .resize({
      width: VISION_MAX_SIDE_PX,
      height: VISION_MAX_SIDE_PX,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: VISION_JPEG_QUALITY })
    .toBuffer()

  return { mimeType: 'image/jpeg', base64: jpeg.toString('base64') }
}

/**
 * Rechaza si la promesa no resuelve a tiempo; el temporizador se limpia.
 * La peticion de fondo no se aborta —`meta-api` no recibe senal—, solo
 * se deja de esperar.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: se agotaron ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
