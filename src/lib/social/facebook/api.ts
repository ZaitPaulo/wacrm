/**
 * Cliente de publicación de Facebook (Graph API de páginas).
 *
 * Mismas convenciones que `../instagram/api.ts`: un único objeto de
 * opciones por función, para que un intercambio de argumentos no pase
 * la compilación y falle recién contra Meta.
 *
 * EL HOST NO ES EL DE INSTAGRAM. Acá es `graph.facebook.com`, el del
 * camino con Facebook Login. `graph.instagram.com` —que es el que usa
 * la otra red— rechazaría estos tokens, y al revés también.
 *
 * ES MÁS SIMPLE QUE INSTAGRAM, y conviene decir en qué: no hay
 * contenedor que esperar. Instagram devuelve el id de un contenedor
 * antes de haberlo procesado y publicar uno a medio hacer se rechaza
 * —el paso que faltaba y por el que ninguna publicación salió hasta el
 * 2026-08-31—. Acá la foto se sube y queda subida; no hay `status_code`
 * que consultar ni espera que administrar.
 */

import {
  SocialPublishError,
  contentError,
  metaErrorFromResponse,
  unansweredError,
  type PublishStep,
} from '../errors';
import { MAX_ATTACHED_PHOTOS } from './limits';

const FB_API_VERSION = 'v25.0';
const FB_API_BASE = `https://graph.facebook.com/${FB_API_VERSION}`;

interface FbAuthArgs {
  /** El <PAGE_ID> de la página del negocio. */
  pageId: string;
  /**
   * El token DE LA PÁGINA, ya descifrado. Nunca se registra ni se
   * devuelve.
   *
   * No sirve el token del usuario que la administra: publicar en una
   * página se autentica con el token de esa página.
   */
  accessToken: string;
}

/**
 * POST a la Graph API con el cuerpo como JSON.
 *
 * Todo error sale como `SocialPublishError` ya clasificado en
 * credenciales o contenido: quien llama nunca tiene que interpretar
 * códigos de Meta. La clasificación es la misma que la de Instagram
 * porque los códigos son los mismos — ambas son Graph API.
 */
async function fbPost<T>(
  path: string,
  accessToken: string,
  body: Record<string, string>,
  step: PublishStep = 'other'
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${FB_API_BASE}/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    // La petición se fue y no volvió nada. Con `step === 'publish'`
    // este es el caso que no se puede resolver solo: pudo haberse
    // publicado.
    throw unansweredError(`Facebook no respondió (${step})`, step);
  }
  if (!response.ok) {
    throw await metaErrorFromResponse(
      response,
      `Facebook API error: ${response.status}`,
      step
    );
  }
  return response.json() as Promise<T>;
}

async function fbGet<T>(path: string, accessToken: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${FB_API_BASE}/${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    // Una lectura fallida no deja nada a medias: se reintenta sin riesgo.
    throw unansweredError('Facebook no respondió', 'other');
  }
  if (!response.ok) {
    throw await metaErrorFromResponse(
      response,
      `Facebook API error: ${response.status}`
    );
  }
  return response.json() as Promise<T>;
}

// ============================================================
// Las páginas que administra quien conecta
// ============================================================

/** Una página que el usuario puede administrar, con su propio token. */
export interface FacebookPage {
  id: string;
  name: string | null;
  /**
   * El token DE ESTA PÁGINA.
   *
   * Es lo que se guarda al conectar, y el motivo por el que este listado
   * existe: derivarlo en cada publicación sería una petición de red más
   * y un punto de fallo más en el momento menos conveniente.
   */
  accessToken: string;
}

interface AccountsResponse {
  data?: Array<{ id?: string; name?: string; access_token?: string }>;
}

/**
 * Las páginas que administra el dueño de un token de USUARIO.
 *
 * Se usa al conectar, para que una persona elija en cuál se publica. No
 * se elige por el sistema: publicar en la página equivocada es visible
 * para los clientes del negocio y no se deshace.
 *
 * Las entradas sin token se descartan: son páginas sobre las que el
 * usuario no tiene permiso de publicar, y ofrecerlas terminaría en un
 * fallo de credenciales días después, sin relación aparente con lo que
 * se hizo en Ajustes.
 */
export async function listManagedPages(args: {
  /** Token de USUARIO, el que se pega en Ajustes. */
  userAccessToken: string;
}): Promise<FacebookPage[]> {
  const data = await fbGet<AccountsResponse>(
    'me/accounts?fields=id,name,access_token',
    args.userAccessToken
  );

  const pages: FacebookPage[] = [];
  for (const entry of data.data ?? []) {
    if (!entry.id || !entry.access_token) continue;
    pages.push({
      id: entry.id,
      name: entry.name ?? null,
      accessToken: entry.access_token,
    });
  }
  return pages;
}

// ============================================================
// Publicación
// ============================================================

interface PhotoResponse {
  id?: string;
  post_id?: string;
}

/**
 * Sube UNA foto a la página.
 *
 * `publish: false` la deja subida y NO VISIBLE, para adjuntarla después
 * a una entrada de varias fotos. Ese es el paso reversible: una foto
 * sin publicar no la ve nadie, así que un fallo ahí es tan seguro como
 * un fallo creando contenedores en Instagram.
 *
 * Con `publish: true` la foto SALE, y ese paso ya no se deshace.
 */
export async function uploadPhoto(
  args: FbAuthArgs & {
    imageUrl: string;
    /** Solo cuando la foto se publica sola. */
    caption?: string;
    publish: boolean;
  }
): Promise<string> {
  const { pageId, accessToken, imageUrl, caption, publish } = args;

  const body: Record<string, string> = { url: imageUrl };
  if (publish) {
    if (caption) body.caption = caption;
  } else {
    body.published = 'false';
  }

  const data = await fbPost<PhotoResponse>(
    `${pageId}/photos`,
    accessToken,
    body,
    // Subir sin publicar no muestra nada; publicar sí. El paso es lo
    // que decide si un desenlace perdido queda en duda.
    publish ? 'publish' : 'container'
  );
  if (!data.id) {
    throw contentError('Facebook no devolvió el identificador de la foto');
  }
  return data.id;
}

interface FeedResponse {
  id?: string;
}

/**
 * Crea la entrada que agrupa fotos ya subidas.
 *
 * Este es el paso irreversible: hasta acá las fotos estaban subidas
 * pero invisibles.
 */
export async function createPhotoPost(
  args: FbAuthArgs & { photoIds: string[]; message: string }
): Promise<string> {
  const { pageId, accessToken, photoIds, message } = args;

  if (photoIds.length === 0) {
    throw contentError('Una entrada necesita al menos una foto');
  }
  if (photoIds.length > MAX_ATTACHED_PHOTOS) {
    throw contentError(
      `Una entrada admite hasta ${MAX_ATTACHED_PHOTOS} fotos`
    );
  }

  const data = await fbPost<FeedResponse>(
    `${pageId}/feed`,
    accessToken,
    {
      message,
      // Meta espera un JSON serializado acá, no un arreglo anidado.
      attached_media: JSON.stringify(
        photoIds.map((id) => ({ media_fbid: id }))
      ),
    },
    'publish'
  );
  if (!data.id) {
    throw contentError(
      'Facebook no devolvió el identificador de la publicación'
    );
  }
  return data.id;
}

/**
 * El flujo completo, de las imágenes a la publicación viva.
 *
 * Con UNA foto se publica la foto directamente, con su texto: armar una
 * entrada de una sola adjunta agrega un paso que no aporta nada y deja
 * una foto suelta subida si el segundo paso falla.
 *
 * Con VARIAS se suben todas sin publicar y recién entonces se crea la
 * entrada. El orden importa por lo mismo que en Instagram: es el que
 * verá quien mire la publicación.
 *
 * Devuelve el id de la publicación, que es la única prueba de que esto
 * salió. Todo lo que puede fallar sale como `SocialPublishError`
 * clasificado; quien llama decide qué hacer con la fila de la cola
 * según `kind`.
 *
 * @param imageUrls Fotos ya publicables y accesibles por Meta, en
 *   orden. Se recorta al tope.
 * @param caption Texto de la publicación.
 */
export async function publishPhotoPost(
  args: FbAuthArgs & { imageUrls: string[]; caption: string }
): Promise<string> {
  const { pageId, accessToken, imageUrls, caption } = args;

  if (imageUrls.length === 0) {
    throw contentError('No hay imágenes para publicar');
  }

  const auth = { pageId, accessToken };

  if (imageUrls.length === 1) {
    return uploadPhoto({
      ...auth,
      imageUrl: imageUrls[0],
      caption,
      publish: true,
    });
  }

  // Las fotos se suben en serie y no en paralelo: Meta limita las
  // peticiones por token, y diez disparadas de golpe se ganan un 429 que
  // acá se leería como fallo de contenido. Es la misma razón por la que
  // los hijos de un carrusel de Instagram se crean uno por uno.
  const photoIds: string[] = [];
  for (const imageUrl of imageUrls.slice(0, MAX_ATTACHED_PHOTOS)) {
    photoIds.push(
      await uploadPhoto({ ...auth, imageUrl, publish: false })
    );
  }

  return createPhotoPost({ ...auth, photoIds, message: caption });
}

export { SocialPublishError };
