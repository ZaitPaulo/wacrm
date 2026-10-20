-- ============================================================
-- Prueba de la migración 553 (cambio hoja-de-vida-contacto, D1):
-- los contactos son del negocio, pero atender sigue siendo del asignado.
--
-- Corre dentro de una transacción que termina en ROLLBACK: no deja nada.
--
--   MSYS_NO_PATHCONV=1 docker cp supabase/tests/contact_visibility_business.test.sql supabase_db_02-crm:/tmp/cvb.sql
--   MSYS_NO_PATHCONV=1 docker exec supabase_db_02-crm psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/cvb.sql
-- ============================================================
\set QUIET on
BEGIN;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email, aud, role, is_sso_user, is_anonymous) VALUES
  ('00000000-0000-4000-8000-000000000531', 'cvb-owner@test.local',  'authenticated', 'authenticated', false, false),
  ('00000000-0000-4000-8000-000000000532', 'cvb-agent1@test.local', 'authenticated', 'authenticated', false, false),
  ('00000000-0000-4000-8000-000000000533', 'cvb-agent2@test.local', 'authenticated', 'authenticated', false, false),
  ('00000000-0000-4000-8000-000000000534', 'cvb-viewer@test.local', 'authenticated', 'authenticated', false, false),
  ('00000000-0000-4000-8000-000000000535', 'cvb-other@test.local',  'authenticated', 'authenticated', false, false);
SET LOCAL session_replication_role = origin;

INSERT INTO accounts (id, name, owner_user_id, default_currency) VALUES
  ('00000000-0000-4000-8000-0000000005c1', 'CVB A', '00000000-0000-4000-8000-000000000531', 'COP'),
  ('00000000-0000-4000-8000-0000000005c2', 'CVB B', '00000000-0000-4000-8000-000000000535', 'COP');

INSERT INTO profiles (user_id, full_name, email, account_id, account_role) VALUES
  ('00000000-0000-4000-8000-000000000531', 'Owner',  'cvb-owner@test.local',  '00000000-0000-4000-8000-0000000005c1', 'owner'),
  ('00000000-0000-4000-8000-000000000532', 'Agente1','cvb-agent1@test.local', '00000000-0000-4000-8000-0000000005c1', 'agent'),
  ('00000000-0000-4000-8000-000000000533', 'Agente2','cvb-agent2@test.local', '00000000-0000-4000-8000-0000000005c1', 'agent'),
  ('00000000-0000-4000-8000-000000000534', 'Viewer', 'cvb-viewer@test.local', '00000000-0000-4000-8000-0000000005c1', 'viewer'),
  ('00000000-0000-4000-8000-000000000535', 'Otro',   'cvb-other@test.local',  '00000000-0000-4000-8000-0000000005c2', 'owner');

-- c1 lo atiende el agente 1; c2 el agente 2; c3 no tiene conversación;
-- cx es de la otra cuenta.
INSERT INTO contacts (id, user_id, account_id, phone, name) VALUES
  ('00000000-0000-4000-8000-0000000c0001', '00000000-0000-4000-8000-000000000531', '00000000-0000-4000-8000-0000000005c1', '573000000001', 'Cliente uno'),
  ('00000000-0000-4000-8000-0000000c0002', '00000000-0000-4000-8000-000000000531', '00000000-0000-4000-8000-0000000005c1', '573000000002', 'Cliente dos'),
  ('00000000-0000-4000-8000-0000000c0003', '00000000-0000-4000-8000-000000000531', '00000000-0000-4000-8000-0000000005c1', '573000000003', 'Cliente tres'),
  ('00000000-0000-4000-8000-0000000c0009', '00000000-0000-4000-8000-000000000535', '00000000-0000-4000-8000-0000000005c2', '573000000009', 'Ajeno');

INSERT INTO conversations (id, user_id, account_id, contact_id, assigned_agent_id, last_message_at) VALUES
  ('00000000-0000-4000-8000-0000000d0001', '00000000-0000-4000-8000-000000000531', '00000000-0000-4000-8000-0000000005c1', '00000000-0000-4000-8000-0000000c0001', '00000000-0000-4000-8000-000000000532', NOW()),
  ('00000000-0000-4000-8000-0000000d0002', '00000000-0000-4000-8000-000000000531', '00000000-0000-4000-8000-0000000005c1', '00000000-0000-4000-8000-0000000c0002', '00000000-0000-4000-8000-000000000533', NOW());

INSERT INTO messages (conversation_id, sender_type, content_text) VALUES
  ('00000000-0000-4000-8000-0000000d0002', 'customer', 'hola');

INSERT INTO contact_notes (contact_id, account_id, user_id, note_text) VALUES
  ('00000000-0000-4000-8000-0000000c0002', '00000000-0000-4000-8000-0000000005c1', '00000000-0000-4000-8000-000000000533', 'nota de agente 2');

CREATE TEMP TABLE r (k TEXT, n BIGINT);
GRANT ALL ON r TO authenticated;

-- ---- Agente 1 ---------------------------------------------------
SELECT FROM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000532","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

INSERT INTO r SELECT 'contacts', COUNT(*) FROM contacts
  WHERE id::TEXT LIKE '00000000-0000-4000-8000-0000000c%';
INSERT INTO r SELECT 'notes', COUNT(*) FROM contact_notes
  WHERE contact_id = '00000000-0000-4000-8000-0000000c0002';
INSERT INTO r SELECT 'convs_ajenas', COUNT(*) FROM conversations
  WHERE id = '00000000-0000-4000-8000-0000000d0002';
INSERT INTO r SELECT 'msgs_ajenos', COUNT(*) FROM messages
  WHERE conversation_id = '00000000-0000-4000-8000-0000000d0002';

WITH u AS (
  UPDATE contacts SET name = 'cambiado' WHERE id = '00000000-0000-4000-8000-0000000c0002' RETURNING 1
) INSERT INTO r SELECT 'update_ajeno', COUNT(*) FROM u;
WITH u AS (
  DELETE FROM contacts WHERE id = '00000000-0000-4000-8000-0000000c0002' RETURNING 1
) INSERT INTO r SELECT 'delete_ajeno', COUNT(*) FROM u;
WITH u AS (
  UPDATE contacts SET email = 'uno@x.co' WHERE id = '00000000-0000-4000-8000-0000000c0001' RETURNING 1
) INSERT INTO r SELECT 'update_propio', COUNT(*) FROM u;

INSERT INTO contact_notes (contact_id, account_id, user_id, note_text) VALUES
  ('00000000-0000-4000-8000-0000000c0002', '00000000-0000-4000-8000-0000000005c1', '00000000-0000-4000-8000-000000000532', 'nota de agente 1 en contacto ajeno');
INSERT INTO r SELECT 'assignees', COUNT(*) FROM get_contact_assignees(ARRAY[
  '00000000-0000-4000-8000-0000000c0001', '00000000-0000-4000-8000-0000000c0002',
  '00000000-0000-4000-8000-0000000c0009']::UUID[]);

-- Firmar una nota a nombre de otro: rechazado.
DO $$
BEGIN
  BEGIN
    INSERT INTO contact_notes (contact_id, account_id, user_id, note_text) VALUES
      ('00000000-0000-4000-8000-0000000c0002', '00000000-0000-4000-8000-0000000005c1', '00000000-0000-4000-8000-000000000533', 'suplantada');
    INSERT INTO r VALUES ('nota_suplantada', 1);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO r VALUES ('nota_suplantada', 0);
  END;
END $$;
RESET ROLE;

-- ---- Viewer -----------------------------------------------------
SELECT FROM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000534","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO r SELECT 'viewer_contacts', COUNT(*) FROM contacts
  WHERE id::TEXT LIKE '00000000-0000-4000-8000-0000000c%';
DO $$
BEGIN
  BEGIN
    INSERT INTO contact_notes (contact_id, account_id, user_id, note_text) VALUES
      ('00000000-0000-4000-8000-0000000c0001', '00000000-0000-4000-8000-0000000005c1', '00000000-0000-4000-8000-000000000534', 'viewer');
    INSERT INTO r VALUES ('viewer_nota', 1);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO r VALUES ('viewer_nota', 0);
  END;
END $$;
RESET ROLE;

-- ---- Verificación -----------------------------------------------
DO $$
DECLARE
  v_expected CONSTANT JSONB := '{
    "contacts": 3, "notes": 1, "convs_ajenas": 0, "msgs_ajenos": 0,
    "update_ajeno": 0, "delete_ajeno": 0, "update_propio": 1,
    "assignees": 2, "nota_suplantada": 0,
    "viewer_contacts": 3, "viewer_nota": 0
  }';
  v_key TEXT;
  v_got BIGINT;
BEGIN
  FOR v_key IN SELECT jsonb_object_keys(v_expected) LOOP
    SELECT n INTO v_got FROM r WHERE r.k = v_key;
    IF v_got IS DISTINCT FROM (v_expected->>v_key)::BIGINT THEN
      RAISE EXCEPTION 'FALLA %: esperaba %, obtuvo %', v_key, v_expected->>v_key, v_got;
    END IF;
    RAISE NOTICE 'ok  % = %', v_key, v_got;
  END LOOP;

  -- La nota del agente 1 en el contacto ajeno quedó a su nombre.
  IF NOT EXISTS (
    SELECT 1 FROM contact_notes
    WHERE contact_id = '00000000-0000-4000-8000-0000000c0002'
      AND user_id = '00000000-0000-4000-8000-000000000532'
  ) THEN
    RAISE EXCEPTION 'FALLA nota en contacto ajeno no se guardó';
  END IF;
  RAISE NOTICE 'ok  nota en contacto ajeno guardada a nombre de quien la escribe';

  IF (SELECT name FROM contacts WHERE id = '00000000-0000-4000-8000-0000000c0002') <> 'Cliente dos' THEN
    RAISE EXCEPTION 'FALLA el contacto ajeno cambió';
  END IF;
  RAISE NOTICE 'ok  el contacto ajeno no cambió';
END $$;

-- ---- Otra cuenta ------------------------------------------------
SELECT FROM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000535","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM contacts WHERE account_id = '00000000-0000-4000-8000-0000000005c1') THEN
    RAISE EXCEPTION 'FALLA otra cuenta ve contactos ajenos';
  END IF;
  IF EXISTS (SELECT 1 FROM contact_notes WHERE account_id = '00000000-0000-4000-8000-0000000005c1') THEN
    RAISE EXCEPTION 'FALLA otra cuenta ve notas ajenas';
  END IF;
  IF EXISTS (SELECT 1 FROM get_contact_assignees(ARRAY['00000000-0000-4000-8000-0000000c0001']::UUID[])) THEN
    RAISE EXCEPTION 'FALLA otra cuenta ve asesores ajenos';
  END IF;
  RAISE NOTICE 'ok  otra cuenta no ve contactos, notas ni asesores';
END $$;
RESET ROLE;

ROLLBACK;
