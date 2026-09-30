-- ============================================================
-- Prueba de la migración 546 (cambio bot-fase-2-traspaso-sin-perdidas).
--
-- Corre dentro de una transacción que termina en ROLLBACK: no deja nada.
--
--   MSYS_NO_PATHCONV=1 docker cp supabase/tests/handoff_waiting_sla.test.sql supabase_db_02-crm:/tmp/hws.sql
--   MSYS_NO_PATHCONV=1 docker exec supabase_db_02-crm psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/hws.sql
-- ============================================================
\set QUIET on
BEGIN;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email, aud, role, is_sso_user, is_anonymous) VALUES
  ('00000000-0000-4000-8000-000000000510', 'hws-owner@test.local', 'authenticated', 'authenticated', false, false);
SET LOCAL session_replication_role = origin;

INSERT INTO accounts (id, name, owner_user_id, default_currency) VALUES
  ('00000000-0000-4000-8000-0000000005a1', 'HWS test', '00000000-0000-4000-8000-000000000510', 'COP');

INSERT INTO profiles (user_id, full_name, email, account_id, account_role) VALUES
  ('00000000-0000-4000-8000-000000000510', 'Owner', 'hws-owner@test.local', '00000000-0000-4000-8000-0000000005a1', 'owner');

-- Los plazos nacen en 15 y 45.
DO $$
DECLARE s assignment_settings;
BEGIN
  INSERT INTO assignment_settings (account_id) VALUES ('00000000-0000-4000-8000-0000000005a1')
  ON CONFLICT (account_id) DO NOTHING;
  SELECT * INTO s FROM assignment_settings WHERE account_id = '00000000-0000-4000-8000-0000000005a1';
  IF s.handoff_remind_after_minutes IS DISTINCT FROM 15 OR s.handoff_escalate_after_minutes IS DISTINCT FROM 45 THEN
    RAISE EXCEPTION 'FALLA plazos por defecto: % / %', s.handoff_remind_after_minutes, s.handoff_escalate_after_minutes;
  END IF;
  RAISE NOTICE 'ok  plazos por defecto 15 / 45';
END $$;

-- El escalamiento no puede ir antes que el recordatorio.
DO $$
BEGIN
  BEGIN
    UPDATE assignment_settings
      SET handoff_remind_after_minutes = 45, handoff_escalate_after_minutes = 15
      WHERE account_id = '00000000-0000-4000-8000-0000000005a1';
    RAISE EXCEPTION 'FALLA plazos invertidos aceptados';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok  plazos invertidos rechazados';
  END;
END $$;

-- Apagar una regla (NULL) es válido.
DO $$
BEGIN
  UPDATE assignment_settings
    SET handoff_remind_after_minutes = NULL, handoff_escalate_after_minutes = 30
    WHERE account_id = '00000000-0000-4000-8000-0000000005a1';
  RAISE NOTICE 'ok  recordatorio apagado con escalamiento activo';
END $$;

-- Los tipos de notificación nuevos se aceptan; uno inventado, no.
DO $$
BEGIN
  INSERT INTO notifications (account_id, user_id, type, title) VALUES
    ('00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-000000000510', 'handoff_reminder', 'Cliente esperando'),
    ('00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-000000000510', 'handoff_unattended', 'Traspaso sin atender');
  RAISE NOTICE 'ok  tipos handoff_reminder y handoff_unattended aceptados';
  BEGIN
    INSERT INTO notifications (account_id, user_id, type, title) VALUES
      ('00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-000000000510', 'inventado', 'x');
    RAISE EXCEPTION 'FALLA tipo inventado aceptado';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok  tipo inventado rechazado';
  END;
END $$;

-- Las columnas de la conversación existen y nacen nulas.
DO $$
DECLARE c RECORD;
BEGIN
  SELECT column_name INTO c FROM information_schema.columns
   WHERE table_name = 'conversations' AND column_name = 'ai_waiting_agent_since';
  IF NOT FOUND THEN RAISE EXCEPTION 'FALLA falta ai_waiting_agent_since'; END IF;
  RAISE NOTICE 'ok  columnas de espera presentes';
END $$;

ROLLBACK;
