/**
 * Cliente de publicación de Instagram (Graph API).
 *
 * Cada función recibe un único objeto de opciones (parámetros con
 * nombre) en vez de argumentos posicionales, por la misma razón que
 * `src/lib/whatsapp/meta-api.ts`: con `(igUserId, accessToken)` los
 * intercambios pasan la compilación y fallan recién contra Meta.
 *
 * El HOST NO ES EL DE WHATSAPP. La conexión usa Instagram Login
 * (decisión 13 del design), cuyo host es `graph.instagram.com` —
 * `graph.facebook.com` es el del camino con Facebook Login, que
 * rechazaría estos tokens.
 */

import {
  InstagramError,
  contentError,
  instagramErrorFromResponse,
  unansweredError,
  type InstagramStep,
} from './errors';
import { MAX_CAROUSEL_ITEMS } from './limits';

const IG_API_VERSION = 'v25.0';
const IG_API_BASE = `https://graph.instagram.com/${IG_API_VERSION}`;

interface IgAuthArgs {
  /** El <IG_ID> de la cuenta profesional. */
  igUserId: string;
  /** Token ya descifrado. Nunca se registra ni se devuelve. */
  accessToken: string;
}

/**
 * POST a la Graph API con el cuerpo como JSON.
 *
 * Todo error sale como `InstagramError` ya clasificado en credenciales
 * o contenido: quien llama nunca tiene que interpretar códigos de Meta.
 */
async function igPost<T>(
  path: string,
  accessToken: string,
  body: Record<string, string>,
  step: InstagramStep = 'other'
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${IG_API_BASE}/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    // La petición se fue y no volvió nada. En `media_publish` esto es
    // el caso que no se puede resolver solo: pudo haberse publicado.
    throw unansweredError(`Instagram no respondió (${step})`, step);
  }
  if (!response.ok) {
    throw await instagramErrorFromResponse(
      response,
      `Instagram API error: ${response.status}`,
      step
    );
  }
  return response.json() as Promise<T>;
}

async function igGet<T>(path: string, accessToken: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${IG_API_BASE}/${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    // Una lectura fallida no deja nada a medias: se reintenta sin riesgo.
    throw unansweredError('Instagram no respondió', 'other');
  }
  if (!response.ok) {
    throw await instagramErrorFromResponse(
      response,
      `Instagram API error: ${response.status}`
    );
  }
  return response.json() as Promise<T>;
}

// ============================================================
// Verificación de la cuenta
// ============================================================

export interface InstagramAccountInfo {
  id: string;
  username: string | null;
  accountType: string | null;
}

interface MeResponse {
  user_id?: string;
  id?: string;
  username?: string;
  account_type?: string;
}

/**
 * Datos públicos de la cuenta detrás de un token. Se usa al conectar,
 * para saber a qué cuenta quedó vinculado y para rechazar una cuenta
 * que no sirve antes de guardarla.
 */
export async function getAccountInfo(args: {
  accessToken: string;
}): Promise<InstagramAccountInfo> {
  const data = await igGet<MeResponse>(
    'me?fields=user_id,username,account_type',
    args.accessToken
  );
  const id = data.user_id ?? data.id;
  if (!id) {
    throw contentError('Instagram no devolvió el identificador de la cuenta');
  }
  return {
    id,
    username: data.username ?? null,
    accountType: data.account_type ?? null,
  };
}

/**
 * True si la cuenta puede publicar por API.
 *
 * Se rechaza solo lo que Instagram declara personal, en vez de exigir
 * una lista blanca de tipos: Meta ha renombrado estos valores más de
 * una vez, y una lista blanca convertiría cada renombre en "tu cuenta
 * no sirve" para cuentas que sí sirven. Si el campo no viene, se deja
 * pasar y que Meta rechace al publicar, con su propio mensaje.
 */
export function isPublishableAccountType(accountType: string | null): boolean {
  if (!accountType) return true;
  return accountType.toUpperCase() !== 'PERSONAL';
}

// ============================================================
// Publicación — dos pasos: contenedor y publicación
// ============================================================

interface ContainerResponse {
  id?: string;
}

/**
 * Crea el contenedor de UNA imagen.
 *
 * `isCarouselItem` distingue las dos formas de usarlo: como hijo de un
 * carrusel (sin texto propio, el texto va en el padre) o como
 * publicación de imagen suelta.
 */
export async function createImageContainer(
  args: IgAuthArgs & {
    imageUrl: string;
    caption?: string;
    isCarouselItem?: boolean;
  }
): Promise<string> {
  const { igUserId, accessToken, imageUrl, caption, isCarouselItem } = args;

  const body: Record<string, string> = { image_url: imageUrl };
  if (isCarouselItem) body.is_carousel_item = 'true';
  // Un hijo de carrusel no lleva texto: el de la publicación vive en el
  // contenedor padre, y mandarlo dos veces no lo duplica pero confunde.
  else if (caption) body.caption = caption;

  const data = await igPost<ContainerResponse>(
    `${igUserId}/media`,
    accessToken,
    body,
    'container'
  );
  if (!data.id) {
    throw contentError('Instagram no devolvió el contenedor de la imagen');
  }
  return data.id;
}

/**
 * Crea el contenedor padre que agrupa a los hijos ya creados.
 *
 * Instagram recorta todo el carrusel según la PRIMERA imagen, así que
 * el orden de `childrenIds` no es cosmético: define el encuadre de las
 * demás.
 */
export async function createCarouselContainer(
  args: IgAuthArgs & { childrenIds: string[]; caption: string }
): Promise<string> {
  const { igUserId, accessToken, childrenIds, caption } = args;

  if (childrenIds.length === 0) {
    throw contentError('Un carrusel necesita al menos una imagen');
  }
  if (childrenIds.length > MAX_CAROUSEL_ITEMS) {
    throw contentError(
      `Un carrusel admite hasta ${MAX_CAROUSEL_ITEMS} imágenes`
    );
  }

  const data = await igPost<ContainerResponse>(
    `${igUserId}/media`,
    accessToken,
    {
      media_type: 'CAROUSEL',
      children: childrenIds.join(','),
      caption,
    },
    'container'
  );
  if (!data.id) {
    throw contentError('Instagram no devolvió el contenedor del carrusel');
  }
  return data.id;
}

/**
 * Cada cuánto se le pregunta a Instagram si ya terminó de procesar.
 *
 * Meta sugiere una consulta por minuto durante cinco minutos, pero esa
 * cadencia está pensada para vídeo: acá solo hay fotos, que terminan en
 * segundos, y del otro lado hay una persona esperando a que su clic
 * haga algo. Tres segundos la deja publicar enseguida sin acercarse al
 * límite de peticiones por token.
 */
const CONTAINER_POLL_INTERVAL_MS = 3_000;

/**
 * Cuánto se espera en total antes de rendirse.
 *
 * Rendirse NO es un fallo definitivo: el contenedor sigue vivo del lado
 * de Meta y la publicación se reintenta. Es preferible a dejar colgada
 * la petición del navegador varios minutos.
 */
const CONTAINER_READY_TIMEOUT_MS = 90_000;

interface ContainerStatusResponse {
  status_code?: string;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Espera a que un contenedor esté listo para publicarse.
 *
 * Instagram devuelve el id del contenedor ANTES de haberlo procesado, y
 * publicar uno a medio hacer se rechaza con "Media ID is not available"
 * —un mensaje que además viene marcado como OAuthException, así que sin
 * esto el sistema culpaba a las credenciales de un problema de tiempo.
 *
 * Los estados los define Meta: FINISHED, IN_PROGRESS, ERROR, EXPIRED y
 * PUBLISHED. Solo IN_PROGRESS justifica volver a preguntar.
 */
export async function waitForContainerReady(
  args: IgAuthArgs & {
    containerId: string;
    intervalMs?: number;
    timeoutMs?: number;
  }
): Promise<void> {
  const {
    accessToken,
    containerId,
    intervalMs = CONTAINER_POLL_INTERVAL_MS,
    timeoutMs = CONTAINER_READY_TIMEOUT_MS,
  } = args;

  const deadline = Date.now() + timeoutMs;

  // Siempre se pregunta al menos una vez: una foto suele estar lista de
  // entrada, y así el caso normal no paga ninguna espera.
  for (;;) {
    const data = await igGet<ContainerStatusResponse>(
      `${containerId}?fields=status_code`,
      accessToken
    );
    const status = data.status_code;

    // Un estado que no reconocemos se deja pasar en vez de bloquear la
    // publicación: Meta ha renombrado sus valores antes, y plantarse
    // sería convertir un renombre en "no se puede publicar nunca".
    if (status !== 'IN_PROGRESS') {
      if (status === 'ERROR') {
        throw contentError(
          'Instagram no pudo procesar las fotos de esta publicación'
        );
      }
      if (status === 'EXPIRED') {
        throw contentError(
          'Instagram descartó la publicación por antigüedad; hay que rearmarla'
        );
      }
      return;
    }

    if (Date.now() + intervalMs >= deadline) {
      throw contentError(
        'Instagram sigue procesando las fotos; reintenta en un momento'
      );
    }
    await sleep(intervalMs);
  }
}

/**
 * Publica un contenedor ya creado. Devuelve el id de la publicación,
 * que es la ÚNICA prueba de que esto salió: se guarda siempre, y ante
 * una respuesta perdida se compara contra Instagram en vez de
 * reintentar.
 */
export async function publishContainer(
  args: IgAuthArgs & { creationId: string }
): Promise<string> {
  const { igUserId, accessToken, creationId } = args;
  const data = await igPost<ContainerResponse>(
    `${igUserId}/media_publish`,
    accessToken,
    { creation_id: creationId },
    'publish'
  );
  if (!data.id) {
    throw contentError(
      'Instagram no devolvió el identificador de la publicación'
    );
  }
  return data.id;
}

/**
 * El flujo completo, de las imágenes a la publicación viva.
 *
 * Una sola imagen NO va como carrusel de un elemento: Instagram trata
 * el carrusel como formato de varios y un contenedor padre con un solo
 * hijo es un rechazo esperando. Con una foto se publica la imagen
 * suelta, que además se ve mejor en el feed.
 *
 * Devuelve el id de la publicación. Todo lo que puede fallar sale como
 * `InstagramError` clasificado; quien llama decide qué hacer con la
 * fila de la cola según `kind`.
 */
export async function publishImagePost(
  args: IgAuthArgs & {
    imageUrls: string[];
    caption: string;
    /** Solo para las pruebas: acorta la espera del procesado. */
    poll?: { intervalMs?: number; timeoutMs?: number };
  }
): Promise<string> {
  const { igUserId, accessToken, imageUrls, caption, poll } = args;

  if (imageUrls.length === 0) {
    throw contentError('No hay imágenes para publicar');
  }

  const auth = { igUserId, accessToken };

  /** Nada se publica sin que Instagram haya terminado de procesarlo. */
  const publishWhenReady = async (creationId: string) => {
    await waitForContainerReady({ ...auth, containerId: creationId, ...poll });
    return publishContainer({ ...auth, creationId });
  };

  if (imageUrls.length === 1) {
    const containerId = await createImageContainer({
      ...auth,
      imageUrl: imageUrls[0],
      caption,
    });
    return publishWhenReady(containerId);
  }

  // Los hijos se crean en serie y no en paralelo: Instagram limita las
  // peticiones por token, y un carrusel de diez disparado de golpe se
  // gana un 429 que acá se leería como fallo de contenido.
  const childrenIds: string[] = [];
  for (const imageUrl of imageUrls.slice(0, MAX_CAROUSEL_ITEMS)) {
    childrenIds.push(
      await createImageContainer({
        ...auth,
        imageUrl,
        isCarouselItem: true,
      })
    );
  }

  const parentId = await createCarouselContainer({
    ...auth,
    childrenIds,
    caption,
  });
  return publishWhenReady(parentId);
}

// ============================================================
// Tope de publicaciones
// ============================================================

export interface PublishingLimit {
  /** Contenedores publicados en el periodo vigente. */
  used: number;
  /** Tope del periodo, según lo informa Instagram ahora mismo. */
  total: number;
  /** Duración del periodo en segundos (86400 al escribir esto). */
  durationSeconds: number;
  /** Lo que queda. Nunca negativo. */
  remaining: number;
}

interface PublishingLimitResponse {
  data?: Array<{
    quota_usage?: number;
    config?: { quota_total?: number; quota_duration?: number };
  }>;
}

/**
 * Cuánto margen queda en el periodo.
 *
 * El tope se lee de la RESPUESTA, no de una constante nuestra: lo fija
 * Meta, lo cambia sin avisar, y sus propias docs se contradicen sobre
 * el número. Un valor viejo fallaría creyéndose con margen que no hay,
 * que es la dirección cara del error — una publicación no se retira.
 *
 * Si la respuesta no trae el tope, se lanza en vez de suponer uno: no
 * poder verificar el margen impide aprobar, y publicar a ciegas no es
 * una alternativa aceptable.
 */
export async function getPublishingLimit(
  args: IgAuthArgs
): Promise<PublishingLimit> {
  const { igUserId, accessToken } = args;
  const data = await igGet<PublishingLimitResponse>(
    `${igUserId}/content_publishing_limit?fields=config,quota_usage`,
    accessToken
  );

  const entry = data.data?.[0];
  const used = entry?.quota_usage;
  const total = entry?.config?.quota_total;
  const durationSeconds = entry?.config?.quota_duration;

  if (
    typeof used !== 'number' ||
    typeof total !== 'number' ||
    typeof durationSeconds !== 'number'
  ) {
    throw contentError(
      'Instagram no informó el margen de publicaciones disponible'
    );
  }

  return {
    used,
    total,
    durationSeconds,
    remaining: Math.max(0, total - used),
  };
}

export { InstagramError };
