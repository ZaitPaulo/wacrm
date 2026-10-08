-- ============================================================
-- 548_appointments.sql
--
-- Agenda de citas de visita al concesionario por asesor
-- (openspec/changes/agenda-citas, fases 1 y 2 de la propuesta a
-- Lora Motors del 2026-10-07).
--
-- Qué agrega:
--   - `appointments`: la cita (cliente, asesor, hora, motivo, estado),
--     con la cola de la confirmación y del recordatorio por WhatsApp.
--   - `appointment_vehicles`: los vehículos de interés de cada cita.
--   - `appointment_events`: el historial, escrito SOLO por trigger.
--   - `appointment_settings`: plantillas, horas y duración por cuenta.
--   - `appointment_digests`: qué resumen diario ya salió (una vez por
--     asesor y día).
--   - Tres tipos de notificación nuevos y `notifications.appointment_id`.
--   - Las RPC con que el cron reclama confirmaciones y recordatorios.
--
-- ## Por qué la base y no el código decide tanto
--
-- Las reglas que importan —que un asesor no tenga dos citas cruzadas,
-- que reagendar vuelva la cita a programada y le devuelva el
-- recordatorio, que cada cambio quede en el historial, que el asesor
-- se entere de una cita asignada— viven en triggers y en una
-- restricción de exclusión. Así valen por cualquier camino: la Agenda,
-- la respuesta del cliente al botón, el cron o un UPDATE a mano.
--
-- ## Visibilidad
--
-- La misma regla que las conversaciones (520): owner, admin y viewer
-- ven todo; el `agent` solo lo que tiene asignado. Se reutiliza
-- `conversation_visible(account_id, assigned_agent_id)` tal cual.
--
-- ## Hora local en los textos de aviso
--
-- Los avisos que arma la base ("Nueva cita: … martes 7 de octubre,
-- 2:00 p. m.") se escriben en 'America/Bogota', la zona del contenedor
-- (ver 523_business_hours.sql). Hoy hay una sola cuenta y un solo huso;
-- el día que haya otro, la zona tendrá que ser por cuenta.
--
-- PRIVILEGIOS: REVOKE primero y GRANT después (ver 531 y 534). En el
-- VPS `pg_default_acl` le da TODO a `anon` sobre cada tabla nueva.
--
-- Idempotente. Rollback al final del archivo.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ============================================================
-- appointments
-- ============================================================
CREATE TABLE IF NOT EXISTS appointments (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id             UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id             UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  -- De dónde se agendó. Opcional: una cita creada desde el calendario
  -- puede no tener conversación a mano.
  conversation_id        UUID REFERENCES conversations(id) ON DELETE SET NULL,
  -- `auth.users.id`, igual que `conversations.assigned_agent_id`. Sin FK
  -- por simetría con esa columna; que sea miembro con rol agent o más
  -- lo valida el trigger.
  assigned_agent_id      UUID NOT NULL,
  starts_at              TIMESTAMPTZ NOT NULL,
  duration_minutes       INTEGER NOT NULL DEFAULT 30
    CHECK (duration_minutes BETWEEN 15 AND 480),
  -- La calcula SIEMPRE el trigger: `timestamptz + interval` no es
  -- inmutable y no puede ser columna generada.
  ends_at                TIMESTAMPTZ NOT NULL,
  purpose                TEXT NOT NULL DEFAULT 'view_vehicle'
    CHECK (purpose IN ('view_vehicle', 'test_drive', 'appraisal', 'signing', 'delivery')),
  notes                  TEXT,
  status                 TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'confirmed', 'attended', 'no_show', 'cancelled')),
  -- Cuándo se fijó la hora vigente. El recordatorio no sale el mismo
  -- día en que se agendó o movió: ese día ya llegó la confirmación.
  scheduled_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Cola de la confirmación al cliente. El cliente solo puede poner
  -- `none` o `pending`; el resto lo escribe el cron.
  confirmation_status    TEXT NOT NULL DEFAULT 'none'
    CHECK (confirmation_status IN ('none', 'pending', 'sending', 'sent', 'skipped', 'failed')),
  confirmation_claimed_at TIMESTAMPTZ,
  confirmation_sent_at   TIMESTAMPTZ,

  -- Cola del recordatorio del día anterior. NULL = todavía no se intentó.
  reminder_status        TEXT
    CHECK (reminder_status IN ('sending', 'sent', 'skipped', 'failed')),
  reminder_claimed_at    TIMESTAMPTZ,
  reminder_sent_at       TIMESTAMPTZ,

  -- Lo que respondió el cliente con los botones del recordatorio.
  customer_response      TEXT
    CHECK (customer_response IN ('confirmed', 'change_requested')),
  customer_responded_at  TIMESTAMPTZ,

  created_by             UUID DEFAULT auth.uid(),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT appointments_ends_after_start CHECK (ends_at > starts_at)
);

COMMENT ON TABLE appointments IS
  'Citas de visita al concesionario. Visibilidad como conversations (conversation_visible). Estados: scheduled, confirmed, attended, no_show, cancelled; reagendar es un evento, no un estado.';

CREATE INDEX IF NOT EXISTS idx_appointments_account_starts
  ON appointments (account_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_appointments_agent_starts
  ON appointments (assigned_agent_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_appointments_contact
  ON appointments (contact_id, starts_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointments_confirmation_queue
  ON appointments (account_id)
  WHERE confirmation_status IN ('pending', 'sending');
CREATE INDEX IF NOT EXISTS idx_appointments_active_starts
  ON appointments (account_id, starts_at)
  WHERE status IN ('scheduled', 'confirmed');

-- Un asesor no puede tener dos citas activas que se crucen. La base es
-- el árbitro final: dos personas tomando la misma franja a la vez, o un
-- arrastre encima de otra cita, terminan en 23P01.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'appointments_no_overlap'
  ) THEN
    ALTER TABLE appointments ADD CONSTRAINT appointments_no_overlap
      EXCLUDE USING gist (
        assigned_agent_id WITH =,
        tstzrange(starts_at, ends_at) WITH &&
      )
      WHERE (status IN ('scheduled', 'confirmed'));
  END IF;
END $$;

-- ============================================================
-- appointment_vehicles
-- ============================================================
CREATE TABLE IF NOT EXISTS appointment_vehicles (
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  -- Borrar el vehículo del inventario deja la cita sin él.
  vehicle_id     UUID NOT NULL REFERENCES inventory_vehicles(id) ON DELETE CASCADE,
  PRIMARY KEY (appointment_id, vehicle_id)
);

CREATE INDEX IF NOT EXISTS idx_appointment_vehicles_vehicle
  ON appointment_vehicles (vehicle_id);

-- ============================================================
-- appointment_events — historial de solo inserción
-- ============================================================
CREATE TABLE IF NOT EXISTS appointment_events (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  account_id     UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN (
    'created', 'rescheduled', 'reassigned', 'status_changed',
    'customer_confirmed', 'customer_change_requested',
    'confirmation_sent', 'confirmation_skipped', 'confirmation_failed',
    'reminder_sent', 'reminder_skipped', 'reminder_failed'
  )),
  -- NULL = lo hizo el sistema (cron, respuesta del cliente).
  actor_user_id  UUID,
  data           JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- clock_timestamp y no NOW(): varios eventos de una misma transacción
  -- (confirmar y luego mover) tienen que quedar en el orden en que pasaron.
  created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE appointment_events ALTER COLUMN created_at SET DEFAULT clock_timestamp();

CREATE INDEX IF NOT EXISTS idx_appointment_events_appointment
  ON appointment_events (appointment_id, created_at);

-- ============================================================
-- appointment_settings — una fila por cuenta
-- ============================================================
CREATE TABLE IF NOT EXISTS appointment_settings (
  account_id                UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  customer_messages_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  confirmation_template_id  UUID REFERENCES message_templates(id) ON DELETE SET NULL,
  reminder_template_id      UUID REFERENCES message_templates(id) ON DELETE SET NULL,
  reminder_time             TIME NOT NULL DEFAULT '10:00',
  digest_time               TIME NOT NULL DEFAULT '07:30',
  default_duration_minutes  INTEGER NOT NULL DEFAULT 30
    CHECK (default_duration_minutes BETWEEN 15 AND 480),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- No se pueden activar los mensajes sin las dos plantillas. Si una
  -- plantilla se borra, el ON DELETE SET NULL choca con este CHECK y el
  -- borrado falla: hay que desactivar los mensajes primero, a propósito.
  CONSTRAINT appointment_settings_templates_required CHECK (
    NOT customer_messages_enabled
    OR (confirmation_template_id IS NOT NULL AND reminder_template_id IS NOT NULL)
  )
);

COMMENT ON TABLE appointment_settings IS
  'Configuración de la Agenda por cuenta: mensajes al cliente (apagados por defecto), plantillas de confirmación y recordatorio, hora del recordatorio y del resumen diario, duración por defecto.';

-- ============================================================
-- appointment_digests — el resumen diario sale una vez
-- ============================================================
CREATE TABLE IF NOT EXISTS appointment_digests (
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL,
  day        DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, user_id, day)
);

-- ============================================================
-- notifications: tipos nuevos y enlace a la cita
-- ============================================================
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS appointment_id UUID REFERENCES appointments(id) ON DELETE CASCADE;

-- Conserva TODOS los tipos anteriores (541 y 546): reemplazar el CHECK
-- con una lista incompleta rompería los avisos de traspaso del bot.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'conversation_assigned',
    'new_message',
    'handoff_reminder',
    'handoff_unattended',
    'appointment_assigned',
    'appointment_change_requested',
    'appointment_digest'
  ));

-- ============================================================
-- Fecha y hora en español para los avisos que arma la base.
-- "martes 7 de octubre, 2:00 p. m." — el mismo formato que
-- src/lib/appointments/format.ts.
-- ============================================================
CREATE OR REPLACE FUNCTION appointment_when_es(p_ts TIMESTAMPTZ)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_local TIMESTAMP := p_ts AT TIME ZONE 'America/Bogota';
  v_hour  INT := EXTRACT(HOUR FROM v_local)::INT;
  v_h12   INT := CASE WHEN v_hour % 12 = 0 THEN 12 ELSE v_hour % 12 END;
BEGIN
  RETURN (ARRAY['domingo','lunes','martes','miércoles','jueves','viernes','sábado'])
           [EXTRACT(DOW FROM v_local)::INT + 1]
    || ' ' || EXTRACT(DAY FROM v_local)::INT
    || ' de ' || (ARRAY['enero','febrero','marzo','abril','mayo','junio','julio',
                        'agosto','septiembre','octubre','noviembre','diciembre'])
                 [EXTRACT(MONTH FROM v_local)::INT]
    || ', ' || v_h12 || ':' || to_char(v_local, 'MI')
    || CASE WHEN v_hour < 12 THEN ' a. m.' ELSE ' p. m.' END;
END;
$$;

-- ============================================================
-- Reglas al escribir una cita (BEFORE)
-- ============================================================
CREATE OR REPLACE FUNCTION appointments_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor      UUID := auth.uid();
  v_is_admin   BOOLEAN;
  v_final      CONSTANT TEXT[] := ARRAY['attended', 'no_show', 'cancelled'];
  v_moved      BOOLEAN;
BEGIN
  -- Inmutables.
  IF TG_OP = 'UPDATE' THEN
    NEW.account_id := OLD.account_id;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;

  -- El asesor tiene que ser miembro de la cuenta con rol agent o más.
  IF NOT EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.user_id = NEW.assigned_agent_id
      AND p.account_id = NEW.account_id
      AND p.account_role IN ('agent', 'admin', 'owner')
  ) THEN
    RAISE EXCEPTION 'El asesor de la cita no es miembro de la cuenta'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Contacto y conversación de la misma cuenta.
  IF NOT EXISTS (
    SELECT 1 FROM contacts c WHERE c.id = NEW.contact_id AND c.account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'El contacto de la cita es de otra cuenta'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.conversation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = NEW.conversation_id AND c.account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'La conversación de la cita es de otra cuenta'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Columnas que solo escribe el sistema (cron y respuesta del cliente).
  -- Con sesión de usuario se conservan; la única excepción es poner la
  -- confirmación en cola (`pending`) o sacarla (`none`).
  IF v_actor IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      NEW.confirmation_claimed_at := NULL;
      NEW.confirmation_sent_at := NULL;
      NEW.reminder_status := NULL;
      NEW.reminder_claimed_at := NULL;
      NEW.reminder_sent_at := NULL;
      NEW.customer_response := NULL;
      NEW.customer_responded_at := NULL;
      IF NEW.confirmation_status NOT IN ('none', 'pending') THEN
        NEW.confirmation_status := 'none';
      END IF;
      NEW.created_by := v_actor;
    ELSE
      NEW.confirmation_claimed_at := OLD.confirmation_claimed_at;
      NEW.confirmation_sent_at := OLD.confirmation_sent_at;
      NEW.reminder_status := OLD.reminder_status;
      NEW.reminder_claimed_at := OLD.reminder_claimed_at;
      NEW.reminder_sent_at := OLD.reminder_sent_at;
      NEW.customer_response := OLD.customer_response;
      NEW.customer_responded_at := OLD.customer_responded_at;
      IF NEW.confirmation_status IS DISTINCT FROM OLD.confirmation_status
         AND NEW.confirmation_status NOT IN ('none', 'pending') THEN
        NEW.confirmation_status := OLD.confirmation_status;
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.scheduled_at := NOW();
  ELSE
    v_moved := NEW.starts_at IS DISTINCT FROM OLD.starts_at
               OR NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes;

    IF OLD.status = ANY (v_final) THEN
      IF v_moved THEN
        RAISE EXCEPTION 'Una cita % no puede cambiar de hora', OLD.status
          USING ERRCODE = 'check_violation';
      END IF;
      -- Salir de un estado final es una corrección: solo admin u owner
      -- (o el sistema, sin sesión).
      IF NEW.status IS DISTINCT FROM OLD.status AND v_actor IS NOT NULL THEN
        v_is_admin := EXISTS (
          SELECT 1 FROM profiles p
          WHERE p.user_id = v_actor
            AND p.account_id = NEW.account_id
            AND p.account_role IN ('admin', 'owner')
        );
        IF NOT v_is_admin THEN
          RAISE EXCEPTION 'Solo un administrador puede reabrir una cita %', OLD.status
            USING ERRCODE = 'insufficient_privilege';
        END IF;
      END IF;
    END IF;

    -- Reagendar: vuelve a programada y recupera su recordatorio.
    IF v_moved THEN
      NEW.scheduled_at := NOW();
      IF NEW.status = 'confirmed' THEN
        NEW.status := 'scheduled';
      END IF;
      NEW.reminder_status := NULL;
      NEW.reminder_claimed_at := NULL;
      NEW.reminder_sent_at := NULL;
      NEW.customer_response := NULL;
      NEW.customer_responded_at := NULL;
    END IF;

    NEW.updated_at := NOW();
  END IF;

  NEW.ends_at := NEW.starts_at + make_interval(mins => NEW.duration_minutes);
  RETURN NEW;
END;
$$;

ALTER FUNCTION appointments_before_write() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION appointments_before_write() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS appointments_before_write ON appointments;
CREATE TRIGGER appointments_before_write
  BEFORE INSERT OR UPDATE ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION appointments_before_write();

-- ============================================================
-- Historial y aviso de cita asignada (AFTER)
-- ============================================================
CREATE OR REPLACE FUNCTION appointments_after_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor        UUID := auth.uid();
  v_moved        BOOLEAN := FALSE;
  v_contact_name TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO appointment_events (appointment_id, account_id, kind, actor_user_id, data)
    VALUES (NEW.id, NEW.account_id, 'created', v_actor, jsonb_build_object(
      'starts_at', NEW.starts_at,
      'assigned_agent_id', NEW.assigned_agent_id,
      'purpose', NEW.purpose
    ));
  ELSE
    v_moved := NEW.starts_at IS DISTINCT FROM OLD.starts_at
               OR NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes;

    IF v_moved THEN
      INSERT INTO appointment_events (appointment_id, account_id, kind, actor_user_id, data)
      VALUES (NEW.id, NEW.account_id, 'rescheduled', v_actor, jsonb_build_object(
        'from', OLD.starts_at, 'to', NEW.starts_at,
        'from_minutes', OLD.duration_minutes, 'to_minutes', NEW.duration_minutes
      ));
    END IF;

    IF NEW.assigned_agent_id IS DISTINCT FROM OLD.assigned_agent_id THEN
      INSERT INTO appointment_events (appointment_id, account_id, kind, actor_user_id, data)
      VALUES (NEW.id, NEW.account_id, 'reassigned', v_actor, jsonb_build_object(
        'from', OLD.assigned_agent_id, 'to', NEW.assigned_agent_id
      ));
    END IF;

    IF NEW.customer_response IS DISTINCT FROM OLD.customer_response
       AND NEW.customer_response IS NOT NULL THEN
      INSERT INTO appointment_events (appointment_id, account_id, kind, actor_user_id, data)
      VALUES (NEW.id, NEW.account_id,
              CASE NEW.customer_response
                WHEN 'confirmed' THEN 'customer_confirmed'
                ELSE 'customer_change_requested'
              END,
              v_actor, '{}'::jsonb);
    END IF;

    -- El cambio de estado que causa un reagendado o la confirmación del
    -- cliente ya quedó dicho arriba; no se repite.
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT v_moved
       AND NOT (NEW.customer_response IS DISTINCT FROM OLD.customer_response
                AND NEW.customer_response = 'confirmed') THEN
      INSERT INTO appointment_events (appointment_id, account_id, kind, actor_user_id, data)
      VALUES (NEW.id, NEW.account_id, 'status_changed', v_actor, jsonb_build_object(
        'from', OLD.status, 'to', NEW.status
      ));
    END IF;

    IF NEW.confirmation_status IS DISTINCT FROM OLD.confirmation_status
       AND NEW.confirmation_status IN ('sent', 'skipped', 'failed') THEN
      INSERT INTO appointment_events (appointment_id, account_id, kind, actor_user_id, data)
      VALUES (NEW.id, NEW.account_id, 'confirmation_' || NEW.confirmation_status, v_actor, '{}'::jsonb);
    END IF;

    IF NEW.reminder_status IS DISTINCT FROM OLD.reminder_status
       AND NEW.reminder_status IN ('sent', 'skipped', 'failed') THEN
      INSERT INTO appointment_events (appointment_id, account_id, kind, actor_user_id, data)
      VALUES (NEW.id, NEW.account_id, 'reminder_' || NEW.reminder_status, v_actor, '{}'::jsonb);
    END IF;
  END IF;

  -- Aviso al asesor: cita nueva o reasignada a alguien que no es quien
  -- hizo el cambio. Agendarse a uno mismo no avisa.
  IF (TG_OP = 'INSERT' OR NEW.assigned_agent_id IS DISTINCT FROM OLD.assigned_agent_id)
     AND NEW.assigned_agent_id IS DISTINCT FROM v_actor
     AND NEW.status IN ('scheduled', 'confirmed') THEN
    BEGIN
      SELECT name INTO v_contact_name FROM contacts WHERE id = NEW.contact_id;
      INSERT INTO notifications (
        account_id, user_id, type, conversation_id, contact_id,
        appointment_id, actor_user_id, title, body
      ) VALUES (
        NEW.account_id,
        NEW.assigned_agent_id,
        'appointment_assigned',
        NEW.conversation_id,
        NEW.contact_id,
        NEW.id,
        v_actor,
        'Nueva cita: ' || COALESCE(NULLIF(v_contact_name, ''), 'un contacto'),
        appointment_when_es(NEW.starts_at)
      );
    EXCEPTION WHEN OTHERS THEN
      -- Nunca bloquear la cita por un aviso.
      RAISE WARNING 'No se pudo avisar la cita %: %', NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NULL;
END;
$$;

ALTER FUNCTION appointments_after_write() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION appointments_after_write() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS appointments_after_write ON appointments;
CREATE TRIGGER appointments_after_write
  AFTER INSERT OR UPDATE ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION appointments_after_write();

-- ============================================================
-- El vehículo de una cita es de la misma cuenta
-- ============================================================
CREATE OR REPLACE FUNCTION appointment_vehicles_same_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM appointments a
    JOIN inventory_vehicles v ON v.account_id = a.account_id
    WHERE a.id = NEW.appointment_id AND v.id = NEW.vehicle_id
  ) THEN
    RAISE EXCEPTION 'El vehículo es de otra cuenta'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION appointment_vehicles_same_account() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION appointment_vehicles_same_account() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS appointment_vehicles_same_account ON appointment_vehicles;
CREATE TRIGGER appointment_vehicles_same_account
  BEFORE INSERT OR UPDATE ON appointment_vehicles
  FOR EACH ROW
  EXECUTE FUNCTION appointment_vehicles_same_account();

-- ============================================================
-- Privilegios
-- ============================================================
REVOKE ALL ON appointments          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON appointment_vehicles  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON appointment_events    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON appointment_settings  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON appointment_digests   FROM PUBLIC, anon, authenticated;

-- Sin DELETE: las citas se cancelan, no se borran.
GRANT SELECT, INSERT, UPDATE ON appointments TO authenticated;
GRANT SELECT, INSERT, DELETE ON appointment_vehicles TO authenticated;
-- El historial lo escribe solo el trigger.
GRANT SELECT ON appointment_events TO authenticated;
GRANT SELECT, INSERT, UPDATE ON appointment_settings TO authenticated;

GRANT ALL ON appointments, appointment_vehicles, appointment_events,
             appointment_settings, appointment_digests TO service_role;

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE appointments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_settings ENABLE ROW LEVEL SECURITY;
-- Sin políticas: con RLS activa niega todo menos a service_role.
ALTER TABLE appointment_digests  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appointments_select ON appointments;
CREATE POLICY appointments_select ON appointments FOR SELECT
  USING (conversation_visible(account_id, assigned_agent_id));

-- Un agent solo crea o deja citas asignadas a sí mismo; asignar a otro
-- es de admin. `contact_visible` impide citar a un cliente que no ve.
DROP POLICY IF EXISTS appointments_insert ON appointments;
CREATE POLICY appointments_insert ON appointments FOR INSERT
  WITH CHECK (
    is_account_member(account_id, 'agent')
    AND (assigned_agent_id = auth.uid() OR is_account_member(account_id, 'admin'))
    AND contact_visible(account_id, contact_id)
  );

DROP POLICY IF EXISTS appointments_update ON appointments;
CREATE POLICY appointments_update ON appointments FOR UPDATE
  USING (
    is_account_member(account_id, 'agent')
    AND conversation_visible(account_id, assigned_agent_id)
  )
  WITH CHECK (
    is_account_member(account_id, 'agent')
    AND (assigned_agent_id = auth.uid() OR is_account_member(account_id, 'admin'))
  );

DROP POLICY IF EXISTS appointment_vehicles_select ON appointment_vehicles;
CREATE POLICY appointment_vehicles_select ON appointment_vehicles FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM appointments a
    WHERE a.id = appointment_id
      AND conversation_visible(a.account_id, a.assigned_agent_id)
  ));

DROP POLICY IF EXISTS appointment_vehicles_write ON appointment_vehicles;
DROP POLICY IF EXISTS appointment_vehicles_insert ON appointment_vehicles;
CREATE POLICY appointment_vehicles_insert ON appointment_vehicles FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM appointments a
    WHERE a.id = appointment_id
      AND is_account_member(a.account_id, 'agent')
      AND conversation_visible(a.account_id, a.assigned_agent_id)
  ));

DROP POLICY IF EXISTS appointment_vehicles_delete ON appointment_vehicles;
CREATE POLICY appointment_vehicles_delete ON appointment_vehicles FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM appointments a
    WHERE a.id = appointment_id
      AND is_account_member(a.account_id, 'agent')
      AND conversation_visible(a.account_id, a.assigned_agent_id)
  ));

DROP POLICY IF EXISTS appointment_events_select ON appointment_events;
CREATE POLICY appointment_events_select ON appointment_events FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM appointments a
    WHERE a.id = appointment_id
      AND conversation_visible(a.account_id, a.assigned_agent_id)
  ));

-- Todos los miembros leen la configuración (duración por defecto, si
-- hay mensajes al cliente); solo admin la escribe.
DROP POLICY IF EXISTS appointment_settings_select ON appointment_settings;
CREATE POLICY appointment_settings_select ON appointment_settings FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS appointment_settings_insert ON appointment_settings;
CREATE POLICY appointment_settings_insert ON appointment_settings FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS appointment_settings_update ON appointment_settings;
CREATE POLICY appointment_settings_update ON appointment_settings FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- ============================================================
-- RPC del cron: reclamar confirmaciones
--
-- Toma las `pending` (o `sending` abandonadas hace más de 10 min, por
-- un proceso que murió a mitad) y las pasa a `sending` en la misma
-- sentencia, con SKIP LOCKED: dos pasadas solapadas nunca reclaman la
-- misma fila.
--
-- `p_window_only`: fuera del horario de atención solo se puede mandar
-- texto libre, así que solo se reclaman las citas cuyo cliente escribió
-- en las últimas 24 horas. Las demás esperan en `pending` sin tocarse.
-- ============================================================
CREATE OR REPLACE FUNCTION claim_pending_appointment_confirmations(
  p_account_id UUID,
  p_window_only BOOLEAN,
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
      AND (
        a.confirmation_status = 'pending'
        OR (a.confirmation_status = 'sending'
            AND a.confirmation_claimed_at < NOW() - INTERVAL '10 minutes')
      )
      AND (
        NOT p_window_only
        OR EXISTS (
          SELECT 1 FROM messages m
          WHERE m.conversation_id = a.conversation_id
            AND m.sender_type = 'customer'
            AND m.created_at > NOW() - INTERVAL '24 hours'
        )
      )
    ORDER BY a.created_at
    LIMIT GREATEST(1, LEAST(p_limit, 200))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE appointments a
  SET confirmation_status = 'sending',
      confirmation_claimed_at = NOW()
  FROM cand
  WHERE a.id = cand.id
  RETURNING a.*;
$$;

-- ============================================================
-- RPC del cron: reclamar recordatorios del día siguiente
--
-- Los límites del día los calcula Node con su reloj (TZ del
-- contenedor), igual que el horario de atención.
-- ============================================================
CREATE OR REPLACE FUNCTION claim_due_appointment_reminders(
  p_account_id UUID,
  p_today_start TIMESTAMPTZ,
  p_tomorrow_start TIMESTAMPTZ,
  p_tomorrow_end TIMESTAMPTZ,
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
      AND a.starts_at >= p_tomorrow_start
      AND a.starts_at <  p_tomorrow_end
      -- Agendada o movida hoy: ya recibió su confirmación.
      AND a.scheduled_at < p_today_start
      AND (
        a.reminder_status IS NULL
        OR (a.reminder_status = 'sending'
            AND a.reminder_claimed_at < NOW() - INTERVAL '10 minutes')
      )
    ORDER BY a.starts_at
    LIMIT GREATEST(1, LEAST(p_limit, 200))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE appointments a
  SET reminder_status = 'sending',
      reminder_claimed_at = NOW()
  FROM cand
  WHERE a.id = cand.id
  RETURNING a.*;
$$;

REVOKE EXECUTE ON FUNCTION claim_pending_appointment_confirmations(UUID, BOOLEAN, INT)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION claim_due_appointment_reminders(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, INT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_pending_appointment_confirmations(UUID, BOOLEAN, INT)
  TO service_role;
GRANT EXECUTE ON FUNCTION claim_due_appointment_reminders(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, INT)
  TO service_role;

-- ============================================================
-- Realtime: la Agenda abierta se refresca sola
-- ============================================================
ALTER TABLE appointments REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'appointments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE appointments;
  END IF;
END $$;

-- ============================================================
-- Rollback (manual):
--   ALTER PUBLICATION supabase_realtime DROP TABLE appointments;
--   DELETE FROM notifications WHERE type LIKE 'appointment_%';
--   ALTER TABLE notifications DROP COLUMN appointment_id;
--   ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
--   ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
--     CHECK (type IN ('conversation_assigned', 'new_message',
--                     'handoff_reminder', 'handoff_unattended'));
--   DROP TABLE appointment_digests, appointment_settings, appointment_events,
--              appointment_vehicles, appointments;
--   DROP FUNCTION claim_pending_appointment_confirmations(UUID, BOOLEAN, INT),
--     claim_due_appointment_reminders(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, INT),
--     appointments_before_write(), appointments_after_write(),
--     appointment_vehicles_same_account(), appointment_when_es(TIMESTAMPTZ);
-- ============================================================
