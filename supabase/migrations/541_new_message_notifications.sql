-- ============================================================
-- 541_new_message_notifications.sql
--
-- Aviso por mensaje entrante, para el asesor asignado.
--
-- Hasta aquí `notifications` solo tenía asignaciones. Ahora cada mensaje
-- de un cliente en una conversación CON asesor le deja un aviso a ese
-- asesor. Las conversaciones sin asesor las atiende el bot: no avisan a
-- nadie (decisión del negocio: nada de avisar a todos por todo).
--
-- POR QUÉ UN TRIGGER Y NO EL CÓDIGO DE RECEPCIÓN: igual que las
-- asignaciones, el mensaje entra por varios caminos (WhatsApp,
-- Instagram, Facebook, API). Un trigger los cubre todos sin que ninguno
-- tenga que acordarse. Y el push sale de `notifications` (migración
-- 542), así que basta con que el aviso exista.
--
-- UNA FILA POR CONVERSACIÓN, NO POR MENSAJE: mientras el asesor no lea
-- el aviso, los mensajes siguientes REFRESCAN esa misma fila (título,
-- extracto y `created_at`) en vez de apilar veinte. La campana cuenta
-- así conversaciones con mensajes pendientes. El índice único parcial
-- lo garantiza también ante dos mensajes simultáneos. Cada refresco
-- mueve `created_at`, y eso es lo que la 542 toma como "versión nueva
-- que merece su push".
--
-- `clock_timestamp()` y no `now()`: dos mensajes en la misma transacción
-- tendrían el mismo `now()` y el segundo no contaría como versión nueva.
--
-- Un fallo aquí NUNCA puede costar el mensaje: todo va dentro de
-- EXCEPTION WHEN OTHERS → WARNING, como en `notify_conversation_assigned`.
-- ============================================================

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'new_message'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_one_unread_message
  ON notifications(user_id, conversation_id)
  WHERE type = 'new_message' AND read_at IS NULL;

-- Extracto legible del mensaje: el texto recortado, o qué tipo de
-- adjunto es cuando no trae texto (una foto sin pie de foto).
CREATE OR REPLACE FUNCTION notification_message_preview(
  p_content_type TEXT,
  p_content_text TEXT
) RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN NULLIF(btrim(p_content_text), '') IS NOT NULL THEN
      CASE
        WHEN char_length(btrim(p_content_text)) > 140
          THEN left(btrim(p_content_text), 140) || '…'
        ELSE btrim(p_content_text)
      END
    WHEN p_content_type = 'image' THEN 'Foto'
    WHEN p_content_type = 'audio' THEN 'Audio'
    WHEN p_content_type = 'video' THEN 'Video'
    WHEN p_content_type = 'document' THEN 'Documento'
    WHEN p_content_type = 'location' THEN 'Ubicación'
    ELSE 'Mensaje nuevo'
  END
$$;

CREATE OR REPLACE FUNCTION notify_customer_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv RECORD;
  v_contact_name TEXT;
  v_title TEXT;
  v_body TEXT;
  v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
  SELECT id, account_id, contact_id, assigned_agent_id
    INTO v_conv
  FROM conversations
  WHERE id = NEW.conversation_id;

  -- Sin asesor: la atiende el bot, nadie recibe aviso.
  IF v_conv.id IS NULL OR v_conv.assigned_agent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(name, ''), phone) INTO v_contact_name
  FROM contacts WHERE id = v_conv.contact_id;

  v_title := 'Mensaje de ' || COALESCE(v_contact_name, 'un cliente');
  v_body := notification_message_preview(NEW.content_type, NEW.content_text);

  INSERT INTO notifications (
    account_id, user_id, type, conversation_id, contact_id,
    actor_user_id, title, body, created_at
  ) VALUES (
    v_conv.account_id,
    v_conv.assigned_agent_id,
    'new_message',
    v_conv.id,
    v_conv.contact_id,
    NULL,
    v_title,
    v_body,
    v_now
  )
  ON CONFLICT (user_id, conversation_id)
    WHERE type = 'new_message' AND read_at IS NULL
  DO UPDATE SET
    title = EXCLUDED.title,
    body = EXCLUDED.body,
    contact_id = EXCLUDED.contact_id,
    created_at = EXCLUDED.created_at;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'No se pudo crear el aviso de mensaje de la conversación %: %',
    NEW.conversation_id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION notify_customer_message() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION notify_customer_message() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_customer_message_notify ON messages;
CREATE TRIGGER on_customer_message_notify
  AFTER INSERT ON messages
  FOR EACH ROW
  WHEN (NEW.sender_type = 'customer')
  EXECUTE FUNCTION notify_customer_message();
