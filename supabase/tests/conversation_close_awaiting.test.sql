-- ============================================================
-- Prueba de la migración 559: cerrar una conversación limpia la espera
-- "Por responder", y lo que el cliente escriba después la vuelve a fijar.
--
-- Corre dentro de una transacción que termina en ROLLBACK: no deja nada.
--
--   MSYS_NO_PATHCONV=1 docker cp supabase/tests/conversation_close_awaiting.test.sql supabase_db_02-crm:/tmp/cca.sql
--   MSYS_NO_PATHCONV=1 docker exec supabase_db_02-crm psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/cca.sql
-- ============================================================
\set QUIET on
BEGIN;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email, aud, role, is_sso_user, is_anonymous) VALUES
  ('00000000-0000-4000-8000-000000000591', 'cca-owner@test.local', 'authenticated', 'authenticated', false, false);
SET LOCAL session_replication_role = origin;

INSERT INTO accounts (id, name, owner_user_id, default_currency) VALUES
  ('00000000-0000-4000-8000-0000000005e1', 'CCA', '00000000-0000-4000-8000-000000000591', 'COP');

INSERT INTO profiles (user_id, full_name, email, account_id, account_role) VALUES
  ('00000000-0000-4000-8000-000000000591', 'Owner', 'cca-owner@test.local', '00000000-0000-4000-8000-0000000005e1', 'owner');

INSERT INTO contacts (id, user_id, account_id, phone, name) VALUES
  ('00000000-0000-4000-8000-0000000e0101', '00000000-0000-4000-8000-000000000591', '00000000-0000-4000-8000-0000000005e1', '573100000101', 'Cliente');

INSERT INTO conversations (id, user_id, account_id, contact_id, last_message_at) VALUES
  ('00000000-0000-4000-8000-0000000f0101', '00000000-0000-4000-8000-000000000591', '00000000-0000-4000-8000-0000000005e1', '00000000-0000-4000-8000-0000000e0101', '2026-10-01 10:00+00');

DO $$
DECLARE
  v_conv CONSTANT UUID := '00000000-0000-4000-8000-0000000f0101';
  v_since TIMESTAMPTZ;
  v_status TEXT;
BEGIN
  -- El cliente escribe: queda esperando.
  INSERT INTO messages (conversation_id, sender_type, content_text, created_at)
    VALUES (v_conv, 'customer', 'Gracias', '2026-10-01 10:00+00');
  SELECT awaiting_reply_since INTO v_since FROM conversations WHERE id = v_conv;
  ASSERT v_since IS NOT NULL, 'el mensaje del cliente debe fijar la espera';

  -- Pasar a pendiente no atiende a nadie: la espera sigue.
  UPDATE conversations SET status = 'pending' WHERE id = v_conv;
  SELECT awaiting_reply_since INTO v_since FROM conversations WHERE id = v_conv;
  ASSERT v_since IS NOT NULL, 'pasar a pendiente no debe limpiar la espera';

  -- Cerrar limpia la espera.
  UPDATE conversations SET status = 'closed' WHERE id = v_conv;
  SELECT awaiting_reply_since INTO v_since FROM conversations WHERE id = v_conv;
  ASSERT v_since IS NULL, 'cerrar debe limpiar la espera';

  -- El cliente vuelve a escribir sobre el chat cerrado (el webhook guarda
  -- el mensaje y después reabre): vuelve a esperar, y reabrir no la borra.
  INSERT INTO messages (conversation_id, sender_type, content_text, created_at)
    VALUES (v_conv, 'customer', 'Otra pregunta', '2026-10-02 10:00+00');
  UPDATE conversations SET status = 'open' WHERE id = v_conv;
  SELECT awaiting_reply_since, status INTO v_since, v_status FROM conversations WHERE id = v_conv;
  ASSERT v_status = 'open', 'la conversación debe quedar abierta';
  ASSERT v_since = '2026-10-02 10:00+00', 'el cliente que vuelve a escribir debe fijar la espera de nuevo';

  -- Cerrar dentro de un UPDATE que toca otras columnas (el paso
  -- close_conversation de las automatizaciones) también la limpia.
  UPDATE conversations SET status = 'closed', updated_at = now() WHERE id = v_conv;
  SELECT awaiting_reply_since INTO v_since FROM conversations WHERE id = v_conv;
  ASSERT v_since IS NULL, 'el cierre por automatización debe limpiar la espera';
END;
$$;

-- Como lo hace el navegador: rol `authenticated`, sujeto a RLS y sin
-- EXECUTE sobre la función del trigger.
UPDATE conversations SET status = 'open', awaiting_reply_since = '2026-10-03 10:00+00'
 WHERE id = '00000000-0000-4000-8000-0000000f0101';

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000591","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
UPDATE conversations SET status = 'closed'
 WHERE id = '00000000-0000-4000-8000-0000000f0101';
RESET ROLE;

DO $$
DECLARE
  v_since TIMESTAMPTZ;
  v_status TEXT;
BEGIN
  SELECT awaiting_reply_since, status INTO v_since, v_status
  FROM conversations WHERE id = '00000000-0000-4000-8000-0000000f0101';
  ASSERT v_status = 'closed', 'el asesor debe poder cerrar';
  ASSERT v_since IS NULL, 'el cierre desde el navegador debe limpiar la espera';
END;
$$;

\echo 'conversation_close_awaiting: OK'
ROLLBACK;
