-- ============================================================
-- 527_notification_text_es.sql
--
-- Las notificaciones de asignación, en español.
--
-- La 521 dejó en español solo el aviso de una transferencia del bot. El
-- de una asignación hecha por otra vía seguía en inglés: "New
-- conversation assigned" / "Someone assigned you a conversation with
-- Juan". "Someone" salía siempre que asigna el sistema —una
-- automatización como "Propietario: pasar a Angélica"—, porque ahí
-- `auth.uid()` es NULL y no hay nombre que poner.
--
-- Ahora:
--   con persona  → "Angélica te asignó una conversación con Juan"
--   sin persona  → "Se te asignó una conversación con Juan"
--   título       → "Nueva conversación asignada"
--
-- Y se traducen los avisos que ya estaban guardados en inglés: son
-- inmutables para los clientes (la 027 solo deja cambiar `read_at`), así
-- que únicamente una migración puede corregirlos.
--
-- Idempotente: CREATE OR REPLACE, y los UPDATE solo tocan filas que
-- siguen en inglés. El trigger de la 027 apunta a esta misma función.
-- ============================================================

CREATE OR REPLACE FUNCTION notify_conversation_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_name TEXT;
  v_actor_name TEXT;
  v_title TEXT;
  v_body TEXT;
  v_is_ai BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_agent_id IS NULL THEN
      RETURN NEW;
    END IF;
  ELSE
    IF NEW.assigned_agent_id IS NULL
       OR NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Skip self-assignment — nothing to notify the agent about.
  IF auth.uid() IS NOT NULL AND auth.uid() = NEW.assigned_agent_id THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(name, ''), phone) INTO v_contact_name
  FROM contacts WHERE id = NEW.contact_id;

  IF auth.uid() IS NOT NULL THEN
    SELECT full_name INTO v_actor_name
    FROM profiles WHERE user_id = auth.uid();
  END IF;

  -- Sin actor humano y con resumen del bot: la asignación viene de una
  -- transferencia de la IA.
  v_is_ai := auth.uid() IS NULL
             AND NEW.ai_handoff_summary IS NOT NULL
             AND NEW.ai_handoff_summary <> '';

  IF v_is_ai THEN
    -- Título propio para poder distinguirlas de un vistazo en la campana.
    v_title := 'Cliente asignado por el asistente';
    v_body := 'Conversación con ' || COALESCE(v_contact_name, 'un contacto')
              || E'\n' || NEW.ai_handoff_summary;
  ELSE
    v_title := 'Nueva conversación asignada';
    -- Sin actor la asignó el sistema (una automatización, por ejemplo):
    -- se dice en impersonal en vez de inventar un "Alguien".
    v_body := CASE
                WHEN v_actor_name IS NOT NULL AND v_actor_name <> ''
                  THEN v_actor_name || ' te asignó una conversación con '
                ELSE 'Se te asignó una conversación con '
              END
              || COALESCE(v_contact_name, 'un contacto');
  END IF;

  INSERT INTO notifications (
    account_id, user_id, type, conversation_id, contact_id,
    actor_user_id, title, body
  ) VALUES (
    NEW.account_id,
    NEW.assigned_agent_id,
    'conversation_assigned',
    NEW.id,
    NEW.contact_id,
    auth.uid(),
    v_title,
    v_body
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a notification failure block the assignment itself.
  RAISE WARNING 'No se pudo crear la notificación de asignación de la conversación %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;


-- Avisos ya guardados. El orden importa: primero el caso sin actor, que
-- también calza con el patrón general.
UPDATE notifications
SET body = 'Se te asignó una conversación con '
           || substring(body FROM '^Someone assigned you a conversation with (.*)$')
WHERE type = 'conversation_assigned'
  AND body ~ '^Someone assigned you a conversation with ';

UPDATE notifications
SET body = regexp_replace(body, '^(.*) assigned you a conversation with (.*)$',
                          '\1 te asignó una conversación con \2')
WHERE type = 'conversation_assigned'
  AND body ~ ' assigned you a conversation with ';

UPDATE notifications
SET body = regexp_replace(body, 'una conversación con a contact$', 'una conversación con un contacto')
WHERE type = 'conversation_assigned'
  AND body ~ 'una conversación con a contact$';

UPDATE notifications
SET title = 'Nueva conversación asignada'
WHERE type = 'conversation_assigned'
  AND title = 'New conversation assigned';

-- El motivo de los resúmenes del bot, legible. Se escribía con el código
-- interno ("Motivo: pide_humano") y lo lee el asesor, en la conversación
-- y en el aviso. Los motivos que ya se leen igual (reclamo, permuta,
-- visita, papeles, otro) no cambian.
UPDATE conversations
SET ai_handoff_summary = replace(replace(replace(ai_handoff_summary,
      'Motivo: pide_humano ·', 'Motivo: pidió hablar con una persona ·'),
      'Motivo: negociacion ·', 'Motivo: negociación ·'),
      'Motivo: credito ·', 'Motivo: crédito ·')
WHERE ai_handoff_summary ~ 'Motivo: (pide_humano|negociacion|credito) ·';

UPDATE notifications
SET body = replace(replace(replace(body,
      'Motivo: pide_humano ·', 'Motivo: pidió hablar con una persona ·'),
      'Motivo: negociacion ·', 'Motivo: negociación ·'),
      'Motivo: credito ·', 'Motivo: crédito ·')
WHERE type = 'conversation_assigned'
  AND body ~ 'Motivo: (pide_humano|negociacion|credito) ·';

-- Mensajes de un tipo que la API de WhatsApp no entrega, guardados con
-- el aviso en inglés: el asesor lo lee en la bandeja.
UPDATE messages
SET content_text = regexp_replace(content_text,
      '^\[Unsupported message type: (.*)\]$',
      '[Mensaje no compatible con el CRM (\1): pídele al cliente que lo escriba o lo reenvíe]')
WHERE content_text ~ '^\[Unsupported message type: .*\]$';
