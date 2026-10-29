-- ============================================================
-- Prueba de las migraciones 554, 555 y 558 (cambio hoja-de-vida-contacto):
-- hoja de vida, historial de etapas, interacciones y vendedor.
--
-- Corre dentro de una transacción que termina en ROLLBACK: no deja nada.
--
--   MSYS_NO_PATHCONV=1 docker cp supabase/tests/contact_timeline.test.sql supabase_db_02-crm:/tmp/ctl.sql
--   MSYS_NO_PATHCONV=1 docker exec supabase_db_02-crm psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/ctl.sql
-- ============================================================
\set QUIET on
BEGIN;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email, aud, role, is_sso_user, is_anonymous) VALUES
  ('00000000-0000-4000-8000-000000000541', 'ctl-owner@test.local',  'authenticated', 'authenticated', false, false),
  ('00000000-0000-4000-8000-000000000542', 'ctl-agent1@test.local', 'authenticated', 'authenticated', false, false),
  ('00000000-0000-4000-8000-000000000543', 'ctl-agent2@test.local', 'authenticated', 'authenticated', false, false),
  ('00000000-0000-4000-8000-000000000544', 'ctl-viewer@test.local', 'authenticated', 'authenticated', false, false),
  ('00000000-0000-4000-8000-000000000545', 'ctl-other@test.local',  'authenticated', 'authenticated', false, false);
SET LOCAL session_replication_role = origin;

INSERT INTO accounts (id, name, owner_user_id, default_currency) VALUES
  ('00000000-0000-4000-8000-0000000005d1', 'CTL A', '00000000-0000-4000-8000-000000000541', 'COP'),
  ('00000000-0000-4000-8000-0000000005d2', 'CTL B', '00000000-0000-4000-8000-000000000545', 'COP');

INSERT INTO profiles (user_id, full_name, email, account_id, account_role) VALUES
  ('00000000-0000-4000-8000-000000000541', 'Owner',  'ctl-owner@test.local',  '00000000-0000-4000-8000-0000000005d1', 'owner'),
  ('00000000-0000-4000-8000-000000000542', 'Agente1','ctl-agent1@test.local', '00000000-0000-4000-8000-0000000005d1', 'agent'),
  ('00000000-0000-4000-8000-000000000543', 'Agente2','ctl-agent2@test.local', '00000000-0000-4000-8000-0000000005d1', 'agent'),
  ('00000000-0000-4000-8000-000000000544', 'Viewer', 'ctl-viewer@test.local', '00000000-0000-4000-8000-0000000005d1', 'viewer'),
  ('00000000-0000-4000-8000-000000000545', 'Otro',   'ctl-other@test.local',  '00000000-0000-4000-8000-0000000005d2', 'owner');

-- El cliente lo atiende el agente 2.
INSERT INTO contacts (id, user_id, account_id, phone, name) VALUES
  ('00000000-0000-4000-8000-0000000e0001', '00000000-0000-4000-8000-000000000541', '00000000-0000-4000-8000-0000000005d1', '573100000001', 'Cliente'),
  ('00000000-0000-4000-8000-0000000e0009', '00000000-0000-4000-8000-000000000545', '00000000-0000-4000-8000-0000000005d2', '573100000009', 'Ajeno');

INSERT INTO conversations (id, user_id, account_id, contact_id, assigned_agent_id, last_message_at) VALUES
  ('00000000-0000-4000-8000-0000000f0001', '00000000-0000-4000-8000-000000000541', '00000000-0000-4000-8000-0000000005d1', '00000000-0000-4000-8000-0000000e0001', '00000000-0000-4000-8000-000000000543', '2026-10-01 10:00+00');

INSERT INTO messages (conversation_id, sender_type, content_text, created_at) VALUES
  ('00000000-0000-4000-8000-0000000f0001', 'customer', 'hola', '2026-10-01 09:00+00'),
  ('00000000-0000-4000-8000-0000000f0001', 'agent',    'buenas', '2026-10-01 10:00+00');

-- Negocio: el alta y un cambio de etapa (como lo haría el embudo).
DO $$
DECLARE v_pipeline UUID; v_s1 UUID; v_s2 UUID;
BEGIN
  INSERT INTO pipelines (user_id, account_id, name)
    VALUES ('00000000-0000-4000-8000-000000000541', '00000000-0000-4000-8000-0000000005d1', 'Ventas CTL')
    RETURNING id INTO v_pipeline;
  INSERT INTO pipeline_stages (pipeline_id, name, position)
    VALUES (v_pipeline, 'Prospecto', 0) RETURNING id INTO v_s1;
  INSERT INTO pipeline_stages (pipeline_id, name, position)
    VALUES (v_pipeline, 'Negociación', 1) RETURNING id INTO v_s2;
  INSERT INTO deals (id, user_id, account_id, pipeline_id, stage_id, contact_id, title, status)
    VALUES ('00000000-0000-4000-8000-0000000a0001', '00000000-0000-4000-8000-000000000541',
            '00000000-0000-4000-8000-0000000005d1', v_pipeline, v_s1,
            '00000000-0000-4000-8000-0000000e0001', 'CX-30', 'open');
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000543","role":"authenticated"}', true);
  UPDATE deals SET stage_id = v_s2 WHERE id = '00000000-0000-4000-8000-0000000a0001';
END $$;

-- Un vehículo vendido al cliente y uno que se le compró, con costo.
INSERT INTO inventory_vehicles (id, account_id, brand, model, year, status, sold_to_contact_id, sold_at, sold_price) VALUES
  ('00000000-0000-4000-8000-0000000b0001', '00000000-0000-4000-8000-0000000005d1', 'Mazda', 'CX-30', 2022, 'sold',
   '00000000-0000-4000-8000-0000000e0001', '2026-10-05 12:00+00', 90000000);
INSERT INTO inventory_vehicles (id, account_id, brand, model, year, seller_contact_id, acquisition_kind) VALUES
  ('00000000-0000-4000-8000-0000000b0002', '00000000-0000-4000-8000-0000000005d1', 'Chevrolet', 'Spark', 2015,
   '00000000-0000-4000-8000-0000000e0001', 'trade_in');
INSERT INTO vehicle_acquisitions (account_id, vehicle_id, purchase_cost, purchase_date) VALUES
  ('00000000-0000-4000-8000-0000000005d1', '00000000-0000-4000-8000-0000000b0002', 12345678, '2026-10-05');

-- Tres notas con la MISMA fecha, para probar el desempate del cursor.
INSERT INTO contact_notes (contact_id, account_id, user_id, note_text, created_at) VALUES
  ('00000000-0000-4000-8000-0000000e0001', '00000000-0000-4000-8000-0000000005d1', '00000000-0000-4000-8000-000000000543', 'n1', '2026-10-03 08:00+00'),
  ('00000000-0000-4000-8000-0000000e0001', '00000000-0000-4000-8000-0000000005d1', '00000000-0000-4000-8000-000000000543', 'n2', '2026-10-03 08:00+00'),
  ('00000000-0000-4000-8000-0000000e0001', '00000000-0000-4000-8000-0000000005d1', '00000000-0000-4000-8000-000000000543', 'n3', '2026-10-03 08:00+00');

CREATE TEMP TABLE r (k TEXT, v TEXT);
GRANT ALL ON r TO authenticated;

-- ============================================================
-- Agente 1 (no atiende al cliente)
-- ============================================================
SELECT FROM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000542","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

INSERT INTO r SELECT 'agent1_kinds', string_agg(DISTINCT kind, ',' ORDER BY kind)
  FROM get_contact_timeline('00000000-0000-4000-8000-0000000e0001');
INSERT INTO r SELECT 'agent1_cost_present', COUNT(*)::TEXT
  FROM get_contact_timeline('00000000-0000-4000-8000-0000000e0001', ARRAY['acquisition'])
  WHERE data ? 'purchase_cost';
INSERT INTO r SELECT 'agent1_stage_actor', actor_name || ':' || (data->>'from_stage_name') || '>' || (data->>'to_stage_name')
  FROM get_contact_timeline('00000000-0000-4000-8000-0000000e0001', ARRAY['deal_stage']);
INSERT INTO r SELECT 'agent1_conv', (data->>'message_count') || ':' || (data->>'assigned_agent_name')
  FROM get_contact_timeline('00000000-0000-4000-8000-0000000e0001', ARRAY['conversation']);
INSERT INTO r SELECT 'agent1_msgs', COUNT(*)::TEXT
  FROM get_contact_conversation_messages('00000000-0000-4000-8000-0000000f0001');
INSERT INTO r SELECT 'agent1_msgs_tabla', COUNT(*)::TEXT
  FROM messages WHERE conversation_id = '00000000-0000-4000-8000-0000000f0001';
INSERT INTO r SELECT 'agent1_summary',
  (s->>'appointments_total') || ',' || (s->>'vehicles_bought') || ',' || (s->>'vehicles_traded_in') || ',' ||
  (s->>'open_deals') || ',' || (s->>'can_edit')
  FROM get_contact_summary('00000000-0000-4000-8000-0000000e0001') s;
-- "Cómo va" (558): negocio en la etapa 2 de 2, el cliente espera
-- respuesta (el 'buenas' no trae sender_id), sin cita y el último
-- contacto es el mensaje.
INSERT INTO r SELECT 'agent1_status',
  (s->'open_deal'->>'stage_name') || ':' || (s->'open_deal'->>'stage_index') || '/' || (s->'open_deal'->>'stage_count') || ',' ||
  (s->'awaiting_reply'->>'since' IS NOT NULL)::TEXT || ',' ||
  COALESCE(s->>'next_appointment', 'null') || ',' || (s->'last_contact'->>'source')
  FROM get_contact_summary('00000000-0000-4000-8000-0000000e0001') s;

-- Paginación de a 1 sobre las tres notas empatadas: ninguna se repite ni se salta.
DO $$
DECLARE
  v_before TIMESTAMPTZ; v_key TEXT; v_seen TEXT := ''; v_row RECORD; i INT;
BEGIN
  FOR i IN 1..4 LOOP
    SELECT * INTO v_row FROM get_contact_timeline(
      '00000000-0000-4000-8000-0000000e0001', ARRAY['note'], v_before, v_key, 1);
    EXIT WHEN NOT FOUND;
    v_seen := v_seen || (v_row.data->>'text');
    v_before := v_row.occurred_at; v_key := v_row.sort_key;
  END LOOP;
  INSERT INTO r VALUES ('agent1_pages', (SELECT string_agg(c, '' ORDER BY c) FROM regexp_split_to_table(v_seen, 'n') c WHERE c <> ''));
  INSERT INTO r VALUES ('agent1_pages_len', length(v_seen)::TEXT);
END $$;

-- Interacción sobre el cliente de otro: permitida, a su nombre.
INSERT INTO contact_interactions (id, account_id, contact_id, user_id, kind, outcome, duration_seconds, note, occurred_at) VALUES
  ('00000000-0000-4000-8000-000000ee0001', '00000000-0000-4000-8000-0000000005d1', '00000000-0000-4000-8000-0000000e0001',
   '00000000-0000-4000-8000-000000000542', 'call_outbound', 'answered', 240, 'pide financiación', NOW() - INTERVAL '7 hours');

-- Fecha futura: rechazada.
DO $$
BEGIN
  BEGIN
    INSERT INTO contact_interactions (account_id, contact_id, user_id, kind, occurred_at) VALUES
      ('00000000-0000-4000-8000-0000000005d1', '00000000-0000-4000-8000-0000000e0001',
       '00000000-0000-4000-8000-000000000542', 'walk_in', NOW() + INTERVAL '1 day');
    INSERT INTO r VALUES ('futura', 'aceptada');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO r VALUES ('futura', 'rechazada');
  END;
END $$;

-- Resultado en una visita: rechazado.
DO $$
BEGIN
  BEGIN
    INSERT INTO contact_interactions (account_id, contact_id, user_id, kind, outcome) VALUES
      ('00000000-0000-4000-8000-0000000005d1', '00000000-0000-4000-8000-0000000e0001',
       '00000000-0000-4000-8000-000000000542', 'walk_in', 'answered');
    INSERT INTO r VALUES ('walkin_outcome', 'aceptada');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO r VALUES ('walkin_outcome', 'rechazada');
  END;
END $$;

-- Vendedor de otra cuenta: rechazado (como agent, que puede editar inventario).
DO $$
BEGIN
  BEGIN
    UPDATE inventory_vehicles SET seller_contact_id = '00000000-0000-4000-8000-0000000e0009'
      WHERE id = '00000000-0000-4000-8000-0000000b0002';
    INSERT INTO r VALUES ('vendedor_ajeno', 'aceptado');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO r VALUES ('vendedor_ajeno', 'rechazado');
  END;
END $$;
RESET ROLE;

-- El agente 2 registra otra interacción.
INSERT INTO contact_interactions (id, account_id, contact_id, user_id, kind, occurred_at) VALUES
  ('00000000-0000-4000-8000-000000ee0002', '00000000-0000-4000-8000-0000000005d1', '00000000-0000-4000-8000-0000000e0001',
   '00000000-0000-4000-8000-000000000543', 'walk_in', NOW() - INTERVAL '1 hour');

-- El agente 1 no borra la del agente 2, pero sí corrige la suya.
SELECT FROM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000542","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
WITH d AS (DELETE FROM contact_interactions WHERE id = '00000000-0000-4000-8000-000000ee0002' RETURNING 1)
  INSERT INTO r SELECT 'agent1_borra_ajena', COUNT(*)::TEXT FROM d;
WITH u AS (UPDATE contact_interactions SET duration_seconds = 360 WHERE id = '00000000-0000-4000-8000-000000ee0001' RETURNING 1)
  INSERT INTO r SELECT 'agent1_corrige_propia', COUNT(*)::TEXT FROM u;
RESET ROLE;

-- ============================================================
-- Viewer: lee, no registra
-- ============================================================
SELECT FROM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000544","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO r SELECT 'viewer_interactions', COUNT(*)::TEXT
  FROM get_contact_timeline('00000000-0000-4000-8000-0000000e0001', ARRAY['interaction']);
DO $$
BEGIN
  BEGIN
    INSERT INTO contact_interactions (account_id, contact_id, user_id, kind) VALUES
      ('00000000-0000-4000-8000-0000000005d1', '00000000-0000-4000-8000-0000000e0001',
       '00000000-0000-4000-8000-000000000544', 'other');
    INSERT INTO r VALUES ('viewer_registra', 'si');
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO r VALUES ('viewer_registra', 'no');
  END;
END $$;
RESET ROLE;

-- ============================================================
-- Owner: ve el costo y borra la interacción ajena
-- ============================================================
SELECT FROM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000541","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO r SELECT 'owner_cost', data->>'purchase_cost'
  FROM get_contact_timeline('00000000-0000-4000-8000-0000000e0001', ARRAY['acquisition']);
WITH d AS (DELETE FROM contact_interactions WHERE id = '00000000-0000-4000-8000-000000ee0002' RETURNING 1)
  INSERT INTO r SELECT 'owner_borra_ajena', COUNT(*)::TEXT FROM d;
RESET ROLE;

-- ============================================================
-- Otra cuenta: cero
-- ============================================================
SELECT FROM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000545","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO r SELECT 'otra_timeline', COUNT(*)::TEXT FROM get_contact_timeline('00000000-0000-4000-8000-0000000e0001');
INSERT INTO r SELECT 'otra_msgs', COUNT(*)::TEXT FROM get_contact_conversation_messages('00000000-0000-4000-8000-0000000f0001');
INSERT INTO r SELECT 'otra_summary', COALESCE(get_contact_summary('00000000-0000-4000-8000-0000000e0001')::TEXT, 'null');
RESET ROLE;

-- Borrar al vendedor deja el vehículo con su tipo y sin vendedor.
DELETE FROM contacts WHERE id = '00000000-0000-4000-8000-0000000e0001';
INSERT INTO r SELECT 'vehiculo_tras_borrar', COALESCE(seller_contact_id::TEXT, 'sin vendedor') || ':' || acquisition_kind
  FROM inventory_vehicles WHERE id = '00000000-0000-4000-8000-0000000b0002';

-- ============================================================
-- Verificación
-- ============================================================
DO $$
DECLARE
  v_expected CONSTANT JSONB := '{
    "agent1_kinds": "acquisition,assignment,conversation,deal_created,deal_stage,first_contact,note,sale",
    "agent1_cost_present": "0",
    "agent1_stage_actor": "Agente2:Prospecto>Negociación",
    "agent1_conv": "2:Agente2",
    "agent1_msgs": "2",
    "agent1_msgs_tabla": "0",
    "agent1_summary": "0,1,1,1,false",
    "agent1_status": "Negociación:2/2,true,null,message",
    "agent1_pages": "123",
    "agent1_pages_len": "6",
    "futura": "rechazada",
    "walkin_outcome": "rechazada",
    "vendedor_ajeno": "rechazado",
    "agent1_borra_ajena": "0",
    "agent1_corrige_propia": "1",
    "viewer_interactions": "2",
    "viewer_registra": "no",
    "owner_cost": "12345678.00",
    "owner_borra_ajena": "1",
    "otra_timeline": "0",
    "otra_msgs": "0",
    "otra_summary": "null",
    "vehiculo_tras_borrar": "sin vendedor:trade_in"
  }';
  v_key TEXT;
  v_got TEXT;
BEGIN
  FOR v_key IN SELECT jsonb_object_keys(v_expected) LOOP
    SELECT r.v INTO v_got FROM r WHERE r.k = v_key;
    IF v_got IS DISTINCT FROM v_expected->>v_key THEN
      RAISE EXCEPTION 'FALLA %: esperaba %, obtuvo %', v_key, v_expected->>v_key, v_got;
    END IF;
    RAISE NOTICE 'ok  % = %', v_key, v_got;
  END LOOP;
END $$;

ROLLBACK;
