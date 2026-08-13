-- ============================================================
-- 513_multichannel_identity.sql
--
-- El canal entra al modelo: una persona puede escribir por WhatsApp,
-- Instagram o Messenger, y el sistema tiene que reconocerla en los tres
-- sin confundir por dónde contestarle.
--
-- Hasta hoy la identidad de una persona ERA su teléfono
-- (`contacts.phone NOT NULL`) y la conversación no sabía por dónde
-- llegó. Instagram y Messenger no entregan número: entregan un
-- identificador interno de Meta.
--
-- Decisiones de diseño (ver openspec/changes/add-meta-multichannel):
--   * `contacts.phone` SE CONSERVA y se sigue poblando para WhatsApp.
--     Deja de ser la llave, no el dato. Pasa a admitir NULL para que
--     exista el contacto que solo escribió por Instagram.
--   * UNA IDENTIDAD POR CANAL en tabla aparte, no columnas por canal en
--     `contacts`. Con columnas, cada canal nuevo obligaría a migrar el
--     esquema y a tocar todas las búsquedas.
--   * UNA CONEXIÓN POR CANAL POR CUENTA del lado del negocio, así que
--     acá solo se modela la identidad del CLIENTE.
--   * El ENUM se amplía con una migración de una línea cuando entre un
--     canal nuevo. Es deliberado: un canal sin manejador en el código no
--     debería poder existir en la base.
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

-- ============================================================
-- ENUM message_channel
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_channel') THEN
    CREATE TYPE message_channel AS ENUM ('whatsapp', 'instagram', 'messenger');
  END IF;
END $$;

-- ============================================================
-- contacts.phone deja de ser obligatorio
--
-- Un contacto que llegó por Instagram no tiene teléfono y nunca lo va a
-- tener a menos que lo dé. Nada más cambia: `phone_normalized` es
-- GENERATED sobre `phone` (migración 022) y con NULL queda NULL, que el
-- índice único parcial `WHERE phone_normalized <> ''` ya excluye — la
-- garantía contra teléfonos duplicados sigue intacta para quien sí lo
-- tiene.
-- ============================================================
ALTER TABLE contacts ALTER COLUMN phone DROP NOT NULL;

-- ============================================================
-- TABLA contact_channels — la identidad del cliente en cada canal
--
-- La unicidad es por (cuenta, canal, identificador): el mismo usuario de
-- Instagram puede escribirle a dos negocios distintos y son dos
-- contactos, uno en cada cuenta, sin que ninguna alcance al otro.
-- ============================================================
CREATE TABLE IF NOT EXISTS contact_channels (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id  UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  channel     message_channel NOT NULL,
  -- Lo que el canal usa para nombrar a esa persona: el `wa_id` de
  -- WhatsApp (dígitos, sin '+'), o el identificador con alcance de
  -- aplicación que devuelven Instagram y Messenger.
  external_id TEXT NOT NULL CHECK (external_id <> '')
);

COMMENT ON COLUMN contact_channels.external_id IS
  'Identificador de la persona en ese canal. Para WhatsApp es el teléfono normalizado (solo dígitos), igual que contacts.phone_normalized.';

-- La garantía que hace posible resolver el contacto sin teléfono.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_channels_identity
  ON contact_channels (account_id, channel, external_id);

-- Para listar las identidades de un contacto (ficha, vinculación).
CREATE INDEX IF NOT EXISTS idx_contact_channels_contact
  ON contact_channels (contact_id);

-- ============================================================
-- RLS de contact_channels — patrón del repo: lee cualquier miembro,
-- escribe 'agent' o superior. Misma regla que `contacts`, porque esto
-- es parte de la ficha del contacto.
-- ============================================================
ALTER TABLE contact_channels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_channels_select ON contact_channels;
CREATE POLICY contact_channels_select ON contact_channels FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS contact_channels_insert ON contact_channels;
CREATE POLICY contact_channels_insert ON contact_channels FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS contact_channels_update ON contact_channels;
CREATE POLICY contact_channels_update ON contact_channels FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS contact_channels_delete ON contact_channels;
CREATE POLICY contact_channels_delete ON contact_channels FOR DELETE
  USING (is_account_member(account_id, 'agent'));

-- ============================================================
-- conversations.channel
--
-- `whatsapp` por defecto: toda conversación que ya existe llegó por ahí,
-- y toda escritura del código actual —que todavía no conoce canales—
-- sigue produciendo filas correctas mientras se migra el resto.
-- ============================================================
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS channel message_channel NOT NULL DEFAULT 'whatsapp';

-- ============================================================
-- La unicidad de conversaciones pasa a incluir el canal
--
-- ESTO NO DEBILITA LA 036. Esa migración nació de un bug real (#363):
-- sin índice, una carrera creaba dos conversaciones para el mismo
-- contacto y, a partir de ahí, el `.single()` fallaba en cada mensaje
-- entrante y la duplicación se multiplicaba sola.
--
-- Su garantía era "una conversación por (cuenta, contacto)", que en un
-- mundo de un solo canal era exactamente lo correcto. Con varios canales
-- ese mismo índice PROHIBIRÍA el modelo: quien escribe por WhatsApp y
-- por Instagram debe tener dos hilos, porque la ventana de respuesta y
-- el destino de salida son distintos.
--
-- Pasa a ser "una conversación por (cuenta, contacto, canal)": misma
-- protección contra la duplicación que motivó la 036, ahora consciente
-- del canal. Un segundo hilo del mismo canal sigue siendo imposible.
-- ============================================================
DROP INDEX IF EXISTS idx_conversations_account_contact;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact_channel
  ON conversations (account_id, contact_id, channel);

-- ============================================================
-- BACKFILL — una identidad de WhatsApp por cada contacto con teléfono
--
-- `phone_normalized` y no `phone`: es la forma en que Meta entrega el
-- `wa_id` (solo dígitos) y la misma con la que la 022 garantiza
-- unicidad, así que la identidad coincide con lo que llegará por el
-- webhook sin ninguna conversión.
--
-- ON CONFLICT DO NOTHING lo hace re-ejecutable.
-- ============================================================
INSERT INTO contact_channels (account_id, contact_id, channel, external_id)
SELECT c.account_id, c.id, 'whatsapp', c.phone_normalized
FROM contacts c
WHERE c.phone_normalized IS NOT NULL
  AND c.phone_normalized <> ''
ON CONFLICT (account_id, channel, external_id) DO NOTHING;

-- ============================================================
-- VERIFICACIÓN DEL BACKFILL — y se detiene si no cuadra
--
-- La comprobación va acá adentro, no en una consulta que alguien tiene
-- que acordarse de correr después: si los conteos no coinciden, esto
-- aborta la transacción y la migración no queda aplicada a medias.
--
-- Se compara contra los contactos con teléfono DISTINTO por cuenta, no
-- contra el total de contactos: dos filas con el mismo número en la
-- misma cuenta no pueden existir (índice único de la 022), pero contar
-- distinto deja la verificación correcta aunque esa garantía cambie.
-- ============================================================
DO $$
DECLARE
  v_esperadas INTEGER;
  v_creadas   INTEGER;
BEGIN
  SELECT count(DISTINCT (account_id, phone_normalized)) INTO v_esperadas
  FROM contacts
  WHERE phone_normalized IS NOT NULL AND phone_normalized <> '';

  SELECT count(*) INTO v_creadas
  FROM contact_channels
  WHERE channel = 'whatsapp';

  IF v_creadas <> v_esperadas THEN
    RAISE EXCEPTION
      'Backfill de identidades incompleto: % contactos con teléfono, % identidades de WhatsApp. La migración se detiene.',
      v_esperadas, v_creadas;
  END IF;

  RAISE NOTICE 'Backfill verificado: % identidades de WhatsApp.', v_creadas;
END $$;
