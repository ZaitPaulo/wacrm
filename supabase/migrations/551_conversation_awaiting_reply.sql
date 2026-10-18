-- ============================================================
-- 551_conversation_awaiting_reply.sql
--
-- "Por responder": desde cuándo un cliente espera respuesta de una
-- persona (cambio chats-por-responder).
--
-- La bandeja solo tenía "No leídos", y `unread_count` vuelve a 0 en
-- cuanto alguien abre el chat aunque nadie conteste: leer no es atender.
--
-- 1. `conversations.awaiting_reply_since`: la fija el primer mensaje del
--    cliente sin espera previa (conserva la más antigua) y la limpia el
--    mensaje de un asesor humano (`agent` con `sender_id`). El bot, las
--    automatizaciones, los flujos, los recordatorios y la API v1 (`agent`
--    sin `sender_id`) no la tocan. "Marcar como atendido" la limpia desde
--    el cliente, igual que hoy se hace con `unread_count`.
-- 2. Trigger sobre `messages` y no en cada ruta de envío: hay al menos
--    seis caminos que insertan mensajes y el trigger cubre los futuros.
-- 3. Backfill solo de lo activo en los últimos 7 días, contando cualquier
--    mensaje `agent`: antes de la 532 los del asesor no traían
--    `sender_id`, y exigirlo dejaría en rojo chats ya atendidos.
--
-- Columna nueva en tabla existente: hereda los GRANT de su tabla.
-- Idempotente.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS awaiting_reply_since TIMESTAMPTZ;

COMMENT ON COLUMN conversations.awaiting_reply_since IS
  'Desde cuándo el cliente espera respuesta de un asesor humano. La mantiene el trigger on_message_awaiting_reply; "Marcar como atendido" la pone en NULL. NULL = no espera.';

-- Solo se indexan las pendientes: pocas filas, índice chico.
CREATE INDEX IF NOT EXISTS idx_conversations_awaiting_reply
  ON conversations(account_id, awaiting_reply_since)
  WHERE awaiting_reply_since IS NOT NULL;

CREATE OR REPLACE FUNCTION track_conversation_awaiting_reply()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- UPDATE atómico, sin leer-modificar-escribir (misma lección que 037).
  IF NEW.sender_type = 'customer' THEN
    UPDATE conversations
       SET awaiting_reply_since = COALESCE(awaiting_reply_since, NEW.created_at)
     WHERE id = NEW.conversation_id
       AND awaiting_reply_since IS NULL;
  ELSIF NEW.sender_type = 'agent' AND NEW.sender_id IS NOT NULL THEN
    UPDATE conversations
       SET awaiting_reply_since = NULL
     WHERE id = NEW.conversation_id
       AND awaiting_reply_since IS NOT NULL;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Nunca tumbar el guardado de un mensaje por esto.
  RAISE WARNING 'No se pudo actualizar la espera de la conversación %: %',
    NEW.conversation_id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION track_conversation_awaiting_reply() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION track_conversation_awaiting_reply() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_message_awaiting_reply ON messages;
CREATE TRIGGER on_message_awaiting_reply
  AFTER INSERT ON messages
  FOR EACH ROW
  WHEN (NEW.sender_type = 'customer'
        OR (NEW.sender_type = 'agent' AND NEW.sender_id IS NOT NULL))
  EXECUTE FUNCTION track_conversation_awaiting_reply();

-- Backfill: pendiente si hay un mensaje del cliente posterior al último
-- `agent`, desde el primero de esos mensajes. Solo se escribe si no hay
-- espera ya fijada, así correr la migración otra vez no la mueve.
WITH recent AS (
  SELECT c.id
  FROM conversations c
  WHERE c.last_message_at >= now() - interval '7 days'
    AND c.awaiting_reply_since IS NULL
),
last_agent AS (
  SELECT r.id, max(m.created_at) AS at
  FROM recent r
  LEFT JOIN messages m
    ON m.conversation_id = r.id AND m.sender_type = 'agent'
  GROUP BY r.id
),
pending AS (
  SELECT la.id, min(m.created_at) AS since
  FROM last_agent la
  JOIN messages m
    ON m.conversation_id = la.id
   AND m.sender_type = 'customer'
   AND (la.at IS NULL OR m.created_at > la.at)
  GROUP BY la.id
)
UPDATE conversations c
   SET awaiting_reply_since = p.since
  FROM pending p
 WHERE c.id = p.id
   AND c.awaiting_reply_since IS NULL;
