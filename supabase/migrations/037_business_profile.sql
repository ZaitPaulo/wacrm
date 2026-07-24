-- ============================================================
-- 037_business_profile.sql
--
-- Perfil público del negocio para la vitrina (se muestra en el footer).
-- Se parametriza desde el CRM (Ajustes → Public showcase). Todo texto
-- libre y opcional:
--
--   public_name      — nombre comercial (fallback: accounts.name)
--   public_logo_url  — URL del logo
--   public_address   — dirección física
--   public_phone     — teléfono de contacto (display / fijo)
--   public_email     — correo de contacto
--   public_hours     — horario de atención
--
-- Idempotente.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS public_name     TEXT,
  ADD COLUMN IF NOT EXISTS public_logo_url TEXT,
  ADD COLUMN IF NOT EXISTS public_address  TEXT,
  ADD COLUMN IF NOT EXISTS public_phone    TEXT,
  ADD COLUMN IF NOT EXISTS public_email    TEXT,
  ADD COLUMN IF NOT EXISTS public_hours    TEXT;
