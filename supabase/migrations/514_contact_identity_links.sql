-- ============================================================
-- 514_contact_identity_links.sql
--
-- Vincular dos fichas que resultaron ser la misma persona —la que
-- escribió por WhatsApp y la que escribió por Instagram— SIN PERDER LA
-- POSIBILIDAD DE DESHACERLO.
--
-- Esa es la única razón por la que esta migración existe. Fusionar es
-- fácil: se mueven las conversaciones y las identidades a una ficha y
-- se borra la otra. El problema es que ahí se acabó: si resultó que
-- eran dos clientes distintos, ya no hay forma de saber qué venía de
-- cuál. Y ese error es el que el diseño considera peor que no fusionar,
-- porque mezcla historiales de personas distintas con datos personales
-- de por medio.
--
-- Decisiones de diseño (ver openspec/changes/add-meta-multichannel):
--   * LA FICHA ABSORBIDA NO SE BORRA. Queda apuntando a la que
--     sobrevive. Es lo que permite devolverle lo suyo si la vinculación
--     estuvo mal.
--   * SE GUARDA QUÉ SE MOVIÓ, fila por fila. Deshacer no puede ser
--     "devolvele todo lo que tenga la sobreviviente": para entonces ya
--     puede haber acumulado cosas propias.
--   * La vinculación la confirma una persona y queda registrado quién.
--     No hay fusión automática en ningún camino.
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

-- ============================================================
-- contacts.merged_into_contact_id
--
-- La ficha absorbida sigue existiendo pero deja de listarse: todo lo
-- suyo vive ahora en la que sobrevive. ON DELETE SET NULL para que
-- borrar la sobreviviente no se lleve por delante a la absorbida.
-- ============================================================
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS merged_into_contact_id UUID
    REFERENCES contacts(id) ON DELETE SET NULL;

COMMENT ON COLUMN contacts.merged_into_contact_id IS
  'Cuando no es NULL, esta ficha se vinculó a otra y no debe listarse. La vinculación es reversible: ver contact_links.';

-- Las listas de contactos filtran por esto, y son de las consultas más
-- frecuentes del producto. Parcial porque la enorme mayoría es NULL.
CREATE INDEX IF NOT EXISTS idx_contacts_merged_into
  ON contacts (merged_into_contact_id)
  WHERE merged_into_contact_id IS NOT NULL;

-- ============================================================
-- TABLA contact_links — el registro que hace reversible la vinculación
--
-- Guarda QUÉ se movió, no solo entre quiénes. Deshacer necesita esa
-- precisión: la ficha sobreviviente pudo haber recibido conversaciones
-- propias después de la vinculación, y devolverle todo a la absorbida
-- le entregaría cosas que nunca fueron suyas.
-- ============================================================
CREATE TABLE IF NOT EXISTS contact_links (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- La ficha que queda y la que se absorbió.
  surviving_contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  merged_contact_id    UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,

  -- Exactamente qué cambió de dueño. Sin esto, deshacer es adivinar.
  moved_conversation_ids UUID[] NOT NULL DEFAULT '{}',
  moved_channel_ids      UUID[] NOT NULL DEFAULT '{}',

  -- Quién lo confirmó. La vinculación NUNCA es automática, así que
  -- siempre hay alguien detrás.
  linked_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Al deshacer no se borra la fila: queda la historia de que esto se
  -- vinculó y se revirtió, que es justo lo que alguien va a querer
  -- entender después.
  undone_at  TIMESTAMPTZ,
  undone_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Una ficha no puede estar absorbida por dos lados a la vez.
  CONSTRAINT contact_links_distinct CHECK (
    surviving_contact_id <> merged_contact_id
  )
);

-- Un contacto solo puede estar absorbido por una vinculación VIGENTE.
-- Parcial sobre las no deshechas: si se revierte, esa misma ficha puede
-- volver a vincularse mañana.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_links_active_merged
  ON contact_links (merged_contact_id)
  WHERE undone_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contact_links_surviving
  ON contact_links (surviving_contact_id);

CREATE INDEX IF NOT EXISTS idx_contact_links_account
  ON contact_links (account_id, created_at DESC);

-- ============================================================
-- RLS — lectura de cualquier miembro, escritura de 'agent'
--
-- Mismo patrón que `contacts` y `contact_channels`: vincular es una
-- operación sobre la ficha del contacto, y quien atiende puede hacerla.
-- Lo que la protege no es el rol sino que exige confirmación humana.
-- ============================================================
ALTER TABLE contact_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_links_select ON contact_links;
CREATE POLICY contact_links_select ON contact_links FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS contact_links_insert ON contact_links;
CREATE POLICY contact_links_insert ON contact_links FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS contact_links_update ON contact_links;
CREATE POLICY contact_links_update ON contact_links FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS contact_links_delete ON contact_links;
CREATE POLICY contact_links_delete ON contact_links FOR DELETE
  USING (is_account_member(account_id, 'agent'));
