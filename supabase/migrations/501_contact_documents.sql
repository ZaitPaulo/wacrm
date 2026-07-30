-- ============================================================
-- 501_contact_documents.sql
--
-- Documentación por lead/contacto: bucket de Storage + tabla de
-- metadatos que vincula cada archivo al contact_id.
--
-- El bucket 'contact-documents' está calcado de 023_chat_media:
-- público, con path account-scoped 'account-<account_id>/...' (así lo
-- construye el helper uploadAccountMedia de src/lib/storage). Solo
-- acepta PDF e imágenes.
--
-- NOTA de privacidad: igual que chat-media / avatars, el bucket es
-- PÚBLICO (lectura por URL). El listado real está protegido por la RLS
-- de contact_documents (solo miembros de la cuenta lo ven), pero el
-- objeto crudo es accesible por su URL si se filtra. Si más adelante se
-- quiere blindar (documentos sensibles), se migra a bucket privado +
-- signed URLs.
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

-- ============================================================
-- 1. Bucket contact-documents
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'contact-documents',
  'contact-documents',
  TRUE,
  16777216, -- 16 MB (mismo tope que MEDIA_MAX_BYTES / migraciones 016/020/023)
  ARRAY[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================================
-- 2. Storage RLS — escritura account-scoped, lectura pública
--    (mismo predicado que migración 023: primer segmento del path =
--    'account-<account_id>' de una cuenta a la que pertenece el caller).
-- ============================================================
DROP POLICY IF EXISTS "Contact documents are publicly readable" ON storage.objects;
CREATE POLICY "Contact documents are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'contact-documents');

DROP POLICY IF EXISTS "Members can upload contact documents" ON storage.objects;
CREATE POLICY "Members can upload contact documents"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'contact-documents'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can update contact documents" ON storage.objects;
CREATE POLICY "Members can update contact documents"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'contact-documents'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can delete contact documents" ON storage.objects;
CREATE POLICY "Members can delete contact documents"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'contact-documents'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

-- ============================================================
-- 3. Tabla contact_documents (metadatos + vínculo al lead)
-- ============================================================
CREATE TABLE IF NOT EXISTS contact_documents (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id  UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  file_name   TEXT NOT NULL,
  file_path   TEXT NOT NULL,   -- ruta del objeto en Storage (para borrarlo)
  url         TEXT NOT NULL,   -- URL pública
  mime_type   TEXT,
  size_bytes  BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_documents_contact
  ON contact_documents (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_documents_account
  ON contact_documents (account_id);

ALTER TABLE contact_documents ENABLE ROW LEVEL SECURITY;

-- Mismo patrón que contacts / inventory: lectura para miembros; escritura
-- para rol 'agent' o superior.
DROP POLICY IF EXISTS contact_documents_select ON contact_documents;
CREATE POLICY contact_documents_select ON contact_documents FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS contact_documents_insert ON contact_documents;
CREATE POLICY contact_documents_insert ON contact_documents FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS contact_documents_update ON contact_documents;
CREATE POLICY contact_documents_update ON contact_documents FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS contact_documents_delete ON contact_documents;
CREATE POLICY contact_documents_delete ON contact_documents FOR DELETE
  USING (is_account_member(account_id, 'agent'));
