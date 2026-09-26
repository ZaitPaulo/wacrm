-- ============================================================
-- Prueba de la migración 543 (cambio asesor-ventas-y-permutas).
--
-- Corre entera dentro de una transacción que termina en ROLLBACK: no
-- deja nada. Cada bloque falla con una excepción que nombra el escenario.
--
--   MSYS_NO_PATHCONV=1 docker cp supabase/tests/trade_in_agent.test.sql supabase_db_02-crm:/tmp/tia.sql
--   MSYS_NO_PATHCONV=1 docker exec supabase_db_02-crm psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/tia.sql
-- ============================================================
\set QUIET on
BEGIN;

-- ------------------------------------------------------------
-- Fixtures: una cuenta aislada con owner, Angélica (admin) y dos agent.
-- ------------------------------------------------------------
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email, aud, role, is_sso_user, is_anonymous) VALUES
  ('00000000-0000-4000-9000-000000000010', 'tia-owner@test.local', 'authenticated', 'authenticated', false, false),
  ('00000000-0000-4000-9000-000000000011', 'tia-ange@test.local', 'authenticated', 'authenticated', false, false),
  ('00000000-0000-4000-9000-000000000021', 'tia-juan@test.local', 'authenticated', 'authenticated', false, false),
  ('00000000-0000-4000-9000-000000000022', 'tia-brayan@test.local', 'authenticated', 'authenticated', false, false);
SET LOCAL session_replication_role = origin;

INSERT INTO accounts (id, name, owner_user_id, default_currency) VALUES
  ('00000000-0000-4000-9000-0000000000a1', 'TIA test', '00000000-0000-4000-9000-000000000010', 'COP');

INSERT INTO profiles (id, user_id, full_name, email, account_id, account_role, created_at) VALUES
  ('00000000-0000-4000-9000-0000000000f0', '00000000-0000-4000-9000-000000000010', 'Owner', 'tia-owner@test.local', '00000000-0000-4000-9000-0000000000a1', 'owner', now() - interval '10 days'),
  ('00000000-0000-4000-9000-0000000000f1', '00000000-0000-4000-9000-000000000011', 'Angélica María Molero', 'tia-ange@test.local', '00000000-0000-4000-9000-0000000000a1', 'admin', now() - interval '9 days'),
  ('00000000-0000-4000-9000-0000000000f2', '00000000-0000-4000-9000-000000000021', 'Juan Arias', 'tia-juan@test.local', '00000000-0000-4000-9000-0000000000a1', 'agent', now() - interval '8 days'),
  ('00000000-0000-4000-9000-0000000000f3', '00000000-0000-4000-9000-000000000022', 'Brayan Gómez', 'tia-brayan@test.local', '00000000-0000-4000-9000-0000000000a1', 'agent', now() - interval '7 days');

INSERT INTO pipelines (id, user_id, name, account_id) VALUES
  ('00000000-0000-4000-9000-0000000000b1', '00000000-0000-4000-9000-000000000010', 'Ventas', '00000000-0000-4000-9000-0000000000a1');
INSERT INTO pipeline_stages (id, pipeline_id, name, position, color) VALUES
  ('00000000-0000-4000-9000-0000000000c1', '00000000-0000-4000-9000-0000000000b1', 'Prospecto', 0, '#000');

INSERT INTO assignment_settings (account_id, trade_in_agent_id) VALUES
  ('00000000-0000-4000-9000-0000000000a1', '00000000-0000-4000-9000-000000000011');

INSERT INTO contacts (id, user_id, account_id, name, phone)
SELECT ('00000000-0000-4000-9000-0000000001' || lpad(i::text, 2, '0'))::uuid,
       '00000000-0000-4000-9000-000000000010', '00000000-0000-4000-9000-0000000000a1',
       'Cliente ' || i, '5731000000' || lpad(i::text, 2, '0')
FROM generate_series(1, 10) i;

-- conv(i) = la conversación del contacto i, con el asesor que se pida.
CREATE TEMP TABLE t_conv (i int PRIMARY KEY, id uuid) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION pg_temp.new_conv(p_i int, p_agent uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
  INSERT INTO conversations (user_id, contact_id, account_id, assigned_agent_id)
  VALUES ('00000000-0000-4000-9000-000000000010',
          ('00000000-0000-4000-9000-0000000001' || lpad(p_i::text, 2, '0'))::uuid,
          '00000000-0000-4000-9000-0000000000a1', p_agent)
  RETURNING id INTO v;
  INSERT INTO t_conv VALUES (p_i, v);
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.conv(p_i int) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM t_conv WHERE i = p_i $$;
CREATE OR REPLACE FUNCTION pg_temp.contact(p_i int) RETURNS uuid LANGUAGE sql AS $$
  SELECT ('00000000-0000-4000-9000-0000000001' || lpad(p_i::text, 2, '0'))::uuid $$;
CREATE OR REPLACE FUNCTION pg_temp.agent_of(p_i int) RETURNS uuid LANGUAGE sql AS $$
  SELECT assigned_agent_id FROM conversations WHERE id = pg_temp.conv(p_i) $$;
CREATE OR REPLACE FUNCTION pg_temp.fail(p_scenario text, p_detail text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'FALLA [%]: %', p_scenario, p_detail; END $$;

-- ============================================================
-- Venta de un lead nuevo → Angélica, con source 'reason'
-- ============================================================
DO $$
DECLARE r jsonb;
BEGIN
  PERFORM pg_temp.new_conv(1);
  r := ai_handoff_assign(pg_temp.conv(1), 'nota', 'Luis — Citroën C3', 'vende_su_carro');
  IF r->>'outcome' <> 'assigned' OR r->>'source' <> 'reason'
     OR pg_temp.agent_of(1) <> '00000000-0000-4000-9000-000000000011' THEN
    PERFORM pg_temp.fail('venta lead nuevo', r::text);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM conversation_assignments
                 WHERE conversation_id = pg_temp.conv(1) AND source = 'reason' AND origin = 'ai_handoff') THEN
    PERFORM pg_temp.fail('venta lead nuevo', 'el historial no dice source=reason');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM deals WHERE contact_id = pg_temp.contact(1)
                 AND title = 'Luis — Citroën C3' AND assigned_to = '00000000-0000-4000-9000-0000000000f1') THEN
    PERFORM pg_temp.fail('venta lead nuevo', 'no se creó el negocio a nombre de Angélica');
  END IF;
  RAISE NOTICE 'ok  venta de lead nuevo: va a Angélica con su negocio';
END $$;

-- ============================================================
-- Permuta de un cliente de Juan → pasa a Angélica, su negocio también,
-- el de Brayan no, y Juan recibe el aviso
-- ============================================================
DO $$
DECLARE r jsonb;
BEGIN
  SET LOCAL crm.assignment_override = 'on';
  PERFORM pg_temp.new_conv(2, '00000000-0000-4000-9000-000000000021');
  SET LOCAL crm.assignment_override = '';

  -- El trigger de la 536 le abrió el negocio a Juan. Uno de Brayan aparte.
  INSERT INTO deals (account_id, user_id, pipeline_id, stage_id, contact_id, title, value, currency, status, assigned_to)
  VALUES ('00000000-0000-4000-9000-0000000000a1', '00000000-0000-4000-9000-000000000010',
          '00000000-0000-4000-9000-0000000000b1', '00000000-0000-4000-9000-0000000000c1',
          pg_temp.contact(2), 'de Brayan', 0, 'COP', 'open', '00000000-0000-4000-9000-0000000000f3');

  r := ai_handoff_assign(pg_temp.conv(2), 'nota', NULL, 'permuta');
  IF r->>'source' <> 'reason' OR pg_temp.agent_of(2) <> '00000000-0000-4000-9000-000000000011' THEN
    PERFORM pg_temp.fail('permuta con asesor', r::text);
  END IF;
  IF EXISTS (SELECT 1 FROM deals WHERE contact_id = pg_temp.contact(2) AND status = 'open'
             AND assigned_to = '00000000-0000-4000-9000-0000000000f2') THEN
    PERFORM pg_temp.fail('permuta con asesor', 'el negocio de Juan no pasó a Angélica');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM deals WHERE contact_id = pg_temp.contact(2)
                 AND title = 'de Brayan' AND assigned_to = '00000000-0000-4000-9000-0000000000f3') THEN
    PERFORM pg_temp.fail('permuta con asesor', 'movió el negocio de Brayan');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM notifications
                 WHERE user_id = '00000000-0000-4000-9000-000000000021'
                   AND conversation_id = pg_temp.conv(2)
                   AND title = 'Tu cliente pasó a Angélica'
                   AND body LIKE '%Motivo: permuta') THEN
    PERFORM pg_temp.fail('permuta con asesor', 'Juan no recibió el aviso');
  END IF;
  IF COALESCE(current_setting('crm.assignment_override', true), '') <> '' THEN
    PERFORM pg_temp.fail('permuta con asesor', 'el override quedó encendido');
  END IF;
  RAISE NOTICE 'ok  permuta de un cliente de Juan: pasa a Angélica, con negocio y aviso';
END $$;

-- La guarda sigue viva después: otra escritura sin sesión no le quita
-- la conversación a Angélica.
DO $$
BEGIN
  UPDATE conversations SET assigned_agent_id = '00000000-0000-4000-9000-000000000022'
  WHERE id = pg_temp.conv(2);
  IF pg_temp.agent_of(2) <> '00000000-0000-4000-9000-000000000011' THEN
    PERFORM pg_temp.fail('guarda intacta', 'una escritura sin sesión reasignó');
  END IF;
  RAISE NOTICE 'ok  la guarda de la 535 sigue activa tras el traspaso';
END $$;

-- ============================================================
-- Ya estaba con Angélica → kept, sin aviso de "pasó a"
-- ============================================================
DO $$
DECLARE r jsonb;
BEGIN
  PERFORM pg_temp.new_conv(3, '00000000-0000-4000-9000-000000000011');
  r := ai_handoff_assign(pg_temp.conv(3), 'nota', NULL, 'permuta');
  IF r->>'outcome' <> 'kept' THEN
    PERFORM pg_temp.fail('ya era de Angélica', r::text);
  END IF;
  IF EXISTS (SELECT 1 FROM notifications WHERE conversation_id = pg_temp.conv(3) AND title LIKE 'Tu cliente pasó a%') THEN
    PERFORM pg_temp.fail('ya era de Angélica', 'mandó un aviso de reasignación');
  END IF;
  RAISE NOTICE 'ok  ya era de Angélica: se conserva';
END $$;

-- ============================================================
-- Motivo normal → orden de siempre (porcentajes entre los agent)
-- ============================================================
DO $$
DECLARE r jsonb;
BEGIN
  PERFORM pg_temp.new_conv(4);
  r := ai_handoff_assign(pg_temp.conv(4), 'nota', NULL, 'credito');
  IF r->>'source' <> 'weighted' OR pg_temp.agent_of(4) = '00000000-0000-4000-9000-000000000011' THEN
    PERFORM pg_temp.fail('motivo normal', r::text);
  END IF;
  RAISE NOTICE 'ok  motivo normal: reparto por porcentajes';
END $$;

-- ============================================================
-- 'reason' no consume cuota: los dos agent siguen parejos
-- ============================================================
DO $$
DECLARE r5 jsonb; r6 jsonb;
BEGIN
  PERFORM pg_temp.new_conv(5);
  PERFORM pg_temp.new_conv(6);
  r5 := ai_handoff_assign(pg_temp.conv(5), 'n', NULL, 'credito');
  r6 := ai_handoff_assign(pg_temp.conv(6), 'n', NULL, 'credito');
  -- Con conv 4, 5 y 6 van 3 reparticiones entre 2 agent: 2 y 1.
  IF (SELECT count(DISTINCT to_agent_id) FROM conversation_assignments
      WHERE account_id = '00000000-0000-4000-9000-0000000000a1' AND source = 'weighted') <> 2 THEN
    PERFORM pg_temp.fail('cuota', 'el reparto no alternó entre los agent');
  END IF;
  IF EXISTS (SELECT 1 FROM conversation_assignments
             WHERE account_id = '00000000-0000-4000-9000-0000000000a1' AND source = 'weighted'
               AND to_agent_id = '00000000-0000-4000-9000-000000000011') THEN
    PERFORM pg_temp.fail('cuota', 'Angélica entró al reparto');
  END IF;
  RAISE NOTICE 'ok  la asignación por motivo no consume cuota';
END $$;

-- ============================================================
-- Ajuste vacío, o la persona ya no es miembro → orden normal
-- ============================================================
DO $$
DECLARE r jsonb;
BEGIN
  UPDATE assignment_settings SET trade_in_agent_id = NULL
  WHERE account_id = '00000000-0000-4000-9000-0000000000a1';
  PERFORM pg_temp.new_conv(7);
  r := ai_handoff_assign(pg_temp.conv(7), 'n', NULL, 'vende_su_carro');
  IF r->>'source' <> 'weighted' THEN
    PERFORM pg_temp.fail('ajuste vacío', r::text);
  END IF;

  UPDATE assignment_settings SET trade_in_agent_id = gen_random_uuid()
  WHERE account_id = '00000000-0000-4000-9000-0000000000a1';
  PERFORM pg_temp.new_conv(8);
  r := ai_handoff_assign(pg_temp.conv(8), 'n', NULL, 'permuta');
  IF r->>'source' <> 'weighted' THEN
    PERFORM pg_temp.fail('no miembro', r::text);
  END IF;
  RAISE NOTICE 'ok  sin ajuste utilizable: orden normal';
END $$;

-- ============================================================
-- La llamada vieja de tres argumentos sigue funcionando
-- ============================================================
DO $$
DECLARE r jsonb;
BEGIN
  PERFORM pg_temp.new_conv(9);
  r := ai_handoff_assign(pg_temp.conv(9), 'n', NULL);
  IF r->>'outcome' <> 'assigned' THEN
    PERFORM pg_temp.fail('tres argumentos', r::text);
  END IF;
  RAISE NOTICE 'ok  la llamada de tres argumentos sigue igual';
END $$;

ROLLBACK;
