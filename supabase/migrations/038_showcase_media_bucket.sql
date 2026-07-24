-- ============================================================
-- 038_showcase_media_bucket.sql
--
-- Bucket PÚBLICO 'showcase-media' para los assets que la vitrina muestra
-- sin sesión: fotos de vehículos (inventory_vehicles.images) y el logo
-- del negocio (accounts.public_logo_url). Público para que la carga sea
-- directa/cacheable (getPublicUrl), sin firmar.
--
-- Calcado del patrón de 023_chat_media: escritura account-scoped por
-- el primer segmento del path `account-<account_id>/...` (así lo arma el
-- helper uploadAccountMedia de src/lib/storage), lectura pública. Solo
-- imágenes.
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'showcase-media',
  'showcase-media',
  TRUE,
  5242880, -- 5 MB por imagen
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Showcase media is publicly readable" ON storage.objects;
CREATE POLICY "Showcase media is publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'showcase-media');

DROP POLICY IF EXISTS "Members can upload showcase media" ON storage.objects;
CREATE POLICY "Members can upload showcase media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'showcase-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can update showcase media" ON storage.objects;
CREATE POLICY "Members can update showcase media"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'showcase-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can delete showcase media" ON storage.objects;
CREATE POLICY "Members can delete showcase media"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'showcase-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );
