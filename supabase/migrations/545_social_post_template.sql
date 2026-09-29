-- ============================================================
-- 545_social_post_template.sql
--
-- Plantilla del texto con que se propone publicar un vehículo en las
-- redes (Facebook e Instagram). Se edita desde Ajustes → Publicaciones.
--
--   social_post_template — texto por líneas con variables `{marca}`,
--                          `{precio}`, etc. (ver src/lib/social/caption.ts).
--                          NULL = la plantilla por defecto del catálogo
--                          (`SocialPost.defaultTemplate`).
--
-- Columna nueva en una tabla que ya tiene RLS y GRANT: no hace falta
-- tocar políticas. Idempotente.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS social_post_template TEXT;
