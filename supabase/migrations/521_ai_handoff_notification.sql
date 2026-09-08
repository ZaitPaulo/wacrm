-- ============================================================
-- 521_ai_handoff_notification.sql
--
-- La notificación de asignación dice de qué va la conversación.
--
-- Redefine `notify_conversation_assigned` (migración 027) para que,
-- cuando quien asigna es el bot, el cuerpo de la notificación sea el
-- resumen que el bot dejó en la conversación.
--
-- El problema que arregla:
--   El cuerpo se componía siempre como "<actor> assigned you a
--   conversation with <contacto>", y el actor sale de `auth.uid()`. El
--   auto-reply asigna con el service role, donde `auth.uid()` es NULL,
--   así que al asesor le llegaba literalmente "Someone assigned you a
--   conversation with Juan" — sin una palabra sobre qué quiere Juan,
--   pese a que el bot ya le había sacado nombre, presupuesto, vehículo
--   de interés y si necesita crédito.
--
-- Cómo distingue una de otra:
--   `ai_handoff_summary` se escribe en el MISMO UPDATE que
--   `assigned_agent_id` (ver `handOffToHuman`), así que dentro del
--   trigger `NEW.ai_handoff_summary` ya trae el resumen de ESTA
--   transferencia. Con `auth.uid()` NULL y ese campo presente, la
--   asignación es del bot. Cualquier otro caso es una persona
--   asignando, y ahí el texto no cambia.
--
-- Idempotente — CREATE OR REPLACE; seguro de re-ejecutar. El trigger de
-- la 027 sigue apuntando a esta misma función y no se recrea.
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
    v_title := 'New conversation assigned';
    v_body := COALESCE(v_actor_name, 'Someone') || ' assigned you a conversation with '
              || COALESCE(v_contact_name, 'a contact');
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
  RAISE WARNING 'Failed to create assignment notification for conversation %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;
