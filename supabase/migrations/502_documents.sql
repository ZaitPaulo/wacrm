-- ============================================================
-- 502_documents.sql
--
-- Evoluciona la documentación de leads (migración 501) a un modelo de
-- documentos del PROCESO de compra/venta:
--
--   1. Bucket 'contact-documents' pasa a PRIVADO. La lectura ya no es
--      pública: se sirve por signed URLs (client-side createSignedUrl),
--      autorizadas por una política SELECT account-scoped.
--
--   2. La tabla se generaliza a `documents`, categorizada y vinculable a
--      un contacto y/o a un vehículo del inventario:
--        - category: person | vehicle | purchase | sale
--        - contact_id / vehicle_id: ambos anulables, al menos uno presente.
--      Un doc de "compra"/"venta" lleva contact_id + vehicle_id (el
--      proceso de ESE contacto con ESE vehículo); uno "person" solo
--      contact_id; uno "vehicle" al menos vehicle_id.
--
-- La tabla `contact_documents` de 501 era nueva (sin datos reales), así
-- que se reemplaza en vez de migrar fila por fila.
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

-- ============================================================
-- 1. ENUM document_category
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_category') THEN
    CREATE TYPE document_category AS ENUM ('person', 'vehicle', 'purchase', 'sale');
  END IF;
END $$;

-- ============================================================
-- 2. Bucket contact-documents -> PRIVADO
-- ============================================================
UPDATE storage.buckets SET public = FALSE WHERE id = 'contact-documents';

-- Lectura account-scoped (reemplaza la lectura pública de 501). Habilita
-- que un miembro genere signed URLs solo para objetos de su cuenta. Las
-- políticas de INSERT/UPDATE/DELETE de 501 siguen válidas (mismo bucket).
DROP POLICY IF EXISTS "Contact documents are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Members can read contact documents" ON storage.objects;
CREATE POLICY "Members can read contact documents"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'contact-documents'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

-- ============================================================
-- 3. Tabla documents (reemplaza contact_documents)
-- ============================================================
DROP TABLE IF EXISTS contact_documents CASCADE;

CREATE TABLE IF NOT EXISTS documents (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id  UUID REFERENCES contacts(id) ON DELETE CASCADE,
  vehicle_id  UUID REFERENCES inventory_vehicles(id) ON DELETE CASCADE,
  category    document_category NOT NULL DEFAULT 'person',
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  file_name   TEXT NOT NULL,
  file_path   TEXT NOT NULL,   -- ruta del objeto en Storage (para signed URL y borrado)
  mime_type   TEXT,
  size_bytes  BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Un documento debe colgar de un contacto y/o de un vehículo.
  CONSTRAINT documents_entity_present
    CHECK (contact_id IS NOT NULL OR vehicle_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_documents_contact
  ON documents (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_vehicle
  ON documents (vehicle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_account
  ON documents (account_id);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- Mismo patrón que contacts / inventory: lectura para miembros; escritura
-- para rol 'agent' o superior.
DROP POLICY IF EXISTS documents_select ON documents;
CREATE POLICY documents_select ON documents FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS documents_insert ON documents;
CREATE POLICY documents_insert ON documents FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS documents_update ON documents;
CREATE POLICY documents_update ON documents FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS documents_delete ON documents;
CREATE POLICY documents_delete ON documents FOR DELETE
  USING (is_account_member(account_id, 'agent'));
