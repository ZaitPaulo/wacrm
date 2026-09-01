// ============================================================
// El registro de redes.
//
// Es el único lugar del sistema que sabe qué redes existen. Todo lo
// demás —encolar, revisar, aprobar, publicar— trabaja contra este
// contrato y no contra Instagram ni contra Facebook.
//
// La forma del contrato responde a una regla concreta: NINGÚN MÓDULO
// COMÚN VE UN TOKEN. `connect()` carga la configuración, la descifra y
// devuelve un objeto ya atado a esas credenciales; `publish.ts` recibe
// ese objeto y nunca toca la credencial que hay dentro. Es la misma
// razón por la que `loadInstagramConfig` descifra en un solo lugar.
//
// Agregar una red es escribir su adaptador y sumarlo a NETWORKS. Si
// hiciera falta tocar algo más, es que ese algo se quedó con una regla
// que no le corresponde.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import type { NetworkLimits } from './limits';
import { INSTAGRAM_LIMITS } from './instagram/limits';
import { loadInstagramConfig } from './instagram/config';
import { getPublishingLimit, publishImagePost } from './instagram/api';

/**
 * El margen de publicaciones de una red en el periodo vigente.
 *
 * Se devuelve entero y no solo `remaining` porque la cola muestra el
 * consumo completo: "quedan 3 de 25" le dice a quien revisa si conviene
 * espaciar las aprobaciones, y "quedan 3" solo no.
 */
export interface PublishingQuota {
  /** Publicaciones hechas en el periodo vigente. */
  used: number;
  /** Tope del periodo, según lo informa la red ahora mismo. */
  total: number;
  /** Duración del periodo en segundos. */
  durationSeconds: number;
  /** Lo que queda. Nunca negativo. */
  remaining: number;
}

/**
 * Las redes en las que se puede publicar.
 *
 * Los valores son EXACTAMENTE los del `CHECK` de `social_posts.network`
 * (migraciones 512 y 513). La columna existe desde la 512, con una sola
 * red posible pero con la forma correcta.
 */
export type SocialNetwork = 'instagram' | 'facebook';

/** Una red ya conectada, atada a las credenciales de una cuenta. */
export interface ConnectedNetwork {
  readonly network: SocialNetwork;
  /**
   * A dónde se publica, para mostrarlo: `@usuario` en Instagram, el
   * nombre de la página en Facebook.
   *
   * Publicar en el lugar equivocado es visible para los clientes del
   * negocio y no se deshace, así que la cola tiene que poder decir a
   * dónde va antes de que alguien apruebe.
   */
  readonly displayName: string | null;

  /**
   * Cuánto margen queda en el periodo vigente.
   *
   * AUSENTE cuando la red no informa ningún tope, que es el caso de
   * Facebook. No se supone uno: un número inventado impediría aprobar
   * sin motivo real, y es el mismo criterio con el que el tope de
   * Instagram se pregunta en vez de guardarse como constante.
   *
   * Su ausencia y un fallo al leerlo NO son lo mismo. Sin tope se
   * publica con normalidad; con tope ilegible no se aprueba, porque
   * publicar a ciegas gasta el intento.
   */
  readonly quota?: () => Promise<PublishingQuota>;

  /**
   * Envía la publicación. Devuelve el identificador que dio la red, que
   * es la única prueba de que esto salió.
   *
   * @param imageUrls Fotos ya publicables, en el orden que define el
   *   encuadre.
   * @param caption Texto de la publicación.
   */
  publish(args: { imageUrls: string[]; caption: string }): Promise<string>;
}

/** Lo que cada red tiene que aportar para entrar al sistema. */
export interface NetworkAdapter {
  readonly network: SocialNetwork;
  /** Los de esta red. Nunca se aplican los de otra. */
  readonly limits: NetworkLimits;
  /**
   * Carga la conexión de la cuenta, o `null` si no la tiene conectada.
   *
   * `null` no es un error: significa "esta cuenta no publica en esta
   * red", y es lo que hace que el encolado no deje pendientes que nadie
   * podría aprobar.
   */
  connect(
    db: SupabaseClient,
    accountId: string
  ): Promise<ConnectedNetwork | null>;
}

const instagramAdapter: NetworkAdapter = {
  network: 'instagram',
  limits: INSTAGRAM_LIMITS,
  async connect(db, accountId) {
    const config = await loadInstagramConfig(db, accountId);
    if (!config) return null;

    const auth = {
      igUserId: config.igUserId,
      accessToken: config.accessToken,
    };

    return {
      network: 'instagram',
      displayName: config.username,
      quota: () => getPublishingLimit(auth),
      publish: ({ imageUrls, caption }) =>
        publishImagePost({ ...auth, imageUrls, caption }),
    };
  },
};

/**
 * Las redes registradas, en el orden en que se muestran.
 *
 * Instagram primero porque es la que el negocio ya venía usando.
 */
export const NETWORKS: Record<SocialNetwork, NetworkAdapter> = {
  instagram: instagramAdapter,
  // facebook: se registra en el grupo 4 del change.
} as Record<SocialNetwork, NetworkAdapter>;

/** Las redes que existen, en orden. */
export function allNetworks(): NetworkAdapter[] {
  return Object.values(NETWORKS);
}

/** El adaptador de una red, o `undefined` si el valor no es una red. */
export function networkAdapter(
  network: string
): NetworkAdapter | undefined {
  return NETWORKS[network as SocialNetwork];
}

/**
 * Las redes que ESTA CUENTA tiene conectadas, ya listas para publicar.
 *
 * Una red que falla al conectar se omite en vez de tumbar la operación:
 * el encolado prepara los borradores de las demás, y aprobar en una red
 * no depende de que la otra esté sana. Es la garantía de que
 * desconectar —o romper— una red no arrastra a la otra.
 */
export async function connectedNetworks(
  db: SupabaseClient,
  accountId: string
): Promise<ConnectedNetwork[]> {
  const out: ConnectedNetwork[] = [];
  for (const adapter of allNetworks()) {
    try {
      const connected = await adapter.connect(db, accountId);
      if (connected) out.push(connected);
    } catch (err) {
      console.error(
        `[social] no se pudo conectar ${adapter.network}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
  return out;
}
