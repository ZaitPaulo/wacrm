-- ============================================================
-- Prueba de la migración 547. Termina en ROLLBACK: no deja nada.
--
--   MSYS_NO_PATHCONV=1 docker cp supabase/tests/ai_credit_max_vehicle_age.test.sql supabase_db_02-crm:/tmp/acm.sql
--   MSYS_NO_PATHCONV=1 docker exec supabase_db_02-crm psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/acm.sql
-- ============================================================
\set QUIET on
BEGIN;

DO $$
DECLARE d TEXT;
BEGIN
  SELECT column_default INTO d FROM information_schema.columns
   WHERE table_name = 'ai_configs' AND column_name = 'credit_max_vehicle_age_years';
  IF d IS DISTINCT FROM '10' THEN
    RAISE EXCEPTION 'FALLA default de credit_max_vehicle_age_years: %', d;
  END IF;
  RAISE NOTICE 'ok  la regla nace en 10 años';
END $$;

DO $$
DECLARE ok BOOLEAN;
BEGIN
  SELECT pg_get_constraintdef(oid) LIKE '%BETWEEN 1 AND 40%' OR pg_get_constraintdef(oid) LIKE '%>= 1%' INTO ok
    FROM pg_constraint WHERE conname = 'ai_configs_credit_max_vehicle_age_check';
  IF NOT coalesce(ok, false) THEN
    RAISE EXCEPTION 'FALLA falta el CHECK de rango';
  END IF;
  RAISE NOTICE 'ok  CHECK de rango presente';
END $$;

ROLLBACK;
