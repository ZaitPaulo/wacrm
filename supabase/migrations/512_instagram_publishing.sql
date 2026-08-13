-- ============================================================
-- 512_instagram_publishing.sql
--
-- Publicación de vehículos en Instagram, con aprobación humana.
--
-- Dos tablas: la conexión de la cuenta (credenciales cifradas, como
-- WhatsApp) y la cola de publicaciones, donde un vehículo disponible
-- deja un borrador que alguien revisa antes de que salga a Instagram.
--
-- Decisiones de diseño (ver openspec/changes/add-instagram-publishing):
--   * ADMIN O SUPERIOR en toda la RLS, lectura incluida. La conexión
--     guarda un token; la cola decide qué sale al Instagram del negocio.
--     Ninguna de las dos es información de trabajo diario de un asesor.
--   * El ENCOLADO CORRE CON SERVICE-ROLE. Quien edita inventario es
--     'agent' y la RLS de acá exige 'admin', así que el borrador lo
--     inserta el service-role acotando account_id a mano. Es exactamente
--     lo que ya hace syncVehicleKnowledge con el knowledge base, y por
--     el mismo motivo (ver src/lib/inventory/knowledge-sync.ts).
--   * LAS IMÁGENES SE CONGELAN al preparar la publicación, igual que
--     broadcast_recipients.template_params en la 038: se publica lo que
--     la persona revisó, no una recomposición contra datos que pudieron
--     cambiar desde entonces.
--   * EL ANTECEDENTE NO SE GUARDA. Que un vehículo ya se haya publicado
--     se deriva consultando sus filas 'published' anteriores; una
--     columna que repitiera eso podría contradecir a las filas.
--   * `network` desde el principio, aunque hoy solo valga 'instagram':
--     la unicidad de pendientes es por vehículo Y red, y agregarla
--     después obligaría a reconstruir el índice.
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

-- ============================================================
-- ENUM social_post_status
--
-- 'pending' es el borrador a revisar. 'published' es terminal y su
-- prueba es external_post_id. 'discarded' es la salida deliberada y
-- 'failed' la involuntaria.
--
-- 'needs_review' es el estado incómodo y el más importante: se envió a
-- Instagram y no sabemos si entró. Una publicación no se puede retirar
-- limpiamente, así que ante la duda el sistema no reintenta — deja la
-- fila acá para que una persona compare contra Instagram.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'social_post_status') THEN
    CREATE TYPE social_post_status AS ENUM (
      'pending', 'published', 'discarded', 'failed', 'needs_review'
    );
  END IF;
END $$;

-- ============================================================
-- ENUM social_post_failure_kind
--
-- Un token vencido y una foto que Instagram rechaza se arreglan en
-- lugares distintos: el primero reconectando la cuenta, el segundo
-- tocando el vehículo. Confundirlos manda al usuario a buscar donde no
-- es, así que el motivo del fallo se guarda clasificado y no solo como
-- texto libre.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'social_post_failure_kind') THEN
    CREATE TYPE social_post_failure_kind AS ENUM ('credentials', 'content');
  END IF;
END $$;

-- ============================================================
-- TABLA instagram_config
--
-- Una cuenta de Instagram por cuenta del CRM (UNIQUE account_id),
-- siguiendo la forma de whatsapp_config pero scopeada por cuenta y no
-- por usuario, que es el patrón vigente desde la 017.
--
-- `access_token` se guarda CIFRADO por la aplicación (encrypt() de
-- src/lib/whatsapp/encryption.ts). La base solo ve texto opaco.
-- ============================================================
CREATE TABLE IF NOT EXISTS instagram_config (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id    UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Identificador de la cuenta profesional de Instagram. Es el <IG_ID>
  -- de las rutas /media, /media_publish y /content_publishing_limit.
  ig_user_id    TEXT NOT NULL,
  -- Para mostrar a qué cuenta quedó vinculado. Es dato público de
  -- Instagram y cambia si el negocio se renombra: se refresca al
  -- reconectar, no es fuente de verdad de nada.
  username      TEXT,

  access_token  TEXT NOT NULL,
  -- Los tokens de Meta caducan. Guardar el vencimiento permite avisar
  -- antes de que una aprobación falle por credenciales; NULL cuando
  -- Meta no lo informó.
  token_expires_at TIMESTAMPTZ,

  status        TEXT NOT NULL DEFAULT 'disconnected'
                CHECK (status IN ('connected', 'disconnected')),
  connected_at  TIMESTAMPTZ
);

COMMENT ON COLUMN instagram_config.access_token IS
  'Cifrado por la aplicación con encrypt() (src/lib/whatsapp/encryption.ts). Nunca viaja al cliente.';

-- ============================================================
-- RLS de instagram_config — 'admin' o superior, lectura incluida
--
-- A diferencia de inventory_vehicles, acá el SELECT también se
-- restringe: la fila contiene el token. Aunque la aplicación nunca lo
-- devuelva, la RLS es la única defensa ante un select=* directo.
-- ============================================================
ALTER TABLE instagram_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS instagram_config_select ON instagram_config;
CREATE POLICY instagram_config_select ON instagram_config FOR SELECT
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS instagram_config_insert ON instagram_config;
CREATE POLICY instagram_config_insert ON instagram_config FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS instagram_config_update ON instagram_config;
CREATE POLICY instagram_config_update ON instagram_config FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS instagram_config_delete ON instagram_config;
CREATE POLICY instagram_config_delete ON instagram_config FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON instagram_config;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON instagram_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- TABLA social_posts — la cola
--
-- ON DELETE CASCADE sobre el vehículo: borrar el auto se lleva sus
-- borradores, que es lo correcto para los pendientes. Se lleva también
-- el registro de lo ya publicado, y se acepta: el sistema nunca borra
-- de Instagram, así que la publicación sobrevive igual del lado de Meta
-- y lo que se pierde es solo nuestra copia del identificador.
-- ============================================================
CREATE TABLE IF NOT EXISTS social_posts (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  vehicle_id    UUID NOT NULL REFERENCES inventory_vehicles(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  network       TEXT NOT NULL DEFAULT 'instagram'
                CHECK (network IN ('instagram')),
  status        social_post_status NOT NULL DEFAULT 'pending',

  -- El texto que armó la plantilla. Se conserva aunque se edite, para
  -- poder volver al original y para saber qué propuso el sistema.
  proposed_caption TEXT NOT NULL,
  -- Lo que escribió quien revisa. NULL = no lo tocó; se publica
  -- proposed_caption. Dos columnas y no una porque "sin editar" y
  -- "editado hasta quedar igual" no son lo mismo al revisar la cola.
  edited_caption   TEXT,

  -- Las imágenes congeladas al preparar: es el carrusel que la persona
  -- vio y aprobó. Revalidar antes de publicar comprueba que estas URLs
  -- siguen respondiendo, no recompone la lista.
  image_urls    TEXT[] NOT NULL DEFAULT '{}',

  -- Prueba de publicación: el id que devuelve Instagram. Su presencia,
  -- y no el estado, es lo que responde "¿esto ya salió?".
  external_post_id TEXT,
  published_at  TIMESTAMPTZ,
  approved_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  failure_kind   social_post_failure_kind,
  failure_reason TEXT,

  -- Mutex de publicación, calcado de broadcasts.delivery_locked_at
  -- (038). Se toma con un UPDATE condicional, que es atómico en una
  -- sola sentencia: de dos aprobaciones simultáneas, el WHERE de la
  -- perdedora no encuentra fila.
  publish_locked_at TIMESTAMPTZ
);

COMMENT ON COLUMN social_posts.publish_locked_at IS
  'Con valor mientras una aprobación está hablando con Instagram; NULL en reposo. Un candado más viejo que la ventana de vencimiento se considera abandonado. Ver 038_broadcast_resume.sql.';

COMMENT ON COLUMN social_posts.external_post_id IS
  'Id devuelto por Instagram. Es la prueba de que la publicación salió: ante una respuesta perdida se compara contra Instagram, nunca se republica.';

-- Un solo pendiente por vehículo y red. Parcial a propósito: un
-- vehículo que reingresa al inventario debe poder tener un borrador
-- nuevo junto a la publicación que ya hizo meses atrás.
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_posts_one_pending
  ON social_posts (vehicle_id, network)
  WHERE status = 'pending';

-- La pantalla de la cola: pendientes de la cuenta, más recientes primero.
CREATE INDEX IF NOT EXISTS idx_social_posts_account_status
  ON social_posts (account_id, status, created_at DESC);

-- El antecedente de publicación de un vehículo, y el aviso de vendido
-- con publicación viva.
CREATE INDEX IF NOT EXISTS idx_social_posts_vehicle
  ON social_posts (vehicle_id, status);

-- ============================================================
-- RLS de social_posts — 'admin' o superior
--
-- Misma regla que la conexión, y por el mismo motivo: aprobar es
-- intervenir la marca del negocio. El encolado no pasa por acá, corre
-- con service-role (ver cabecera).
-- ============================================================
ALTER TABLE social_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS social_posts_select ON social_posts;
CREATE POLICY social_posts_select ON social_posts FOR SELECT
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS social_posts_insert ON social_posts;
CREATE POLICY social_posts_insert ON social_posts FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS social_posts_update ON social_posts;
CREATE POLICY social_posts_update ON social_posts FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS social_posts_delete ON social_posts;
CREATE POLICY social_posts_delete ON social_posts FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON social_posts;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON social_posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- ai_usage_log.mode — un valor para la reescritura del texto
--
-- Reescribir el texto de una publicación con la IA de la cuenta gasta
-- del mismo BYO key que las respuestas, así que se registra igual. Va
-- con nombre propio en vez de reusar 'draft': ese valor significa
-- "borrador de respuesta de WhatsApp", y mezclarlos volvería inútil el
-- reporte de consumo justo para quien quiera saber cuánto le cuesta
-- publicar.
--
-- Mismo procedimiento y mismo guard que la 507 al ampliar `provider`:
-- la tabla nace en la 033 (upstream) y puede no existir todavía.
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ai_usage_log'
  ) THEN
    ALTER TABLE ai_usage_log
      DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;

    ALTER TABLE ai_usage_log
      ADD CONSTRAINT ai_usage_log_mode_check
      CHECK (mode IN ('auto_reply', 'draft', 'social_caption'));
  END IF;
END $$;
