-- ============================================================
-- 559_close_clears_awaiting_reply.sql
--
-- Cerrar una conversación la saca de "Por responder".
--
-- La 551 solo limpiaba la espera con un mensaje de un asesor o con
-- "Marcar como atendido", y el filtro no mira `status`: un chat cerrado
-- seguía en rojo ("Esperando · hace 4 días") por más que lo cerraran.
--
-- 1. Trigger BEFORE UPDATE OF status y no en cada ruta: se cierra desde
--    el hilo y desde el paso `close_conversation` de las automatizaciones,
--    y el trigger cubre los futuros (misma razón que en la 551). Solo en
--    la transición a `closed`: pendiente no atiende a nadie.
-- 2. Si el cliente vuelve a escribir, `on_message_awaiting_reply` fija la
--    espera y `reopenClosedConversation` reabre: ese UPDATE no pasa por
--    aquí, así que el chat vuelve a "Por responder" como debe.
-- 3. Backfill de los ya cerrados, que hoy siguen contando como pendientes.
--
-- Idempotente.
-- ============================================================

CREATE OR REPLACE FUNCTION clear_awaiting_reply_on_close()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.awaiting_reply_since := NULL;
  RETURN NEW;
END;
$$;

ALTER FUNCTION clear_awaiting_reply_on_close() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION clear_awaiting_reply_on_close() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_conversation_close_clear_awaiting ON conversations;
CREATE TRIGGER on_conversation_close_clear_awaiting
  BEFORE UPDATE OF status ON conversations
  FOR EACH ROW
  WHEN (NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed')
  EXECUTE FUNCTION clear_awaiting_reply_on_close();

COMMENT ON COLUMN conversations.awaiting_reply_since IS
  'Desde cuándo el cliente espera respuesta de un asesor humano. La mantiene el trigger on_message_awaiting_reply; "Marcar como atendido" y cerrar la conversación la ponen en NULL. NULL = no espera.';

UPDATE conversations
   SET awaiting_reply_since = NULL
 WHERE status = 'closed'
   AND awaiting_reply_since IS NOT NULL;
