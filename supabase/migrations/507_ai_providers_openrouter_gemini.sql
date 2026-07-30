-- ============================================================
-- 507_ai_providers_openrouter_gemini.sql
--
-- Habilita OpenRouter y Google Gemini como proveedores de IA.
--
-- `ai_configs.provider` (029) y `ai_usage_log.provider` (033) declaran
-- el proveedor con un CHECK inline restringido a ('openai','anthropic'),
-- así que sin ampliarlo cualquier INSERT/UPDATE con los valores nuevos
-- falla con violación de constraint — tanto al guardar la config como al
-- registrar el consumo de tokens.
--
-- Postgres nombra los CHECK inline como <tabla>_<columna>_check, de modo
-- que se reemplazan por nombre. Solo se amplía el dominio permitido: las
-- filas existentes siguen siendo válidas y no hay backfill.
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

-- ============================================================
-- 1. ai_configs.provider
-- ============================================================
ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_provider_check;

ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'openrouter', 'gemini'));

-- ============================================================
-- 2. ai_usage_log.provider
--
-- La tabla nace en 033 (upstream). El guard evita que esta migración
-- falle en una base donde 033 todavía no corrió.
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ai_usage_log'
  ) THEN
    ALTER TABLE ai_usage_log
      DROP CONSTRAINT IF EXISTS ai_usage_log_provider_check;

    ALTER TABLE ai_usage_log
      ADD CONSTRAINT ai_usage_log_provider_check
      CHECK (provider IN ('openai', 'anthropic', 'openrouter', 'gemini'));
  END IF;
END $$;
