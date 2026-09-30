-- ============================================================
-- 547_ai_credit_max_vehicle_age.sql
--
-- Antigüedad máxima para crédito vehicular (cambio bot-fase-3-reglas-negocio).
--
-- Revisión del 2026-09-29: 18 de los 60 traspasos por crédito fueron de
-- carros que los bancos no financian (Aveo 2013, Sandero 2010…), y el bot
-- llegó a decir que todos aplicaban. Lora Motors confirmó ese día: el
-- crédito vehicular aplica hasta 10 años desde la fecha de matrícula.
--
-- El inventario no guarda la matrícula; el bot la aproxima con el año del
-- modelo y marca el año límite "por confirmar" (ver src/lib/ai/inventory-index.ts).
-- NULL apaga la regla. Columna nueva en tabla existente: hereda sus GRANT.
-- Idempotente.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS credit_max_vehicle_age_years INTEGER DEFAULT 10;

ALTER TABLE ai_configs DROP CONSTRAINT IF EXISTS ai_configs_credit_max_vehicle_age_check;
ALTER TABLE ai_configs ADD CONSTRAINT ai_configs_credit_max_vehicle_age_check
  CHECK (credit_max_vehicle_age_years BETWEEN 1 AND 40);

COMMENT ON COLUMN ai_configs.credit_max_vehicle_age_years IS
  'Años máximos desde la matrícula para que un vehículo aplique a crédito vehicular. El bot lo aproxima con el año del modelo. NULL = sin regla.';
