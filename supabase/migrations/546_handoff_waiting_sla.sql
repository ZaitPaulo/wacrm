-- ============================================================
-- 546_handoff_waiting_sla.sql
--
-- El bot acompaña mientras llega el asesor, y un traspaso sin atender
-- avisa (cambio bot-fase-2-traspaso-sin-perdidas).
--
-- Revisión del 2026-09-29: de 106 traspasos, en 75 el cliente siguió
-- escribiendo sin que nadie le contestara (129 mensajes), 14 nunca
-- recibieron respuesta y la mediana en horario fue de 2,3 h. El bot se
-- callaba en el traspaso y nadie más que el asesor se enteraba.
--
-- 1. `conversations.ai_waiting_agent_since`: el traspaso la pone; el
--    primer mensaje de una persona desde la bandeja, "Tomar el control" y
--    "Reactivar IA" la limpian. La espera es `ai_autoreply_disabled AND
--    ai_waiting_agent_since IS NOT NULL`: la pausa sigue siendo la misma
--    bandera de siempre, así que el banner, la reactivación del lead que
--    vuelve (538) y "Tomar el control" no cambian.
-- 2. `handoff_reminded_at` / `handoff_escalated_at`: un aviso de cada uno
--    por traspaso. El job los marca con un UPDATE condicional antes de
--    avisar, así dos pasadas simultáneas no duplican.
-- 3. Plazos en `assignment_settings`, en minutos de horario de atención.
--    NULL apaga la regla. Decisión del Director (2026-09-29): 15 minutos
--    recordatorio al asesor, 45 aviso a owner/admin; no se reasigna.
-- 4. Tipos de notificación nuevos. El push sale solo (trigger de la 542).
--
-- Columnas nuevas en tablas existentes: heredan los GRANT de su tabla.
-- Idempotente.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_waiting_agent_since TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS handoff_reminded_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS handoff_escalated_at   TIMESTAMPTZ;

COMMENT ON COLUMN conversations.ai_waiting_agent_since IS
  'Desde cuándo el hilo espera el primer mensaje del asesor tras un traspaso del bot. Con ai_autoreply_disabled = true, el bot responde en modo espera. NULL = no espera.';
COMMENT ON COLUMN conversations.handoff_reminded_at IS
  'Cuándo se le recordó al asesor el traspaso sin atender. Se reinicia en cada traspaso.';
COMMENT ON COLUMN conversations.handoff_escalated_at IS
  'Cuándo se avisó a owner/admin del traspaso sin atender. Se reinicia en cada traspaso.';

-- El job barre solo las que esperan: pocas filas, índice chico.
CREATE INDEX IF NOT EXISTS idx_conversations_waiting_agent
  ON conversations(ai_waiting_agent_since)
  WHERE ai_waiting_agent_since IS NOT NULL;

ALTER TABLE assignment_settings
  ADD COLUMN IF NOT EXISTS handoff_remind_after_minutes   INTEGER DEFAULT 15,
  ADD COLUMN IF NOT EXISTS handoff_escalate_after_minutes INTEGER DEFAULT 45;

ALTER TABLE assignment_settings DROP CONSTRAINT IF EXISTS assignment_settings_handoff_remind_check;
ALTER TABLE assignment_settings ADD CONSTRAINT assignment_settings_handoff_remind_check
  CHECK (handoff_remind_after_minutes BETWEEN 1 AND 1440);

ALTER TABLE assignment_settings DROP CONSTRAINT IF EXISTS assignment_settings_handoff_escalate_check;
ALTER TABLE assignment_settings ADD CONSTRAINT assignment_settings_handoff_escalate_check
  CHECK (handoff_escalate_after_minutes BETWEEN 1 AND 1440);

-- Avisar a los administradores antes que al propio asesor no tiene
-- sentido: con los dos activos, el escalamiento va después.
ALTER TABLE assignment_settings DROP CONSTRAINT IF EXISTS assignment_settings_handoff_order_check;
ALTER TABLE assignment_settings ADD CONSTRAINT assignment_settings_handoff_order_check
  CHECK (
    handoff_remind_after_minutes IS NULL
    OR handoff_escalate_after_minutes IS NULL
    OR handoff_escalate_after_minutes > handoff_remind_after_minutes
  );

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'conversation_assigned',
    'new_message',
    'handoff_reminder',
    'handoff_unattended'
  ));
