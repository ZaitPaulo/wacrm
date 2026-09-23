-- ============================================================
-- 540_push_subscriptions.sql
--
-- Dispositivos que recibieron permiso para avisos push (Web Push).
--
-- Una fila por dispositivo: el `endpoint` es la dirección que el
-- servicio de push del navegador (FCM, Mozilla, Apple) le asignó a ESE
-- navegador en ESE equipo, y `p256dh`/`auth` son las claves con las que
-- se cifra el aviso para que solo ese navegador pueda leerlo.
--
-- QUIÉN ESCRIBE: solo el servidor, con service-role, desde
-- `POST /api/push/subscriptions`. El motivo es que un endpoint puede
-- cambiar de dueño —dos asesores que comparten un computador—, y
-- reasignarlo es tocar una fila de otro usuario, que la RLS le negaría
-- al cliente. El cliente puede leer y borrar las suyas.
--
-- PRIVILEGIOS: en el VPS `pg_default_acl` le da TODO a `anon` y a
-- `authenticated` sobre cada tabla nueva de `public` (ver memoria
-- grants-tablas-nuevas). Por eso primero se revoca todo y después se
-- concede lo justo; así el comportamiento es el mismo en local y en
-- producción.
-- ============================================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- URL del servicio de push. Única: un navegador tiene una sola
  -- suscripción por origen, así que un mismo endpoint es un mismo
  -- dispositivo.
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  -- Para reconocer el dispositivo al diagnosticar ("Chrome en Android").
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Último envío aceptado por el servicio de push. Sirve para ver en la
  -- base qué dispositivos están vivos.
  last_success_at TIMESTAMPTZ
);

-- El despacho busca las suscripciones del destinatario de cada aviso.
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON push_subscriptions(user_id);

REVOKE ALL ON push_subscriptions FROM anon, authenticated;
GRANT SELECT, DELETE ON push_subscriptions TO authenticated;
GRANT ALL ON push_subscriptions TO service_role;

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_subscriptions_select ON push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_delete ON push_subscriptions;
CREATE POLICY push_subscriptions_select ON push_subscriptions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY push_subscriptions_delete ON push_subscriptions FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
