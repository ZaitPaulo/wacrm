// ============================================================
// Errores de publicación, clasificados en las dos únicas categorías
// que le importan a quien usa el sistema.
//
// Un token vencido y una foto que la red rechaza se arreglan en
// lugares distintos: el primero reconectando en Ajustes, el segundo
// tocando el vehículo. Un mensaje que no los distinga manda a la
// persona a buscar donde no es.
//
// SIRVE PARA TODAS LAS REDES porque todas son de Meta: Instagram y
// Facebook devuelven el mismo cuerpo de error y los mismos códigos,
// aunque el host y el token sean distintos. Clasificar dos veces lo
// mismo solo garantizaría que las dos clasificaciones se separen.
//
// Lo que SÍ es de cada red es a dónde se manda a la persona a
// arreglarlo; eso lo pone quien traduce el fallo a un mensaje, con la
// `network` de la fila a la vista.
//
// `kind` es el mismo par de valores que el enum
// `social_post_failure_kind` de la migración 512: lo que se clasifica
// acá es lo que queda escrito en la fila fallida.
// ============================================================

export type PublishFailureKind = 'credentials' | 'content';

/**
 * En qué momento del envío falló.
 *
 * Importa por una sola razón, pero es la más cara del sistema: un fallo
 * preparando el contenido no publicó nada, y uno en el envío final
 * puede haber publicado. Ver `answered`.
 *
 * Los nombres son de los DOS PASOS, no de los endpoints de una red:
 * `container` es todo lo que se arma sin que nadie lo vea —los
 * contenedores de Instagram, las fotos sin publicar de Facebook— y
 * `publish` es el paso irreversible.
 */
export type PublishStep = 'container' | 'publish' | 'other';

export interface SocialPublishErrorOptions {
  code?: number | null;
  /**
   * ¿La red contestó?
   *
   * `true` incluso cuando contestó un error: la operación tuvo un
   * desenlace conocido. `false` significa que la petición se fue y no
   * volvió nada —red caída, timeout, proceso muerto—, y entonces NO SE
   * SABE si la publicación salió.
   *
   * Combinado con `step === 'publish'`, ese es el único caso en que el
   * sistema no puede concluir nada solo, y por eso manda la fila a
   * revisión manual en vez de reintentar: una publicación no se
   * deshace —quien la vio ya la vio—, así que reintentar a ciegas
   * arriesga duplicarla.
   */
  answered?: boolean;
  step?: PublishStep;
}

export class SocialPublishError extends Error {
  readonly kind: PublishFailureKind;
  /** Código de Meta, cuando lo informó. Para el log, no para la UI. */
  readonly code: number | null;
  readonly answered: boolean;
  readonly step: PublishStep;

  constructor(
    message: string,
    kind: PublishFailureKind,
    options: SocialPublishErrorOptions = {}
  ) {
    super(message);
    this.name = 'SocialPublishError';
    this.kind = kind;
    this.code = options.code ?? null;
    this.answered = options.answered ?? true;
    this.step = options.step ?? 'other';
  }
}

/**
 * True cuando el sistema NO PUEDE SABER si la publicación salió.
 *
 * Es la condición que manda una fila a revisión manual.
 */
export function isOutcomeUnknown(error: unknown): boolean {
  return (
    error instanceof SocialPublishError &&
    !error.answered &&
    error.step === 'publish'
  );
}

interface MetaErrorBody {
  error?: {
    message?: string;
    code?: number;
    type?: string;
    error_subcode?: number;
  };
}

/**
 * Códigos de Meta que significan "el problema es la credencial".
 *
 *   190 — token inválido o expirado, el caso corriente: los tokens de
 *         Meta caducan y hay que reconectar.
 *   102 — sesión caída.
 *   104 — falta la firma de la petición.
 *   10, 200-299 — permisos: la app no tiene concedido lo que pide. Se
 *         arregla del lado de Meta, no del contenido, así que cae en la
 *         misma categoría aunque el token en sí sea válido.
 */
function isCredentialCode(code: number): boolean {
  if (code === 190 || code === 102 || code === 104 || code === 10) return true;
  return code >= 200 && code <= 299;
}

/**
 * Convierte una respuesta fallida de Meta en un `SocialPublishError` con
 * su categoría. Vale para cualquiera de sus redes.
 *
 * Ante la duda clasifica como `content`: un falso "reconecta la cuenta"
 * empuja a desconectar una conexión que funciona, que es peor que un
 * mensaje de contenido impreciso.
 */
export async function metaErrorFromResponse(
  response: Response,
  fallback: string,
  step: PublishStep = 'other'
): Promise<SocialPublishError> {
  let message = fallback;
  let code: number | null = null;
  let type: string | undefined;

  try {
    const body = (await response.json()) as MetaErrorBody;
    if (body.error?.message) message = body.error.message;
    if (typeof body.error?.code === 'number') code = body.error.code;
    type = body.error?.type;
  } catch {
    // El cuerpo no era JSON — se conserva el fallback.
  }

  // El status manda cuando Meta ni siquiera devolvió un error tipado:
  // un 401 es una credencial rechazada aunque no venga cuerpo.
  const byStatus = response.status === 401;
  const byCode = code !== null && isCredentialCode(code);
  // `OAuthException` NO significa por sí solo "credencial rechazada":
  // Meta la usa también para errores de publicación con el token
  // perfecto — "Media ID is not available" (9007) llega así, y leerlo
  // como credencial mandaba a reconectar una cuenta que funciona. Solo
  // cuenta cuando el código acompaña, o cuando no vino ninguno.
  const byType = type === 'OAuthException' && (code === null || byCode);

  const kind: PublishFailureKind =
    byStatus || byType || byCode ? 'credentials' : 'content';

  // La red contestó, aunque haya contestado un error: el desenlace
  // es conocido y la fila puede marcarse fallida sin ambigüedad.
  return new SocialPublishError(message, kind, { code, answered: true, step });
}

/**
 * La petición nunca obtuvo respuesta —red caída, timeout, proceso
 * muerto—. Solo el llamador sabe en qué paso iba, y de eso depende si
 * el desenlace quedó en duda.
 */
export function unansweredError(
  message: string,
  step: PublishStep
): SocialPublishError {
  return new SocialPublishError(message, 'content', { answered: false, step });
}

/** Error de contenido de nuestro lado, sin haber llegado a la red. */
export function contentError(message: string): SocialPublishError {
  return new SocialPublishError(message, 'content');
}

/** No hay cuenta conectada, o su token no se pudo usar. */
export function credentialsError(message: string): SocialPublishError {
  return new SocialPublishError(message, 'credentials');
}
