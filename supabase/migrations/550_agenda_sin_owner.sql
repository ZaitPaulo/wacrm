-- ============================================================
-- 550_agenda_sin_owner.sql
--
-- El owner de la cuenta no participa en la Agenda (pedido del 2026-10-09):
-- no atiende visitas, así que tampoco recibe el aviso de "no asistió",
-- que en la 549 iba a owner y admin. Ahora va solo a admin.
--
-- La lista de asesores de la Agenda lo excluye del lado de la app
-- (`agendaAgents`). Esta migración solo redefine la función de avisos;
-- el trigger de la 549 sigue apuntando a ella.
--
-- Idempotente. Rollback: volver a correr la función de la 549.
-- ============================================================

CREATE OR REPLACE FUNCTION appointments_lifecycle_alerts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor        UUID := auth.uid();
  v_contact      TEXT;
  v_agent_name   TEXT;
  v_moved        BOOLEAN := NEW.starts_at IS DISTINCT FROM OLD.starts_at
                            OR NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes;
  v_reassigned   BOOLEAN := NEW.assigned_agent_id IS DISTINCT FROM OLD.assigned_agent_id;
BEGIN
  SELECT COALESCE(NULLIF(name, ''), 'Un cliente') INTO v_contact
  FROM contacts WHERE id = NEW.contact_id;
  v_contact := COALESCE(v_contact, 'Un cliente');

  -- 3. El cliente confirmó con el botón del recordatorio.
  IF NEW.customer_response = 'confirmed'
     AND OLD.customer_response IS DISTINCT FROM 'confirmed' THEN
    BEGIN
      INSERT INTO notifications (account_id, user_id, type, conversation_id, contact_id,
                                 appointment_id, actor_user_id, title, body)
      VALUES (NEW.account_id, NEW.assigned_agent_id, 'appointment_customer_confirmed',
              NEW.conversation_id, NEW.contact_id, NEW.id, v_actor,
              v_contact || ' confirmó su visita',
              appointment_when_es(NEW.starts_at));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Aviso de confirmación de la cita % falló: %', NEW.id, SQLERRM;
    END;
  END IF;

  -- 4. Otra persona movió o canceló la cita, sin cambiarla de asesor.
  IF NOT v_reassigned
     AND v_actor IS NOT NULL
     AND v_actor IS DISTINCT FROM NEW.assigned_agent_id
     AND (v_moved OR (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')) THEN
    BEGIN
      INSERT INTO notifications (account_id, user_id, type, conversation_id, contact_id,
                                 appointment_id, actor_user_id, title, body)
      VALUES (NEW.account_id, NEW.assigned_agent_id, 'appointment_updated',
              NEW.conversation_id, NEW.contact_id, NEW.id, v_actor,
              CASE WHEN NEW.status = 'cancelled'
                   THEN 'Se canceló tu cita con ' || v_contact
                   ELSE 'Se movió tu cita con ' || v_contact END,
              CASE WHEN NEW.status = 'cancelled'
                   THEN appointment_when_es(OLD.starts_at)
                   ELSE 'De ' || appointment_when_es(OLD.starts_at)
                        || ' a ' || appointment_when_es(NEW.starts_at) END);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Aviso de cita cambiada % falló: %', NEW.id, SQLERRM;
    END;
  END IF;

  -- 5. Se la quitaron al asesor anterior.
  IF v_reassigned AND OLD.assigned_agent_id IS DISTINCT FROM v_actor THEN
    BEGIN
      SELECT full_name INTO v_agent_name FROM profiles WHERE user_id = NEW.assigned_agent_id;
      INSERT INTO notifications (account_id, user_id, type, conversation_id, contact_id,
                                 appointment_id, actor_user_id, title, body)
      VALUES (NEW.account_id, OLD.assigned_agent_id, 'appointment_unassigned',
              NEW.conversation_id, NEW.contact_id, NEW.id, v_actor,
              'La cita de ' || v_contact || ' pasó a ' || COALESCE(NULLIF(v_agent_name, ''), 'otro asesor'),
              appointment_when_es(OLD.starts_at));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Aviso de cita quitada % falló: %', NEW.id, SQLERRM;
    END;
  END IF;

  -- 7. No asistió: a admin (no al owner, que no está en la Agenda), salvo quien lo marcó.
  IF NEW.status = 'no_show' AND OLD.status IS DISTINCT FROM 'no_show' THEN
    BEGIN
      SELECT full_name INTO v_agent_name FROM profiles WHERE user_id = NEW.assigned_agent_id;
      INSERT INTO notifications (account_id, user_id, type, conversation_id, contact_id,
                                 appointment_id, actor_user_id, title, body)
      SELECT NEW.account_id, p.user_id, 'appointment_no_show',
             NEW.conversation_id, NEW.contact_id, NEW.id, v_actor,
             v_contact || ' no asistió a su cita',
             'Con ' || COALESCE(NULLIF(v_agent_name, ''), 'su asesor') || ' · '
               || appointment_when_es(NEW.starts_at)
      FROM profiles p
      WHERE p.account_id = NEW.account_id
        AND p.account_role = 'admin'
        AND p.user_id IS DISTINCT FROM v_actor;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Aviso de no asistió % falló: %', NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NULL;
END;
$$;

ALTER FUNCTION appointments_lifecycle_alerts() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION appointments_lifecycle_alerts() FROM PUBLIC, anon, authenticated;
