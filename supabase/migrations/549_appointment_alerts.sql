-- ============================================================
-- 549_appointment_alerts.sql
--
-- Avisos e indicadores de la Agenda (openspec/changes/agenda-citas-avisos,
-- fase 3). Se monta sobre la 548 sin redefinir sus triggers: agrega dos
-- triggers propios sobre `appointments` (columnas y avisos) y dos sobre
-- `inventory_vehicles`.
--
-- Avisos nuevos (todos van al asesor de la cita salvo el 7):
--   1 appointment_vehicle_unavailable  el carro se vendió, ocultó o borró
--   2 appointment_pre_visit            X minutos antes (cron)
--   3 appointment_customer_confirmed   el cliente tocó "Confirmo"
--   4 appointment_updated              otra persona movió o canceló la cita
--   5 appointment_unassigned           al asesor anterior, al reasignar
--   6 appointment_attendance_pending   citas del día sin marcar (cron)
--   7 appointment_no_show              a owner y admin
--
-- Regla común: nadie recibe aviso de lo que hizo él mismo, y un fallo al
-- crear un aviso nunca bloquea el cambio que lo origina.
--
-- Idempotente. Rollback al final.
-- ============================================================

-- ============================================================
-- notifications: tipos y destino explícito
-- ============================================================

-- ATENCIÓN: este CHECK se reescribe entero. Tiene que llevar TODOS los
-- tipos anteriores (541, 546 y 548); uno que falte rompe en silencio los
-- avisos de esa función. En la 548 casi se pierden los de traspaso.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    -- 027 / 541
    'conversation_assigned',
    'new_message',
    -- 546
    'handoff_reminder',
    'handoff_unattended',
    -- 548
    'appointment_assigned',
    'appointment_change_requested',
    'appointment_digest',
    -- 549
    'appointment_vehicle_unavailable',
    'appointment_pre_visit',
    'appointment_customer_confirmed',
    'appointment_updated',
    'appointment_unassigned',
    'appointment_attendance_pending',
    'appointment_no_show'
  ));

-- A dónde lleva el aviso cuando no basta con la conversación o la cita
-- (el de asistencia sin marcar abre la vista Día de una fecha). Solo
-- rutas propias: empieza con una barra y no con dos.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link_path TEXT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notifications_link_path_check'
  ) THEN
    ALTER TABLE notifications ADD CONSTRAINT notifications_link_path_check
      CHECK (link_path IS NULL OR link_path ~ '^/[^/]');
  END IF;
END $$;

-- ============================================================
-- Columnas nuevas
-- ============================================================
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS pre_visit_alerted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attendance_reminded_at TIMESTAMPTZ;

-- NULL = aviso de visita próxima apagado.
ALTER TABLE appointment_settings
  ADD COLUMN IF NOT EXISTS pre_visit_alert_minutes INTEGER DEFAULT 60;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'appointment_settings_pre_visit_range'
  ) THEN
    ALTER TABLE appointment_settings ADD CONSTRAINT appointment_settings_pre_visit_range
      CHECK (pre_visit_alert_minutes IS NULL OR pre_visit_alert_minutes BETWEEN 15 AND 240);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_appointments_pre_visit_queue
  ON appointments (account_id, starts_at)
  WHERE status IN ('scheduled', 'confirmed') AND pre_visit_alerted_at IS NULL;

-- ============================================================
-- Columnas de aviso (BEFORE). Corre antes que `appointments_before_write`
-- por orden alfabético; no depende de él.
-- ============================================================
CREATE OR REPLACE FUNCTION appointments_alert_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Las escribe solo el cron (sin sesión).
  IF auth.uid() IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      NEW.pre_visit_alerted_at := NULL;
      NEW.attendance_reminded_at := NULL;
    ELSE
      NEW.pre_visit_alerted_at := OLD.pre_visit_alerted_at;
      NEW.attendance_reminded_at := OLD.attendance_reminded_at;
    END IF;
  END IF;

  -- Reagendar: la hora nueva tiene su propio aviso de visita próxima y
  -- su propio aviso de asistencia.
  IF TG_OP = 'UPDATE'
     AND (NEW.starts_at IS DISTINCT FROM OLD.starts_at
          OR NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes) THEN
    NEW.pre_visit_alerted_at := NULL;
    NEW.attendance_reminded_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION appointments_alert_columns() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION appointments_alert_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS appointments_alert_columns ON appointments;
CREATE TRIGGER appointments_alert_columns
  BEFORE INSERT OR UPDATE ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION appointments_alert_columns();

-- ============================================================
-- Avisos 3, 4, 5 y 7 (AFTER UPDATE)
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

  -- 7. No asistió: a owner y admin, salvo quien lo marcó.
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
        AND p.account_role IN ('admin', 'owner')
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

DROP TRIGGER IF EXISTS appointments_lifecycle_alerts ON appointments;
CREATE TRIGGER appointments_lifecycle_alerts
  AFTER UPDATE ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION appointments_lifecycle_alerts();

-- ============================================================
-- Aviso 1: el carro de una cita deja de estar disponible
-- ============================================================

-- Avisa por cada cita activa y futura con ese vehículo, salvo que el
-- comprador sea el mismo cliente de la cita.
CREATE OR REPLACE FUNCTION notify_vehicle_unavailable(
  p_vehicle_id UUID,
  p_account_id UUID,
  p_label TEXT,
  p_what TEXT,
  p_buyer_contact_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO notifications (account_id, user_id, type, conversation_id, contact_id,
                             appointment_id, actor_user_id, title, body)
  SELECT a.account_id, a.assigned_agent_id, 'appointment_vehicle_unavailable',
         a.conversation_id, a.contact_id, a.id, auth.uid(),
         p_what || ' ' || p_label,
         COALESCE(NULLIF(c.name, ''), 'Tu cliente') || ' viene el ' || appointment_when_es(a.starts_at)
  FROM appointment_vehicles av
  JOIN appointments a ON a.id = av.appointment_id
  LEFT JOIN contacts c ON c.id = a.contact_id
  WHERE av.vehicle_id = p_vehicle_id
    AND a.account_id = p_account_id
    AND a.status IN ('scheduled', 'confirmed')
    AND a.starts_at > NOW()
    AND a.contact_id IS DISTINCT FROM p_buyer_contact_id;
END;
$$;

ALTER FUNCTION notify_vehicle_unavailable(UUID, UUID, TEXT, TEXT, UUID) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION notify_vehicle_unavailable(UUID, UUID, TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION inventory_vehicles_appointment_alerts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row   inventory_vehicles%ROWTYPE;
  v_what  TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := OLD;
    v_what := 'Se borró del inventario la';
  ELSIF OLD.status IN ('available', 'reserved') AND NEW.status IN ('sold', 'hidden') THEN
    v_row := NEW;
    v_what := CASE NEW.status WHEN 'sold' THEN 'Se vendió la' ELSE 'Se ocultó la' END;
  ELSE
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM notify_vehicle_unavailable(
      v_row.id, v_row.account_id,
      v_row.brand || ' ' || v_row.model || ' ' || v_row.year,
      v_what,
      CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE v_row.sold_to_contact_id END
    );
  EXCEPTION WHEN OTHERS THEN
    -- Nunca frenar un cambio de inventario por un aviso.
    RAISE WARNING 'Aviso de carro no disponible % falló: %', v_row.id, SQLERRM;
  END;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION inventory_vehicles_appointment_alerts() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION inventory_vehicles_appointment_alerts() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS inventory_vehicles_appointment_status ON inventory_vehicles;
CREATE TRIGGER inventory_vehicles_appointment_status
  AFTER UPDATE OF status ON inventory_vehicles
  FOR EACH ROW
  EXECUTE FUNCTION inventory_vehicles_appointment_alerts();

-- BEFORE: corre antes del borrado en cascada de appointment_vehicles,
-- cuando todavía se puede saber qué citas tenían el carro.
DROP TRIGGER IF EXISTS inventory_vehicles_appointment_delete ON inventory_vehicles;
CREATE TRIGGER inventory_vehicles_appointment_delete
  BEFORE DELETE ON inventory_vehicles
  FOR EACH ROW
  EXECUTE FUNCTION inventory_vehicles_appointment_alerts();

-- ============================================================
-- RPC del cron: visita próxima (aviso 2)
-- ============================================================
CREATE OR REPLACE FUNCTION claim_due_pre_visit_alerts(
  p_account_id UUID,
  p_minutes INT,
  p_limit INT DEFAULT 50
)
RETURNS SETOF appointments
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  WITH cand AS (
    SELECT a.id
    FROM appointments a
    WHERE a.account_id = p_account_id
      AND a.status IN ('scheduled', 'confirmed')
      AND a.pre_visit_alerted_at IS NULL
      AND a.starts_at > NOW()
      AND a.starts_at <= NOW() + make_interval(mins => p_minutes)
    ORDER BY a.starts_at
    LIMIT GREATEST(1, LEAST(p_limit, 200))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE appointments a
  SET pre_visit_alerted_at = NOW()
  FROM cand
  WHERE a.id = cand.id
  RETURNING a.*;
$$;

-- ============================================================
-- RPC del cron: asistencia sin marcar (aviso 6)
--
-- `p_until`: hasta dónde ya cerró el horario (el cron lo calcula con el
-- reloj del proceso). `p_since`: no revivir lo de más de 7 días.
-- ============================================================
CREATE OR REPLACE FUNCTION claim_pending_attendance_reminders(
  p_account_id UUID,
  p_since TIMESTAMPTZ,
  p_until TIMESTAMPTZ,
  p_limit INT DEFAULT 200
)
RETURNS SETOF appointments
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  WITH cand AS (
    SELECT a.id
    FROM appointments a
    WHERE a.account_id = p_account_id
      AND a.status IN ('scheduled', 'confirmed')
      AND a.attendance_reminded_at IS NULL
      AND a.starts_at >= p_since
      AND a.starts_at < p_until
      AND a.ends_at < NOW()
    ORDER BY a.starts_at
    LIMIT GREATEST(1, LEAST(p_limit, 500))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE appointments a
  SET attendance_reminded_at = NOW()
  FROM cand
  WHERE a.id = cand.id
  RETURNING a.*;
$$;

REVOKE EXECUTE ON FUNCTION claim_due_pre_visit_alerts(UUID, INT, INT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION claim_pending_attendance_reminders(UUID, TIMESTAMPTZ, TIMESTAMPTZ, INT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_due_pre_visit_alerts(UUID, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION claim_pending_attendance_reminders(UUID, TIMESTAMPTZ, TIMESTAMPTZ, INT)
  TO service_role;

-- ============================================================
-- Indicadores de asistencia por asesor y período
--
-- Solo owner y admin; a cualquier otro le devuelve cero filas. El
-- porcentaje ignora las citas sin marcar (mezclarlas castigaría al
-- asesor por un dato que falta). Una venta "viene de una visita" si el
-- comprador registrado asistió a una cita entre 0 y 30 días antes, y se
-- atribuye al asesor de la visita asistida más reciente.
-- ============================================================
DROP FUNCTION IF EXISTS appointment_attendance_metrics(TIMESTAMPTZ, TIMESTAMPTZ);
CREATE FUNCTION appointment_attendance_metrics(p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS TABLE (
  agent_user_id     UUID,
  full_name         TEXT,
  appointments      BIGINT,
  attended          BIGINT,
  no_show           BIGINT,
  unmarked          BIGINT,
  cancelled         BIGINT,
  attendance_rate   NUMERIC,
  sales_from_visit  BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT p.account_id
    FROM profiles p
    WHERE p.user_id = auth.uid() AND p.account_role IN ('admin', 'owner')
  ),
  counts AS (
    SELECT a.assigned_agent_id AS agent,
           count(*) FILTER (WHERE a.status <> 'cancelled')                         AS appointments,
           count(*) FILTER (WHERE a.status = 'attended')                           AS attended,
           count(*) FILTER (WHERE a.status = 'no_show')                            AS no_show,
           count(*) FILTER (WHERE a.status IN ('scheduled', 'confirmed')
                              AND a.ends_at < NOW())                               AS unmarked,
           count(*) FILTER (WHERE a.status = 'cancelled')                          AS cancelled
    FROM appointments a
    JOIN me ON me.account_id = a.account_id
    WHERE a.starts_at >= p_from AND a.starts_at < p_to
    GROUP BY a.assigned_agent_id
  ),
  sales AS (
    SELECT (
      SELECT a.assigned_agent_id
      FROM appointments a
      WHERE a.account_id = v.account_id
        AND a.contact_id = v.sold_to_contact_id
        AND a.status = 'attended'
        AND a.starts_at <= v.sold_at
        AND a.starts_at >= v.sold_at - INTERVAL '30 days'
      ORDER BY a.starts_at DESC
      LIMIT 1
    ) AS agent
    FROM inventory_vehicles v
    JOIN me ON me.account_id = v.account_id
    WHERE v.status = 'sold'
      AND v.sold_to_contact_id IS NOT NULL
      AND v.sold_at >= p_from AND v.sold_at < p_to
  ),
  sales_by AS (
    SELECT agent, count(*) AS n FROM sales WHERE agent IS NOT NULL GROUP BY agent
  )
  SELECT COALESCE(c.agent, s.agent),
         COALESCE(NULLIF(p.full_name, ''), '—'),
         COALESCE(c.appointments, 0),
         COALESCE(c.attended, 0),
         COALESCE(c.no_show, 0),
         COALESCE(c.unmarked, 0),
         COALESCE(c.cancelled, 0),
         CASE WHEN COALESCE(c.attended, 0) + COALESCE(c.no_show, 0) > 0
              THEN round(c.attended::numeric / (c.attended + c.no_show), 4)
         END,
         COALESCE(s.n, 0)
  FROM counts c
  FULL JOIN sales_by s ON s.agent = c.agent
  LEFT JOIN profiles p ON p.user_id = COALESCE(c.agent, s.agent)
  ORDER BY 2;
$$;

ALTER FUNCTION appointment_attendance_metrics(TIMESTAMPTZ, TIMESTAMPTZ) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION appointment_attendance_metrics(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION appointment_attendance_metrics(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;

-- ============================================================
-- Rollback (manual):
--   DROP TRIGGER appointments_alert_columns ON appointments;
--   DROP TRIGGER appointments_lifecycle_alerts ON appointments;
--   DROP TRIGGER inventory_vehicles_appointment_status ON inventory_vehicles;
--   DROP TRIGGER inventory_vehicles_appointment_delete ON inventory_vehicles;
--   DROP FUNCTION appointments_alert_columns(), appointments_lifecycle_alerts(),
--     inventory_vehicles_appointment_alerts(),
--     notify_vehicle_unavailable(UUID, UUID, TEXT, TEXT, UUID),
--     claim_due_pre_visit_alerts(UUID, INT, INT),
--     claim_pending_attendance_reminders(UUID, TIMESTAMPTZ, TIMESTAMPTZ, INT),
--     appointment_attendance_metrics(TIMESTAMPTZ, TIMESTAMPTZ);
--   DELETE FROM notifications WHERE type IN (<los 7 de la 549>);
--   Reponer el CHECK de la 548 (sin los 7 tipos de la 549).
--   ALTER TABLE notifications DROP COLUMN link_path;
--   ALTER TABLE appointments DROP COLUMN pre_visit_alerted_at, DROP COLUMN attendance_reminded_at;
--   ALTER TABLE appointment_settings DROP COLUMN pre_visit_alert_minutes;
-- ============================================================
