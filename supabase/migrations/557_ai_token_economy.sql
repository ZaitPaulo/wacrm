-- ============================================================
-- 557_ai_token_economy.sql
--
-- Menos consumo de Gemini (cambio reducir-consumo-gemini).
--
-- Medición del 08 al 16/10/2026: una recarga de 60.000 duró ~8,5 días,
-- con ~18,2 k tokens de entrada por llamada, y el saldo se agotó dos
-- veces en octubre sin que nadie se enterara. Esta migración:
--
--   1. ai_usage_log.cached_tokens — tokens de entrada que Gemini sirvió
--      desde su caché implícito. `prompt_tokens` sigue siendo el total.
--   2. ai_configs.billing_alerted_at — último aviso de saldo agotado, para
--      no avisar más de una vez cada 6 h.
--   3. ai_configs.business_hours_reply_budget_* — tope de respuestas del
--      bot en horario laboral. Apagado por defecto.
--   4. notifications: tipo `ai_billing_exhausted`.
--
-- Columnas nuevas en tablas existentes: heredan sus GRANT. Idempotente.
-- La 556 la reserva el cambio informe-gestion-whatsapp-pdf.
-- ============================================================

-- 1. Tokens cacheados
ALTER TABLE ai_usage_log
  ADD COLUMN IF NOT EXISTS cached_tokens INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN ai_usage_log.cached_tokens IS
  'Tokens de entrada servidos desde el caché del proveedor (incluidos en prompt_tokens). 0 si el proveedor no lo informa.';

-- 2. Aviso de saldo agotado
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS billing_alerted_at TIMESTAMPTZ;

COMMENT ON COLUMN ai_configs.billing_alerted_at IS
  'Último aviso a owner/admin de que el saldo del proveedor se agotó. Se reclama atómicamente; un aviso cada 6 h como máximo.';

-- 3. Presupuesto de respuestas en horario laboral
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS business_hours_reply_budget_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS business_hours_reply_budget INTEGER NOT NULL DEFAULT 3;

ALTER TABLE ai_configs DROP CONSTRAINT IF EXISTS ai_configs_business_hours_reply_budget_check;
ALTER TABLE ai_configs ADD CONSTRAINT ai_configs_business_hours_reply_budget_check
  CHECK (business_hours_reply_budget BETWEEN 1 AND 20);

COMMENT ON COLUMN ai_configs.business_hours_reply_budget_enabled IS
  'En horario laboral: desde la respuesta N el bot cierra hacia el traspaso, y en espera del asesor no responde.';
COMMENT ON COLUMN ai_configs.business_hours_reply_budget IS
  'N: respuestas del bot por conversación en horario antes de cerrar hacia el traspaso (1–20).';

-- 4. notifications: tipo nuevo
-- ATENCIÓN: este CHECK se reescribe entero. Lleva TODOS los tipos de la
-- 549 más el nuevo; uno que falte rompe en silencio los avisos de esa
-- función.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    -- 027 / 541
    'conversation_assigned',
    'new_message',
    -- 546
    'handoff_reminder',
    'handoff_unattended',
    -- 548
    'appointment_assigned',
    'appointment_change_requested',
    'appointment_digest',
    -- 549
    'appointment_vehicle_unavailable',
    'appointment_pre_visit',
    'appointment_customer_confirmed',
    'appointment_updated',
    'appointment_unassigned',
    'appointment_attendance_pending',
    'appointment_no_show',
    -- 557
    'ai_billing_exhausted'
  ));
