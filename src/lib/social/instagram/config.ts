import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';

// ============================================================
// La conexión de Instagram de una cuenta.
//
// Mismo trato que la config de IA (src/lib/ai/config.ts): el token se
// guarda cifrado y se descifra solo acá, para usarlo. Nunca sale hacia
// el cliente ni se registra en un log.
// ============================================================

export interface InstagramConfig {
  /** El <IG_ID> de la cuenta profesional. */
  igUserId: string;
  /** Token ya descifrado. */
  accessToken: string;
  username: string | null;
  tokenExpiresAt: string | null;
}

interface ConfigRow {
  ig_user_id: string;
  access_token: string;
  username: string | null;
  token_expires_at: string | null;
  status: string;
}

const CONFIG_COLUMNS =
  'ig_user_id, access_token, username, token_expires_at, status';

/**
 * Carga y descifra la conexión de la cuenta, para usarla.
 *
 * Devuelve `null` cuando no hay fila o la conexión está desconectada:
 * ambas cosas significan "no hay Instagram disponible" y quien llama
 * las trata igual.
 *
 * Lanza solo si el token guardado no se puede descifrar (típicamente
 * un `ENCRYPTION_KEY` que cambió), para que ese fallo distinto se note
 * en vez de parecer "no está configurado" — el mismo criterio que
 * `loadAiConfig`.
 */
export async function loadInstagramConfig(
  db: SupabaseClient,
  accountId: string
): Promise<InstagramConfig | null> {
  const { data, error } = await db
    .from('instagram_config')
    .select(CONFIG_COLUMNS)
    .eq('account_id', accountId)
    .maybeSingle<ConfigRow>();
  if (error) throw error;
  if (!data || data.status !== 'connected') return null;

  return {
    igUserId: data.ig_user_id,
    accessToken: decrypt(data.access_token),
    username: data.username,
    tokenExpiresAt: data.token_expires_at,
  };
}

/**
 * Datos de la conexión seguros de mostrar.
 *
 * Existe para que ninguna pantalla ni respuesta de API tenga que tocar
 * la fila completa: acá no hay token que filtrar por descuido.
 */
export interface InstagramConnectionInfo {
  connected: boolean;
  username: string | null;
  tokenExpiresAt: string | null;
}

export async function getConnectionInfo(
  db: SupabaseClient,
  accountId: string
): Promise<InstagramConnectionInfo> {
  const { data, error } = await db
    .from('instagram_config')
    .select('username, token_expires_at, status')
    .eq('account_id', accountId)
    .maybeSingle<Pick<ConfigRow, 'username' | 'token_expires_at' | 'status'>>();
  if (error) throw error;

  return {
    connected: data?.status === 'connected',
    username: data?.username ?? null,
    tokenExpiresAt: data?.token_expires_at ?? null,
  };
}
