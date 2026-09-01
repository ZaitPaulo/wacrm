-- ============================================================
-- 517_facebook_publishing.sql
--
-- Publicación del inventario en la página de Facebook del negocio,
-- junto a la de Instagram que ya existe desde la 512.
--
-- Esta migración hace DOS cosas, y las dos son chicas a propósito:
--   1. la conexión de la página, en su propia tabla;
--   2. abrir el CHECK de social_posts.network a 'facebook'.
--
-- La cola NO cambia. La 512 ya la dejó lista: `network` existe desde
-- entonces y el índice de pendientes ya es por (vehicle_id, network).
-- Su comentario lo anticipó — "agregarla después obligaría a
-- reconstruir el índice"— y por eso acá no hay que reconstruir nada.
--
-- Decisiones de diseño (ver openspec/changes/add-facebook-publishing):
--   * CONEXIÓN APARTE, no una columna más en instagram_config ni una
--     tabla `social_configs` con `network`. Las dos redes no guardan lo
--     mismo: Instagram necesita ig_user_id, Facebook necesita page_id.
--     Unirlas obligaría a hacer anulable lo que en cada red es
--     obligatorio, y la base dejaría de poder exigirlo (decisión 2).
--   * SE GUARDA EL TOKEN DE LA PÁGINA, no el del usuario. Publicar en
--     una página se autentica con el token de esa página; guardar el de
--     usuario obligaría a derivarlo en cada publicación, que es una
--     petición de red más y un punto de fallo más en el peor momento
--     (decisión 3).
--   * DOS FILAS EN LA COLA, una por red. No hay columnas nuevas en
--     social_posts porque no hacen falta: cada publicación es su propia
--     fila, con su propio candado y su propio external_post_id. Una
--     sola fila con dos destinos no sabría representar "salió en
--     Instagram y falló en Facebook" (decisión 1).
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

-- ============================================================
-- TABLA facebook_config
--
-- Una página de Facebook por cuenta del CRM (UNIQUE account_id),
-- calcada de instagram_config (512), que a su vez sigue la forma de
-- whatsapp_config scopeada por cuenta.
--
-- `access_token` se guarda CIFRADO por la aplicación (encrypt() de
-- src/lib/whatsapp/encryption.ts). La base solo ve texto opaco.
-- ============================================================
CREATE TABLE IF NOT EXISTS facebook_config (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id    UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Identificador de la página. Es el <PAGE_ID> de las rutas /photos y
  -- /feed, y lo que decide EN QUÉ PÁGINA se publica.
  page_id       TEXT NOT NULL,
  -- Nombre de la página, para mostrar a dónde va a salir la
  -- publicación antes de que alguien apruebe. Dato público, cambia si
  -- el negocio la renombra: se refresca al reconectar y no es fuente de
  -- verdad de nada.
  page_name     TEXT,

  -- EL TOKEN DE LA PÁGINA, no el del usuario que la administra. Ver la
  -- decisión 3 en la cabecera.
  access_token  TEXT NOT NULL,
  -- Los tokens de página derivados de un token de usuario de larga
  -- duración no suelen caducar mientras el permiso siga concedido, pero
  -- eso es una propiedad de Meta y no una garantía nuestra. Se guarda
  -- el vencimiento cuando Meta lo informa, y NULL cuando no.
  token_expires_at TIMESTAMPTZ,

  status        TEXT NOT NULL DEFAULT 'disconnected'
                CHECK (status IN ('connected', 'disconnected')),
  connected_at  TIMESTAMPTZ
);

COMMENT ON TABLE facebook_config IS
  'Conexión de la página de Facebook. Independiente de instagram_config a propósito: son dos caminos de autenticación distintos de Meta, y desconectar una no puede afectar a la otra.';

COMMENT ON COLUMN facebook_config.page_id IS
  'La página en la que se publica. Se elige al conectar y nunca se deduce: publicar en la página equivocada es visible para los clientes del negocio y no se deshace.';

COMMENT ON COLUMN facebook_config.access_token IS
  'Token DE LA PÁGINA, cifrado por la aplicación con encrypt() (src/lib/whatsapp/encryption.ts). Nunca viaja al cliente.';

-- ============================================================
-- RLS de facebook_config — 'admin' o superior, lectura incluida
--
-- Idéntica a la de instagram_config y por lo mismo: la fila contiene un
-- token. Aunque la aplicación nunca lo devuelva, la RLS es la única
-- defensa ante un select=* directo.
-- ============================================================
ALTER TABLE facebook_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS facebook_config_select ON facebook_config;
CREATE POLICY facebook_config_select ON facebook_config FOR SELECT
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS facebook_config_insert ON facebook_config;
CREATE POLICY facebook_config_insert ON facebook_config FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS facebook_config_update ON facebook_config;
CREATE POLICY facebook_config_update ON facebook_config FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS facebook_config_delete ON facebook_config;
CREATE POLICY facebook_config_delete ON facebook_config FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON facebook_config;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON facebook_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- social_posts.network — se abre a 'facebook'
--
-- La columna nació en la 512 con un solo valor admitido pero con la
-- forma correcta. Acá solo se amplía el CHECK.
--
-- NINGUNA FILA EXISTENTE CAMBIA: 'instagram' sigue siendo válido y el
-- DEFAULT sigue siendo 'instagram'. Ampliar un CHECK nunca invalida lo
-- que ya pasaba, así que la migración no puede fallar por datos.
--
-- El índice único parcial idx_social_posts_one_pending NO se toca: ya
-- es (vehicle_id, network), así que un vehículo puede tener una
-- pendiente en cada red sin chocar consigo mismo.
-- ============================================================
ALTER TABLE social_posts
  DROP CONSTRAINT IF EXISTS social_posts_network_check;

ALTER TABLE social_posts
  ADD CONSTRAINT social_posts_network_check
  CHECK (network IN ('instagram', 'facebook'));

COMMENT ON COLUMN social_posts.network IS
  'A qué red va esta publicación. Cada red es su propia fila: mismo vehículo, dos filas, dos candados y dos external_post_id. Una sola fila con dos destinos no sabría representar que salió en una y falló en la otra.';
