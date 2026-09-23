-- ============================================================
-- Prueba de las migraciones 534-539 (cambio sticky-weighted-assignment).
--
-- Corre entera dentro de una transacción que termina en ROLLBACK: no
-- deja nada. Cada bloque falla con una excepción que nombra el escenario.
--
--   MSYS_NO_PATHCONV=1 docker cp supabase/tests/sticky_weighted_assignment.test.sql supabase_db_02-crm:/tmp/swa.sql
--   MSYS_NO_PATHCONV=1 docker exec supabase_db_02-crm psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/swa.sql
--
-- Las comprobaciones de RLS se hacen con `SET LOCAL ROLE authenticated`
-- y `request.jwt.claims`, NUNCA como `postgres` (superusuario: se salta
-- la RLS y da un falso verde).
-- ============================================================
\set QUIET on
BEGIN;

-- ------------------------------------------------------------
-- Fixtures: una cuenta aislada con owner, admin y tres agent (A el más
-- antiguo). Los usuarios de auth se insertan sin disparar
-- handle_new_user, que crearía cuentas propias.
-- ------------------------------------------------------------
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email, aud, role, is_sso_user, is_anonymous) VALUES
  ('00000000-0000-4000-8000-000000000010', 'swa-owner@test.local', 'authenticated', 'authenticated', false, false),
  ('00000000-0000-4000-8000-000000000011', 'swa-admin@test.local', 'authenticated', 'authenticated', false, false),
  ('00000000-0000-4000-8000-000000000021', 'swa-a@test.local', 'authenticated', 'authenticated', false, false),
  ('00000000-0000-4000-8000-000000000022', 'swa-b@test.local', 'authenticated', 'authenticated', false, false),
  ('00000000-0000-4000-8000-000000000023', 'swa-c@test.local', 'authenticated', 'authenticated', false, false);
SET LOCAL session_replication_role = origin;

INSERT INTO accounts (id, name, owner_user_id, default_currency) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'SWA test', '00000000-0000-4000-8000-000000000010', 'COP');

INSERT INTO profiles (user_id, full_name, email, account_id, account_role, created_at) VALUES
  ('00000000-0000-4000-8000-000000000010', 'Owner', 'swa-owner@test.local', '00000000-0000-4000-8000-0000000000a1', 'owner', now() - interval '10 days'),
  ('00000000-0000-4000-8000-000000000011', 'Admin', 'swa-admin@test.local', '00000000-0000-4000-8000-0000000000a1', 'admin', now() - interval '9 days'),
  ('00000000-0000-4000-8000-000000000021', 'Ana Asesora', 'swa-a@test.local', '00000000-0000-4000-8000-0000000000a1', 'agent', now() - interval '8 days'),
  ('00000000-0000-4000-8000-000000000022', 'Beto Asesor', 'swa-b@test.local', '00000000-0000-4000-8000-0000000000a1', 'agent', now() - interval '7 days'),
  ('00000000-0000-4000-8000-000000000023', 'Caro Asesora', 'swa-c@test.local', '00000000-0000-4000-8000-0000000000a1', 'agent', now() - interval '6 days');

-- Un embudo más antiguo que NO es "Ventas", para comprobar que gana el
-- llamado Ventas (con espacios y mayúsculas, como en pickDefaultPipeline).
INSERT INTO pipelines (id, user_id, name, account_id, created_at) VALUES
  ('00000000-0000-4000-8000-0000000000b0', '00000000-0000-4000-8000-000000000010', 'Postventa', '00000000-0000-4000-8000-0000000000a1', now() - interval '30 days'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000000010', ' VENTAS ', '00000000-0000-4000-8000-0000000000a1', now() - interval '20 days');
INSERT INTO pipeline_stages (id, pipeline_id, name, position, color) VALUES
  ('00000000-0000-4000-8000-0000000000c0', '00000000-0000-4000-8000-0000000000b0', 'Entrega', 0, '#000'),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000b1', 'Negociación', 1, '#000'),
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b1', 'Prospecto', 0, '#000');

INSERT INTO contacts (id, user_id, account_id, name, phone)
SELECT ('00000000-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid,
       '00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-0000000000a1',
       'Cliente ' || i, '5730000000' || lpad(i::text, 2, '0')
FROM generate_series(1, 25) i;

-- conv(i) = conversación de WhatsApp del contacto i
CREATE TEMP TABLE t_conv (i int PRIMARY KEY, id uuid) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION pg_temp.new_conv(p_i int, p_channel text DEFAULT 'whatsapp', p_created timestamptz DEFAULT now())
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
  INSERT INTO conversations (user_id, contact_id, account_id, channel, created_at)
  VALUES ('00000000-0000-4000-8000-000000000010',
          ('00000000-0000-4000-8000-0000000001' || lpad(p_i::text, 2, '0'))::uuid,
          '00000000-0000-4000-8000-0000000000a1', p_channel::message_channel, p_created)
  RETURNING id INTO v;
  RETURN v;
END $$;

-- Un mensaje en la conversación, con su fecha. `customer` = entrante.
CREATE OR REPLACE FUNCTION pg_temp.msg(p_conv uuid, p_sender text, p_at timestamptz)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO messages (conversation_id, sender_type, content_type, content_text, created_at)
  VALUES (p_conv, p_sender, 'text', 'mensaje de prueba', p_at) $$;

CREATE OR REPLACE FUNCTION pg_temp.contact(p_i int) RETURNS uuid LANGUAGE sql AS $$
  SELECT ('00000000-0000-4000-8000-0000000001' || lpad(p_i::text, 2, '0'))::uuid $$;

CREATE OR REPLACE FUNCTION pg_temp.fail(p_scenario text, p_detail text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'FALLA [%]: %', p_scenario, p_detail; END $$;

-- ============================================================
-- 534 — porcentajes
-- ============================================================
DO $$
BEGIN
  PERFORM set_assignment_weights('00000000-0000-4000-8000-0000000000a1', '[
    {"user_id":"00000000-0000-4000-8000-000000000021","percent":34},
    {"user_id":"00000000-0000-4000-8000-000000000022","percent":33},
    {"user_id":"00000000-0000-4000-8000-000000000023","percent":33}]'::jsonb);
  IF (SELECT sum(percent) FROM assignment_weights WHERE account_id = '00000000-0000-4000-8000-0000000000a1') <> 100 THEN
    PERFORM pg_temp.fail('porcentajes', 'no se guardó la lista');
  END IF;
  RAISE NOTICE 'ok  porcentajes: set_assignment_weights guarda 34/33/33';
END $$;

-- La base rechaza una suma distinta de 100 aunque se salte la API.
DO $$
BEGIN
  BEGIN
    UPDATE assignment_weights SET percent = 24
    WHERE account_id = '00000000-0000-4000-8000-0000000000a1'
      AND user_id = '00000000-0000-4000-8000-000000000021';
    SET CONSTRAINTS check_assignment_weights_sum IMMEDIATE;
    PERFORM pg_temp.fail('suma 100 en la base', 'aceptó una suma de 90');
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok  suma 100: la base rechaza 90 al confirmar';
  END;
END $$;
SET CONSTRAINTS check_assignment_weights_sum DEFERRED;

DO $$
BEGIN
  BEGIN
    PERFORM set_assignment_weights('00000000-0000-4000-8000-0000000000a1',
      '[{"user_id":"00000000-0000-4000-8000-000000000011","percent":100}]'::jsonb);
    PERFORM pg_temp.fail('solo agent', 'aceptó a un admin en la lista');
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'weights_not_agent' THEN RAISE; END IF;
    RAISE NOTICE 'ok  solo agent: un admin en la lista se rechaza';
  END;
END $$;

-- La activación de P4 la fecha la base, no el cliente. P4 se mide en
-- HORAS (decisión del Director del 2026-09-23: 3 horas).
DO $$
DECLARE v timestamptz;
BEGIN
  UPDATE assignment_settings SET stale_assign_after_hours = 3, stale_assign_enabled_at = '2020-01-01'
  WHERE account_id = '00000000-0000-4000-8000-0000000000a1';
  SELECT stale_assign_enabled_at INTO v FROM assignment_settings WHERE account_id = '00000000-0000-4000-8000-0000000000a1';
  IF v IS NULL OR v < now() - interval '1 minute' THEN
    PERFORM pg_temp.fail('activación P4', 'enabled_at forjable o vacío: ' || coalesce(v::text, 'null'));
  END IF;
  UPDATE assignment_settings SET stale_assign_after_hours = 5, stale_assign_enabled_at = '2020-01-01'
  WHERE account_id = '00000000-0000-4000-8000-0000000000a1';
  IF (SELECT stale_assign_enabled_at FROM assignment_settings WHERE account_id = '00000000-0000-4000-8000-0000000000a1') <> v THEN
    PERFORM pg_temp.fail('activación P4', 'cambiar X de 3 a 5 reinició la activación');
  END IF;
  UPDATE assignment_settings SET stale_assign_after_hours = NULL
  WHERE account_id = '00000000-0000-4000-8000-0000000000a1';
  IF (SELECT stale_assign_enabled_at FROM assignment_settings WHERE account_id = '00000000-0000-4000-8000-0000000000a1') IS NOT NULL THEN
    PERFORM pg_temp.fail('activación P4', 'desactivar no borró la activación');
  END IF;
  RAISE NOTICE 'ok  activación P4: la fija la base, se conserva al cambiar X y se borra al desactivar';
END $$;

-- Rango de horas: 1 a 720 (30 días).
DO $$
DECLARE h int;
BEGIN
  FOREACH h IN ARRAY ARRAY[0, 721] LOOP
    BEGIN
      UPDATE assignment_settings SET stale_assign_after_hours = h
      WHERE account_id = '00000000-0000-4000-8000-0000000000a1';
      PERFORM pg_temp.fail('rango de horas', 'aceptó ' || h);
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
  RAISE NOTICE 'ok  rango de horas: la base rechaza 0 y 721';
END $$;

-- ============================================================
-- 537 — reparto determinista 34/33/33: A, B, C, A, B, C
-- ============================================================
DO $$
DECLARE
  i int; v_conv uuid; r jsonb; got text := ''; want text :=
    '00000000-0000-4000-8000-000000000021,00000000-0000-4000-8000-000000000022,00000000-0000-4000-8000-000000000023,'
    '00000000-0000-4000-8000-000000000021,00000000-0000-4000-8000-000000000022,00000000-0000-4000-8000-000000000023,';
BEGIN
  FOR i IN 1..6 LOOP
    v_conv := pg_temp.new_conv(i);
    INSERT INTO t_conv VALUES (i, v_conv);
    r := auto_assign_conversation(v_conv, 'automation');
    IF r->>'outcome' <> 'assigned' OR r->>'source' <> 'weighted' THEN
      PERFORM pg_temp.fail('reparto', 'resultado inesperado ' || r::text);
    END IF;
    got := got || (r->'agent'->>'user_id') || ',';
  END LOOP;
  IF got <> want THEN PERFORM pg_temp.fail('reparto 34/33/33', got); END IF;

  IF (SELECT count(*) FROM conversation_assignments
      WHERE account_id = '00000000-0000-4000-8000-0000000000a1'
        AND source = 'weighted' AND origin = 'automation') <> 6 THEN
    PERFORM pg_temp.fail('historial', 'no quedaron 6 filas weighted/automation');
  END IF;
  RAISE NOTICE 'ok  reparto: A,B,C,A,B,C con source=weighted y origin=automation';
END $$;

-- El agent_json trae profile_id y nombre
DO $$
DECLARE r jsonb;
BEGIN
  r := auto_assign_conversation((SELECT id FROM t_conv WHERE i = 1), 'automation');
  IF r->>'outcome' <> 'kept' OR r->'agent'->>'full_name' <> 'Ana Asesora'
     OR (r->'agent'->>'profile_id')::uuid IS DISTINCT FROM
        (SELECT id FROM profiles WHERE user_id = '00000000-0000-4000-8000-000000000021') THEN
    PERFORM pg_temp.fail('conservar', r::text);
  END IF;
  RAISE NOTICE 'ok  conservar: una conversación con asesor vigente se queda con él';
END $$;

-- ============================================================
-- 536 — negocio en cada asignación
-- ============================================================
DO $$
DECLARE d record;
BEGIN
  IF (SELECT count(*) FROM deals WHERE account_id = '00000000-0000-4000-8000-0000000000a1' AND status = 'open') <> 6 THEN
    PERFORM pg_temp.fail('negocio', 'no nació un negocio por contacto asignado');
  END IF;
  SELECT * INTO d FROM deals WHERE contact_id = pg_temp.contact(1);
  IF d.stage_id <> '00000000-0000-4000-8000-0000000000c1' OR d.pipeline_id <> '00000000-0000-4000-8000-0000000000b1' THEN
    PERFORM pg_temp.fail('negocio', 'no cayó en Ventas / Prospecto');
  END IF;
  IF d.assigned_to IS DISTINCT FROM (SELECT id FROM profiles WHERE user_id = '00000000-0000-4000-8000-000000000021') THEN
    PERFORM pg_temp.fail('negocio', 'assigned_to no es el profiles.id del asesor');
  END IF;
  IF d.title <> 'Cliente 1' OR d.currency <> 'COP' OR d.value <> 0 OR d.conversation_id <> (SELECT id FROM t_conv WHERE i = 1) THEN
    PERFORM pg_temp.fail('negocio', format('campos inesperados %s %s %s', d.title, d.currency, d.value));
  END IF;
  RAISE NOTICE 'ok  negocio: Ventas/Prospecto, título del contacto, moneda de la cuenta, asignado al perfil';
END $$;

-- ============================================================
-- 535 — herencia por contacto, sin pausar la IA y sin segundo negocio
-- ============================================================
DO $$
DECLARE v uuid; c record; h record;
BEGIN
  v := pg_temp.new_conv(1, 'instagram');
  SELECT * INTO c FROM conversations WHERE id = v;
  IF c.assigned_agent_id IS DISTINCT FROM '00000000-0000-4000-8000-000000000021' THEN
    PERFORM pg_temp.fail('herencia', 'la conversación de Instagram no heredó a Ana');
  END IF;
  IF c.ai_autoreply_disabled THEN PERFORM pg_temp.fail('herencia', 'pausó la IA'); END IF;
  SELECT * INTO h FROM conversation_assignments WHERE conversation_id = v;
  IF h.source <> 'continuity' OR h.origin <> 'inheritance' THEN
    PERFORM pg_temp.fail('herencia', format('origen %s/%s', h.source, h.origin));
  END IF;
  IF (SELECT count(*) FROM deals WHERE contact_id = pg_temp.contact(1)) <> 1 THEN
    PERFORM pg_temp.fail('herencia', 'creó un segundo negocio con uno abierto');
  END IF;
  RAISE NOTICE 'ok  herencia: Instagram hereda a Ana, IA activa, historial continuity/inheritance, sin segundo negocio';
END $$;

-- Un asesor de continuidad que ya no es agent no se hereda.
DO $$
DECLARE v uuid;
BEGIN
  -- Contacto 20 atendido por Caro; Caro pasa a admin.
  v := pg_temp.new_conv(20);
  PERFORM set_config('crm.assignment_override', 'on', true);
  UPDATE conversations SET assigned_agent_id = '00000000-0000-4000-8000-000000000023' WHERE id = v;
  UPDATE conversations SET assigned_agent_id = NULL WHERE id = v;
  PERFORM set_config('crm.assignment_override', '', true);
  UPDATE profiles SET account_role = 'admin' WHERE user_id = '00000000-0000-4000-8000-000000000023';
  v := pg_temp.new_conv(20, 'messenger');
  IF (SELECT assigned_agent_id FROM conversations WHERE id = v) IS NOT NULL THEN
    PERFORM pg_temp.fail('herencia', 'heredó a alguien que ya no es agent');
  END IF;
  UPDATE profiles SET account_role = 'agent' WHERE user_id = '00000000-0000-4000-8000-000000000023';
  RAISE NOTICE 'ok  herencia: no se hereda a quien dejó de ser agent';
END $$;

-- ============================================================
-- 535 — la guarda: sin sesión no se pisa a un asesor vigente
-- ============================================================
DO $$
DECLARE v uuid := (SELECT id FROM t_conv WHERE i = 1);
BEGIN
  UPDATE conversations SET assigned_agent_id = '00000000-0000-4000-8000-000000000022', status = 'pending' WHERE id = v;
  IF (SELECT assigned_agent_id FROM conversations WHERE id = v) <> '00000000-0000-4000-8000-000000000021' THEN
    PERFORM pg_temp.fail('guarda', 'una escritura sin sesión pisó a Ana');
  END IF;
  IF (SELECT status FROM conversations WHERE id = v) <> 'pending' THEN
    PERFORM pg_temp.fail('guarda', 'la guarda abortó el resto de la sentencia');
  END IF;
  UPDATE conversations SET assigned_agent_id = NULL WHERE id = v;
  IF (SELECT assigned_agent_id FROM conversations WHERE id = v) IS NULL THEN
    PERFORM pg_temp.fail('guarda', 'una escritura sin sesión soltó a Ana');
  END IF;
  PERFORM set_config('crm.assignment_override', 'on', true);
  UPDATE conversations SET assigned_agent_id = '00000000-0000-4000-8000-000000000022' WHERE id = v;
  IF (SELECT assigned_agent_id FROM conversations WHERE id = v) <> '00000000-0000-4000-8000-000000000022' THEN
    PERFORM pg_temp.fail('guarda', 'el escape del operador no funcionó');
  END IF;
  UPDATE conversations SET assigned_agent_id = '00000000-0000-4000-8000-000000000021', status = 'open' WHERE id = v;
  PERFORM set_config('crm.assignment_override', '', true);
  RAISE NOTICE 'ok  guarda: conserva al vigente sin abortar la sentencia; el escape del operador pasa';
END $$;

-- La guarda deja pasar cuando el asesor anterior ya no es miembro.
DO $$
DECLARE v uuid;
BEGIN
  v := pg_temp.new_conv(19);
  PERFORM set_config('crm.assignment_override', 'on', true);
  -- Un asesor que no existe en la cuenta (se fue).
  UPDATE conversations SET assigned_agent_id = '00000000-0000-4000-8000-000000000099' WHERE id = v;
  PERFORM set_config('crm.assignment_override', '', true);
  UPDATE conversations SET assigned_agent_id = '00000000-0000-4000-8000-000000000022' WHERE id = v;
  IF (SELECT assigned_agent_id FROM conversations WHERE id = v) <> '00000000-0000-4000-8000-000000000022' THEN
    PERFORM pg_temp.fail('guarda', 'bloqueó la reasignación de una huérfana');
  END IF;
  RAISE NOTICE 'ok  guarda: una conversación huérfana sí se reasigna';
END $$;

-- ============================================================
-- 537 — preferido y flujos sin reparto
-- ============================================================
DO $$
DECLARE r jsonb; v uuid;
BEGIN
  v := pg_temp.new_conv(7);
  r := auto_assign_conversation(v, 'flow', NULL, FALSE);
  IF r->>'outcome' <> 'no_agent' THEN PERFORM pg_temp.fail('flujo sin agente', r::text); END IF;
  r := auto_assign_conversation(v, 'flow', '00000000-0000-4000-8000-000000000023', FALSE);
  IF r->>'source' <> 'preferred' OR r->'agent'->>'user_id' <> '00000000-0000-4000-8000-000000000023' THEN
    PERFORM pg_temp.fail('preferido', r::text);
  END IF;
  -- Con continuidad, el preferido no gana.
  v := pg_temp.new_conv(2, 'instagram');  -- hereda a Beto
  r := auto_assign_conversation(v, 'flow', '00000000-0000-4000-8000-000000000023', FALSE);
  IF r->>'outcome' <> 'kept' OR r->'agent'->>'user_id' <> '00000000-0000-4000-8000-000000000022' THEN
    PERFORM pg_temp.fail('continuidad antes que preferido', r::text);
  END IF;
  RAISE NOTICE 'ok  flujos: sin agente no reparte; el preferido se usa; la continuidad le gana';
END $$;

-- ============================================================
-- 536 — negocio: perdido no impide uno nuevo; admin no crea negocio
-- ============================================================
DO $$
DECLARE v uuid;
BEGIN
  UPDATE deals SET status = 'lost' WHERE contact_id = pg_temp.contact(3);
  v := pg_temp.new_conv(3, 'messenger');   -- hereda a Caro
  IF (SELECT count(*) FROM deals WHERE contact_id = pg_temp.contact(3) AND status = 'open') <> 1 THEN
    PERFORM pg_temp.fail('negocio tras perdido', 'no nació uno nuevo');
  END IF;

  v := pg_temp.new_conv(8);
  UPDATE conversations SET assigned_agent_id = '00000000-0000-4000-8000-000000000011' WHERE id = v;
  IF EXISTS (SELECT 1 FROM deals WHERE contact_id = pg_temp.contact(8)) THEN
    PERFORM pg_temp.fail('negocio admin', 'una asignación a admin creó negocio');
  END IF;
  RAISE NOTICE 'ok  negocio: un perdido no impide uno nuevo; asignar a un admin no crea negocio';
END $$;

-- ============================================================
-- 537 — traspaso de la IA: negocio rico antes que el genérico
-- ============================================================
DO $$
DECLARE v uuid; r jsonb; c record; d record;
BEGIN
  v := pg_temp.new_conv(9);
  r := ai_handoff_assign(v, 'Nombre: Carlos. Interés: Mazda 3', 'Carlos — Mazda 3 2020');
  IF r->>'outcome' <> 'assigned' OR r->>'deal' <> 'created' THEN PERFORM pg_temp.fail('traspaso', r::text); END IF;
  SELECT * INTO c FROM conversations WHERE id = v;
  IF NOT c.ai_autoreply_disabled OR c.ai_handoff_summary <> 'Nombre: Carlos. Interés: Mazda 3' THEN
    PERFORM pg_temp.fail('traspaso', 'no pausó o no guardó la nota');
  END IF;
  IF (SELECT count(*) FROM deals WHERE contact_id = pg_temp.contact(9)) <> 1 THEN
    PERFORM pg_temp.fail('traspaso', 'hay más de un negocio');
  END IF;
  SELECT * INTO d FROM deals WHERE contact_id = pg_temp.contact(9);
  IF d.title <> 'Carlos — Mazda 3 2020' OR d.notes <> 'Nombre: Carlos. Interés: Mazda 3' THEN
    PERFORM pg_temp.fail('traspaso', 'el título rico se perdió: ' || d.title);
  END IF;
  IF d.assigned_to IS DISTINCT FROM (SELECT id FROM profiles WHERE user_id = c.assigned_agent_id) THEN
    PERFORM pg_temp.fail('traspaso', 'el negocio no nació con el asesor');
  END IF;
  IF (SELECT origin FROM conversation_assignments WHERE conversation_id = v ORDER BY changed_at DESC LIMIT 1) <> 'ai_handoff' THEN
    PERFORM pg_temp.fail('traspaso', 'historial sin origin ai_handoff');
  END IF;
  -- El aviso de la 521 reconoce el traspaso (nota en el mismo UPDATE).
  IF NOT EXISTS (SELECT 1 FROM notifications WHERE conversation_id = v AND title = 'Cliente asignado por el asistente') THEN
    PERFORM pg_temp.fail('traspaso', 'el aviso no llevó la nota del asistente');
  END IF;
  RAISE NOTICE 'ok  traspaso: un solo negocio con título rico, asignado, pausa y nota en un UPDATE, aviso del asistente';
END $$;

-- El lead que vuelve: se conserva el asesor, nace negocio y se le avisa.
DO $$
DECLARE v uuid := (SELECT id FROM t_conv WHERE i = 1); r jsonb;
BEGIN
  UPDATE deals SET status = 'lost' WHERE contact_id = pg_temp.contact(1);
  r := ai_handoff_assign(v, 'Volvió por la campaña', 'Cliente 1 — Kia Picanto');
  IF r->>'outcome' <> 'kept' OR r->'agent'->>'user_id' <> '00000000-0000-4000-8000-000000000021' OR r->>'deal' <> 'created' THEN
    PERFORM pg_temp.fail('lead que vuelve', r::text);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM deals WHERE contact_id = pg_temp.contact(1) AND status = 'open' AND title = 'Cliente 1 — Kia Picanto') THEN
    PERFORM pg_temp.fail('lead que vuelve', 'no nació el negocio con título rico');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM notifications WHERE conversation_id = v
                 AND user_id = '00000000-0000-4000-8000-000000000021'
                 AND title = 'Tu cliente pidió un asesor') THEN
    PERFORM pg_temp.fail('lead que vuelve', 'el asesor no recibió aviso');
  END IF;
  RAISE NOTICE 'ok  lead que vuelve: conserva a Ana, negocio nuevo con título rico, aviso a Ana';
END $$;

-- La continuidad le gana a la cuota en el traspaso.
DO $$
DECLARE v uuid; r jsonb;
BEGIN
  v := pg_temp.new_conv(4, 'instagram');  -- hereda a Ana (contacto 4 → A por el reparto)
  PERFORM set_config('crm.assignment_override', 'on', true);
  UPDATE conversations SET assigned_agent_id = NULL WHERE id = v;
  PERFORM set_config('crm.assignment_override', '', true);
  r := ai_handoff_assign(v, 'nota', NULL);
  IF r->>'source' <> 'continuity' OR r->'agent'->>'user_id' <> '00000000-0000-4000-8000-000000000021' THEN
    PERFORM pg_temp.fail('continuidad en el traspaso', r::text);
  END IF;
  RAISE NOTICE 'ok  traspaso: la continuidad del contacto le gana a los porcentajes';
END $$;

-- ============================================================
-- 538 — reactivación del lead que vuelve
-- ============================================================
DO $$
DECLARE v uuid := (SELECT id FROM t_conv WHERE i = 5); m1 uuid; m2 uuid; m3 uuid; ok boolean;
BEGIN
  UPDATE conversations SET ai_autoreply_disabled = true, ai_reply_count = 9, ai_handoff_attempts = 2 WHERE id = v;
  INSERT INTO messages (conversation_id, sender_type, content_type, content_text, created_at)
  VALUES (v, 'agent', 'text', 'Quedo atento', now() - interval '10 days');
  INSERT INTO messages (conversation_id, sender_type, content_type, content_text, created_at)
  VALUES (v, 'customer', 'text', 'Hola de nuevo', now()) RETURNING id INTO m1;
  INSERT INTO messages (conversation_id, sender_type, content_type, content_text, created_at)
  VALUES (v, 'customer', 'text', 'sigue disponible?', now() + interval '5 seconds') RETURNING id INTO m2;

  -- La ráfaga: el segundo mensaje no cumple la inactividad (se procesa primero a propósito).
  IF reactivate_ai_for_returning_lead(v, m2) THEN PERFORM pg_temp.fail('ráfaga', 'el segundo mensaje reactivó'); END IF;
  IF NOT reactivate_ai_for_returning_lead(v, m1) THEN PERFORM pg_temp.fail('reactivación', 'no reactivó tras 10 días'); END IF;
  IF (SELECT ai_autoreply_disabled OR ai_reply_count <> 0 OR ai_handoff_attempts <> 0 FROM conversations WHERE id = v) THEN
    PERFORM pg_temp.fail('reactivación', 'no reinició el estado de la IA');
  END IF;
  IF (SELECT assigned_agent_id FROM conversations WHERE id = v) IS NULL THEN
    PERFORM pg_temp.fail('reactivación', 'soltó al asesor');
  END IF;
  IF reactivate_ai_for_returning_lead(v, m1) THEN PERFORM pg_temp.fail('reactivación', 'reactivó dos veces'); END IF;

  -- Negociación viva: 2 días de silencio no reactivan.
  UPDATE conversations SET ai_autoreply_disabled = true WHERE id = v;
  INSERT INTO messages (conversation_id, sender_type, content_type, content_text, created_at)
  VALUES (v, 'customer', 'text', 'y el precio?', now() + interval '2 days') RETURNING id INTO m3;
  IF reactivate_ai_for_returning_lead(v, m3) THEN PERFORM pg_temp.fail('negociación viva', 'reactivó con 2 días'); END IF;

  -- N nulo = desactivado.
  UPDATE assignment_settings SET bot_reactivate_after_days = NULL WHERE account_id = '00000000-0000-4000-8000-0000000000a1';
  INSERT INTO messages (conversation_id, sender_type, content_type, content_text, created_at)
  VALUES (v, 'customer', 'text', 'hola?', now() + interval '40 days') RETURNING id INTO m3;
  IF reactivate_ai_for_returning_lead(v, m3) THEN PERFORM pg_temp.fail('N nulo', 'reactivó desactivado'); END IF;
  UPDATE assignment_settings SET bot_reactivate_after_days = 7 WHERE account_id = '00000000-0000-4000-8000-0000000000a1';
  RAISE NOTICE 'ok  reactivación: tras N días sí, en ráfaga solo el primero, 2 días no, N nulo no, conserva asesor';
END $$;

-- Decisión del Director (2026-09-23): el bot NUNCA se reactiva solo si el
-- asesor es owner/admin (los propietarios de Angélica). Sin asesor, sí.
DO $$
DECLARE v uuid; m uuid;
BEGIN
  -- Asesor admin.
  v := pg_temp.new_conv(16);
  UPDATE conversations SET assigned_agent_id = '00000000-0000-4000-8000-000000000011', ai_autoreply_disabled = true WHERE id = v;
  INSERT INTO messages (conversation_id, sender_type, content_type, content_text, created_at)
  VALUES (v, 'agent', 'text', '¿Sigue disponible su carro?', now() - interval '20 days');
  INSERT INTO messages (conversation_id, sender_type, content_type, content_text, created_at)
  VALUES (v, 'customer', 'text', 'ya lo vendí', now()) RETURNING id INTO m;
  IF reactivate_ai_for_returning_lead(v, m) THEN
    PERFORM pg_temp.fail('reactivación admin', 'reactivó el bot en un hilo de una admin');
  END IF;
  IF NOT (SELECT ai_autoreply_disabled FROM conversations WHERE id = v) THEN
    PERFORM pg_temp.fail('reactivación admin', 'la IA quedó activa');
  END IF;

  -- Sin asesor: igual que antes.
  v := pg_temp.new_conv(17);
  UPDATE conversations SET ai_autoreply_disabled = true WHERE id = v;
  INSERT INTO messages (conversation_id, sender_type, content_type, content_text, created_at)
  VALUES (v, 'customer', 'text', 'hola', now() - interval '20 days');
  INSERT INTO messages (conversation_id, sender_type, content_type, content_text, created_at)
  VALUES (v, 'customer', 'text', 'hola de nuevo', now()) RETURNING id INTO m;
  IF NOT reactivate_ai_for_returning_lead(v, m) THEN
    PERFORM pg_temp.fail('reactivación sin asesor', 'no reactivó');
  END IF;
  RAISE NOTICE 'ok  reactivación: nunca con asesor owner/admin; sin asesor sí';
END $$;

-- ============================================================
-- 537 — job de P4 (horas; "nunca las de antes")
--
-- Solo entran las conversaciones en las que el CLIENTE escribió y que
-- quedaron sin asesor DESPUÉS de activarse la regla:
--   espera_desde = max(último cambio de asesor o creación, primer entrante)
--   espera_desde >= activación  y  ahora - espera_desde >= X horas.
-- ============================================================
DO $$
DECLARE
  v_antes uuid; v_nueva uuid; v_reciente uuid; v_cerrada uuid;
  v_soltada uuid; v_soltada_antes uuid; r jsonb;
  v_difusion uuid; v_difusion_responde uuid; v_difusion_reciente uuid;
BEGIN
  UPDATE assignment_settings SET stale_assign_after_hours = 3 WHERE account_id = '00000000-0000-4000-8000-0000000000a1';
  -- Simular que la regla se activó hace 10 horas (la base no deja
  -- forjarlo; se apagan los triggers solo para preparar el escenario).
  SET LOCAL session_replication_role = replica;
  UPDATE assignment_settings SET stale_assign_enabled_at = now() - interval '10 hours'
  WHERE account_id = '00000000-0000-4000-8000-0000000000a1';
  SET LOCAL session_replication_role = origin;

  -- Ya estaba sin asesor al activar: nunca.
  v_antes := pg_temp.new_conv(10, 'whatsapp', now() - interval '30 days');
  PERFORM pg_temp.msg(v_antes, 'customer', now() - interval '30 days');
  -- Nació después de activar y lleva 5 horas: sí.
  v_nueva := pg_temp.new_conv(12, 'whatsapp', now() - interval '5 hours');
  PERFORM pg_temp.msg(v_nueva, 'customer', now() - interval '5 hours');
  -- Nació después de activar pero lleva 1 hora: todavía no.
  v_reciente := pg_temp.new_conv(18, 'whatsapp', now() - interval '1 hour');
  PERFORM pg_temp.msg(v_reciente, 'customer', now() - interval '1 hour');
  -- Cerrada: nunca.
  v_cerrada := pg_temp.new_conv(11, 'whatsapp', now() - interval '5 hours');
  PERFORM pg_temp.msg(v_cerrada, 'customer', now() - interval '5 hours');
  UPDATE conversations SET status = 'closed' WHERE id = v_cerrada;

  -- DIFUSIÓN (decisión del Tech Lead): una conversación que solo tiene
  -- salientes no es un lead. Nunca, aunque lleve horas sin asesor.
  v_difusion := pg_temp.new_conv(21, 'whatsapp', now() - interval '5 hours');
  PERFORM pg_temp.msg(v_difusion, 'agent', now() - interval '5 hours');
  -- Difusión de ANTES de activar a la que el cliente respondió hace 4 h:
  -- el reloj corre desde su primer entrante, así que sí entra.
  v_difusion_responde := pg_temp.new_conv(22, 'whatsapp', now() - interval '20 hours');
  PERFORM pg_temp.msg(v_difusion_responde, 'agent', now() - interval '20 hours');
  PERFORM pg_temp.msg(v_difusion_responde, 'customer', now() - interval '4 hours');
  -- Difusión de hace 5 h con respuesta hace 1 h: todavía no (el reloj no
  -- corre desde la creación).
  v_difusion_reciente := pg_temp.new_conv(23, 'whatsapp', now() - interval '5 hours');
  PERFORM pg_temp.msg(v_difusion_reciente, 'agent', now() - interval '5 hours');
  PERFORM pg_temp.msg(v_difusion_reciente, 'customer', now() - interval '1 hour');

  -- Un admin la soltó hace 4 horas (después de activar): sí.
  v_soltada := pg_temp.new_conv(15, 'whatsapp', now() - interval '30 days');
  PERFORM pg_temp.msg(v_soltada, 'customer', now() - interval '30 days');
  PERFORM set_config('crm.assignment_override', 'on', true);
  UPDATE conversations SET assigned_agent_id = '00000000-0000-4000-8000-000000000022' WHERE id = v_soltada;
  UPDATE conversations SET assigned_agent_id = NULL WHERE id = v_soltada;
  -- Soltada hace 20 horas (antes de activar): nunca.
  v_soltada_antes := pg_temp.new_conv(9, 'messenger', now() - interval '30 days');
  PERFORM pg_temp.msg(v_soltada_antes, 'customer', now() - interval '30 days');
  UPDATE conversations SET assigned_agent_id = '00000000-0000-4000-8000-000000000011' WHERE id = v_soltada_antes;
  UPDATE conversations SET assigned_agent_id = NULL WHERE id = v_soltada_antes;
  PERFORM set_config('crm.assignment_override', '', true);
  UPDATE conversation_assignments SET changed_at = now() - interval '4 hours' WHERE conversation_id = v_soltada;
  UPDATE conversation_assignments SET changed_at = now() - interval '20 hours' WHERE conversation_id = v_soltada_antes;

  r := run_stale_assignment_job(50);
  IF r->'conversation_ids' ? v_antes::text THEN PERFORM pg_temp.fail('P4', 'asignó una que ya estaba sin asesor al activar'); END IF;
  IF NOT (r->'conversation_ids' ? v_nueva::text) THEN PERFORM pg_temp.fail('P4', 'no asignó la de 5 horas: ' || r::text); END IF;
  IF r->'conversation_ids' ? v_reciente::text THEN PERFORM pg_temp.fail('P4', 'asignó una de 1 hora'); END IF;
  IF r->'conversation_ids' ? v_cerrada::text THEN PERFORM pg_temp.fail('P4', 'asignó una cerrada'); END IF;
  IF NOT (r->'conversation_ids' ? v_soltada::text) THEN PERFORM pg_temp.fail('P4', 'no asignó la soltada después de activar'); END IF;
  IF r->'conversation_ids' ? v_soltada_antes::text THEN PERFORM pg_temp.fail('P4', 'asignó una soltada antes de activar'); END IF;
  IF r->'conversation_ids' ? v_difusion::text THEN PERFORM pg_temp.fail('P4', 'asignó una difusión sin respuesta del cliente'); END IF;
  IF NOT (r->'conversation_ids' ? v_difusion_responde::text) THEN PERFORM pg_temp.fail('P4', 'no asignó la difusión respondida hace 4 h'); END IF;
  IF r->'conversation_ids' ? v_difusion_reciente::text THEN PERFORM pg_temp.fail('P4', 'asignó una difusión respondida hace 1 h'); END IF;
  IF EXISTS (SELECT 1 FROM deals WHERE contact_id = pg_temp.contact(21)) THEN
    PERFORM pg_temp.fail('P4', 'la difusión sin respuesta abrió un negocio');
  END IF;
  IF (SELECT origin FROM conversation_assignments WHERE conversation_id = v_nueva) <> 'stale_job' THEN
    PERFORM pg_temp.fail('P4', 'historial sin origin stale_job');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM deals WHERE contact_id = pg_temp.contact(12) AND status = 'open') THEN
    PERFORM pg_temp.fail('P4', 'no nació el negocio');
  END IF;
  -- Idempotente.
  r := run_stale_assignment_job(50);
  IF (r->>'assigned')::int <> 0 THEN PERFORM pg_temp.fail('P4', 'reasignó en la segunda corrida: ' || r::text); END IF;
  RAISE NOTICE 'ok  P4: solo lo que quedó sin asesor tras activar (nueva y soltada), a las X horas; nunca lo de antes, cerradas ni recientes; idempotente';
  RAISE NOTICE 'ok  P4 difusiones: sin entrante del cliente nunca; con respuesta, el reloj corre desde el primer entrante';
END $$;

-- ============================================================
-- RLS — con usuario real, nunca como postgres
-- ============================================================
DO $$
DECLARE n int; v6 uuid := (SELECT id FROM t_conv WHERE i = 6); v2 uuid := (SELECT id FROM t_conv WHERE i = 2);
BEGIN
  -- agent A
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000021","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM assignment_settings WHERE account_id = '00000000-0000-4000-8000-0000000000a1';
  IF n <> 0 THEN RESET ROLE; PERFORM pg_temp.fail('RLS', 'un agent lee la configuración'); END IF;
  SELECT count(*) INTO n FROM assignment_weights WHERE account_id = '00000000-0000-4000-8000-0000000000a1';
  IF n <> 0 THEN RESET ROLE; PERFORM pg_temp.fail('RLS', 'un agent lee los porcentajes'); END IF;
  BEGIN
    PERFORM set_assignment_weights('00000000-0000-4000-8000-0000000000a1',
      '[{"user_id":"00000000-0000-4000-8000-000000000021","percent":100}]'::jsonb);
    RESET ROLE; PERFORM pg_temp.fail('RLS', 'un agent cambió los porcentajes');
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM auto_assign_conversation(v2, 'automation');
    RESET ROLE; PERFORM pg_temp.fail('RLS', 'authenticated ejecuta auto_assign_conversation');
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  -- admin
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000011","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM assignment_weights WHERE account_id = '00000000-0000-4000-8000-0000000000a1';
  IF n <> 3 THEN RESET ROLE; PERFORM pg_temp.fail('RLS', 'el admin no lee los porcentajes: ' || n); END IF;
  UPDATE assignment_settings SET bot_reactivate_after_days = 10 WHERE account_id = '00000000-0000-4000-8000-0000000000a1';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RESET ROLE; PERFORM pg_temp.fail('RLS', 'el admin no actualiza la configuración'); END IF;
  PERFORM set_assignment_weights('00000000-0000-4000-8000-0000000000a1',
    '[{"user_id":"00000000-0000-4000-8000-000000000022","percent":100}]'::jsonb);
  -- La reasignación manual de un admin (con sesión) no la frena la guarda.
  UPDATE conversations SET assigned_agent_id = '00000000-0000-4000-8000-000000000023'
  WHERE id = v6;
  IF (SELECT assigned_agent_id FROM conversations WHERE id = v6)
     <> '00000000-0000-4000-8000-000000000023' THEN
    RESET ROLE; PERFORM pg_temp.fail('RLS', 'la guarda frenó la reasignación manual del admin');
  END IF;
  BEGIN
    INSERT INTO assignment_weights (account_id, user_id, percent)
    VALUES ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000021', 1);
    RESET ROLE; PERFORM pg_temp.fail('RLS', 'el admin escribe porcentajes por fuera de la RPC');
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  -- anon
  SET LOCAL ROLE anon;
  BEGIN
    SELECT count(*) INTO n FROM assignment_settings;
    RESET ROLE; PERFORM pg_temp.fail('RLS', 'anon lee la configuración');
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  RAISE NOTICE 'ok  RLS: agent no lee ni escribe, admin lee/actualiza y usa la RPC, nadie escribe porcentajes directo, anon sin acceso';
END $$;

-- Tras cambiar los porcentajes (100 % Beto) la cuota se reinicia.
DO $$
DECLARE v uuid; r jsonb;
BEGIN
  v := pg_temp.new_conv(13);
  r := auto_assign_conversation(v, 'automation');
  IF r->'agent'->>'user_id' <> '00000000-0000-4000-8000-000000000022' THEN
    PERFORM pg_temp.fail('100 %', r::text);
  END IF;
  RAISE NOTICE 'ok  100 %% a una persona: todas las asignaciones por porcentaje van a ella';
END $$;

-- Sin lista: reparto parejo entre los agent.
DO $$
DECLARE v uuid; r jsonb;
BEGIN
  DELETE FROM assignment_weights WHERE account_id = '00000000-0000-4000-8000-0000000000a1';
  v := pg_temp.new_conv(14);
  r := auto_assign_conversation(v, 'automation');
  IF r->>'source' <> 'weighted' THEN PERFORM pg_temp.fail('sin lista', r::text); END IF;
  RAISE NOTICE 'ok  sin lista: reparte parejo entre los agent';
END $$;

\echo 'TODAS LAS PRUEBAS PASARON'
ROLLBACK;
