import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';

// ============================================================
// La conexión de Facebook de una cuenta.
//
// Mismo trato que `../instagram/config.ts`: el token se guarda cifrado
// y se descifra solo acá, para usarlo. Nunca sale hacia el cliente ni
// se registra en un log.
//
// Es una tabla APARTE de instagram_config, no una fila más de una tabla
// común: las dos redes no guardan lo mismo —una necesita ig_user_id, la
// otra page_id— y unirlas obligaría a hacer anulable lo que en cada una
// es obligatorio (decisión 2, migración 517).
// ============================================================

export interface FacebookConfig {
  /** El <PAGE_ID> de la página del negocio. */
  pageId: string;
  /** Token DE LA PÁGINA, ya descifrado. */
  accessToken: string;
  pageName: string | null;
  tokenExpiresAt: string | null;
}

interface ConfigRow {
  page_id: string;
  access_token: string;
  page_name: string | null;
  token_expires_at: string | null;
  status: string;
}

const CONFIG_COLUMNS =
  'page_id, access_token, page_name, token_expires_at, status';

/**
 * Carga y descifra la conexión de la cuenta, para usarla.
 *
 * Devuelve `null` cuando no hay fila o la conexión está desconectada:
 * ambas cosas significan "esta cuenta no publica en Facebook" y quien
 * llama las trata igual.
 *
 * Lanza solo si el token guardado no se puede descifrar (típicamente un
 * `ENCRYPTION_KEY` que cambió), para que ese fallo distinto se note en
 * vez de parecer "no está configurado" — el mismo criterio que
 * `loadInstagramConfig`.
 */
export async function loadFacebookConfig(
  db: SupabaseClient,
  accountId: string
): Promise<FacebookConfig | null> {
  const { data, error } = await db
    .from('facebook_config')
    .select(CONFIG_COLUMNS)
    .eq('account_id', accountId)
    .maybeSingle<ConfigRow>();
  if (error) throw error;
  if (!data || data.status !== 'connected') return null;

  return {
    pageId: data.page_id,
    accessToken: decrypt(data.access_token),
    pageName: data.page_name,
    tokenExpiresAt: data.token_expires_at,
  };
}

/**
 * Datos de la conexión seguros de mostrar.
 *
 * Existe para que ninguna pantalla ni respuesta de API tenga que tocar
 * la fila completa: acá no hay token que filtrar por descuido.
 */
export interface FacebookConnectionInfo {
  connected: boolean;
  pageId: string | null;
  pageName: string | null;
  tokenExpiresAt: string | null;
}

export async function getConnectionInfo(
  db: SupabaseClient,
  accountId: string
): Promise<FacebookConnectionInfo> {
  const { data, error } = await db
    .from('facebook_config')
    .select('page_id, page_name, token_expires_at, status')
    .eq('account_id', accountId)
    .maybeSingle<Omit<ConfigRow, 'access_token'>>();
  if (error) throw error;

  return {
    connected: data?.status === 'connected',
    pageId: data?.page_id ?? null,
    pageName: data?.page_name ?? null,
    tokenExpiresAt: data?.token_expires_at ?? null,
  };
}
