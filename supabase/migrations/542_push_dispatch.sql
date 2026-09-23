-- ============================================================
-- 542_push_dispatch.sql
--
-- Cada aviso nuevo de `notifications` pide su push, venga de donde venga.
--
-- LA FUENTE ÚNICA ES `notifications`. Las asignaciones ya llegan ahí por
-- el trigger de la 027 (bot, automatizaciones, flujos, bandeja, API v1,
-- SQL, y cualquier job futuro), y los mensajes entrantes desde la 541.
-- Así que el envío se engancha AQUÍ y ningún camino tiene que acordarse
-- de pedirlo.
--
-- CÓMO: un trigger llama a `net.http_post` (pg_net) contra una ruta
-- interna de la app, `/api/push/dispatch`, que cifra y envía con
-- `web-push`. pg_net encola la petición dentro de la transacción y su
-- worker la manda DESPUÉS del commit: si la asignación hace rollback no
-- sale nada, y la transacción no espera a la red. En el VPS la base
-- llega a la app por la red de Docker (`http://app:3000`, 20 ms medidos
-- el 2026-09-23), sin DNS externo ni TLS. Ver design.md, D2.
--
-- DÓNDE ESTÁ LA URL Y EL SECRETO: en Supabase Vault, no aquí —una
-- migración se versiona—. Se cargan una vez por entorno con
-- `select configure_push_dispatch('<url>', '<secreto>');`. Sin ellos el
-- trigger no hace nada y el barrido por cron (cada minuto) entrega igual,
-- solo que más tarde.
--
-- IDEMPOTENCIA: un aviso `new_message` se refresca con cada mensaje; cada
-- refresco es una VERSIÓN nueva `(id, created_at)` que merece su push.
-- `push_notification_dispatches` registra qué versiones ya se enviaron:
-- reclamar es insertar ahí, y el que choca con la clave primaria pierde.
-- Así el despacho repetido y el barrido no mandan dos veces lo mismo.
-- Es una tabla aparte, y no una columna de `notifications`, porque cada
-- reclamo sería un UPDATE que Realtime reenvía a la campana.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

-- ------------------------------------------------------------
-- Registro de envíos
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS push_notification_dispatches (
  notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  -- El `created_at` de la notificación en el momento del envío: la
  -- versión que se mandó.
  notified_at TIMESTAMPTZ NOT NULL,
  dispatched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (notification_id, notified_at)
);

CREATE INDEX IF NOT EXISTS idx_push_notification_dispatches_at
  ON push_notification_dispatches(dispatched_at);

-- Solo el servidor. RLS activa sin políticas: aunque alguien concediera
-- privilegios por error, el cliente no vería nada.
REVOKE ALL ON push_notification_dispatches FROM anon, authenticated;
GRANT ALL ON push_notification_dispatches TO service_role;
ALTER TABLE push_notification_dispatches ENABLE ROW LEVEL SECURITY;

-- El barrido busca avisos sin leer recientes.
CREATE INDEX IF NOT EXISTS idx_notifications_unread_created
  ON notifications(created_at)
  WHERE read_at IS NULL;

-- ------------------------------------------------------------
-- Reclamo de UNA notificación (lo usa /api/push/dispatch)
-- ------------------------------------------------------------
-- Devuelve la notificación si esta versión todavía no se envió y sigue
-- sin leer; si no, nada.
CREATE OR REPLACE FUNCTION claim_notification_push(p_notification_id UUID)
RETURNS SETOF notifications
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  WITH n AS (
    SELECT * FROM notifications
    WHERE id = p_notification_id AND read_at IS NULL
  ),
  claimed AS (
    INSERT INTO push_notification_dispatches (notification_id, notified_at)
    SELECT id, created_at FROM n
    ON CONFLICT DO NOTHING
    RETURNING notification_id
  )
  SELECT n.* FROM n JOIN claimed ON claimed.notification_id = n.id;
$$;

-- ------------------------------------------------------------
-- Barrido (lo usa /api/push/cron cada minuto)
-- ------------------------------------------------------------
-- Toma las versiones sin envío registrado con entre 20 s y 15 min de
-- antigüedad: el piso deja trabajar al despacho inmediato, el techo
-- evita que tras un despliegue largo suenen avisos que ya no sirven.
-- Poda de paso el registro de más de dos días.
CREATE OR REPLACE FUNCTION claim_pending_notification_pushes(p_limit INT DEFAULT 50)
RETURNS SETOF notifications
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  DELETE FROM push_notification_dispatches
  WHERE dispatched_at < NOW() - INTERVAL '2 days';

  RETURN QUERY
  WITH cand AS (
    SELECT n.*
    FROM notifications n
    WHERE n.read_at IS NULL
      AND n.created_at >= clock_timestamp() - INTERVAL '15 minutes'
      AND n.created_at <= clock_timestamp() - INTERVAL '20 seconds'
      AND NOT EXISTS (
        SELECT 1 FROM push_notification_dispatches d
        WHERE d.notification_id = n.id AND d.notified_at = n.created_at
      )
    ORDER BY n.created_at
    LIMIT GREATEST(1, LEAST(p_limit, 200))
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    INSERT INTO push_notification_dispatches (notification_id, notified_at)
    SELECT id, created_at FROM cand
    ON CONFLICT DO NOTHING
    RETURNING notification_id
  )
  SELECT cand.* FROM cand JOIN claimed ON claimed.notification_id = cand.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION claim_notification_push(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION claim_pending_notification_pushes(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_notification_push(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION claim_pending_notification_pushes(INT) TO service_role;

-- ------------------------------------------------------------
-- Configuración en Vault
-- ------------------------------------------------------------
-- `select configure_push_dispatch('http://app:3000/api/push/dispatch', '<secreto>');`
-- `select configure_push_dispatch(null, null);` apaga el despacho inmediato.
CREATE OR REPLACE FUNCTION configure_push_dispatch(p_url TEXT, p_secret TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT;
  v_value TEXT;
  v_id UUID;
BEGIN
  FOR v_name, v_value IN
    SELECT * FROM (VALUES ('push_dispatch_url', p_url), ('push_dispatch_secret', p_secret)) AS t(n, v)
  LOOP
    SELECT id INTO v_id FROM vault.secrets WHERE name = v_name;
    IF v_value IS NULL OR v_value = '' THEN
      IF v_id IS NOT NULL THEN
        DELETE FROM vault.secrets WHERE id = v_id;
      END IF;
    ELSIF v_id IS NULL THEN
      PERFORM vault.create_secret(v_value, v_name, 'Despacho de avisos push (542)');
    ELSE
      PERFORM vault.update_secret(v_id, v_value);
    END IF;
  END LOOP;
END;
$$;

ALTER FUNCTION configure_push_dispatch(TEXT, TEXT) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION configure_push_dispatch(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- El trigger
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION request_notification_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url TEXT;
  v_secret TEXT;
BEGIN
  -- Solo versiones nuevas: un INSERT, o un refresco que movió
  -- `created_at`. Marcar leído no pide nada.
  IF TG_OP = 'UPDATE' AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at THEN
    RETURN NEW;
  END IF;
  IF NEW.read_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets WHERE name = 'push_dispatch_url';
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets WHERE name = 'push_dispatch_secret';

  -- Sin configurar: el barrido por cron se encarga.
  IF v_url IS NULL OR v_secret IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    body := jsonb_build_object('notification_id', NEW.id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', v_secret
    ),
    timeout_milliseconds := 10000
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Nunca bloquear la asignación ni el mensaje por un aviso.
  RAISE WARNING 'No se pudo pedir el push de la notificación %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION request_notification_push() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION request_notification_push() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_notification_request_push ON notifications;
CREATE TRIGGER on_notification_request_push
  AFTER INSERT OR UPDATE OF created_at ON notifications
  FOR EACH ROW
  EXECUTE FUNCTION request_notification_push();
