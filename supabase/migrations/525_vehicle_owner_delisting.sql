-- ============================================================
-- 525_vehicle_owner_delisting.sql
--
-- El propietario de cada vehículo, y la baja automática de la vitrina
-- cuando el propietario dice que ya no está disponible o no responde.
-- Cambio de OpenSpec `baja-de-vehiculos-por-propietario`.
--
-- Reglas del cliente (2026-09-14), para la consulta de disponibilidad a
-- los dueños de los vehículos que LoraMotors vende por ellos:
--   - si el dueño toca "NO", su vehículo sale de la vitrina al instante;
--   - si no responde en 60 días desde el PRIMER mensaje, también.
-- "Salir de la vitrina" es `hidden`, no `sold`: el carro no se vendió con
-- nosotros y el estado se revierte cambiándolo como cualquier otro.
--
-- Hasta acá el CRM no sabía de quién es cada vehículo: la 508 guarda al
-- COMPRADOR (`sold_to_contact_id`), y `vehicle_acquisitions` registra las
-- compras de la casa, con costo NOT NULL — los carros en consignación no
-- tienen costo de compra y no caben ahí.
--
-- Depende de la 524 (seguimiento de difusiones): usa su definición de "no
-- respondió" y su `follow_up_cancelled_at`.
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

-- ============================================================
-- 1. Propietario del vehículo
--
-- ON DELETE SET NULL: borrar el contacto deja el vehículo intacto y sin
-- propietario. La FK solo comprueba que el contacto exista; que sea de
-- la misma cuenta lo valida la API del inventario.
-- ============================================================
ALTER TABLE inventory_vehicles
  ADD COLUMN IF NOT EXISTS owner_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;

COMMENT ON COLUMN inventory_vehicles.owner_contact_id IS
  'Contacto que pone el vehículo en venta con nosotros (consignación). Distinto del comprador (sold_to_contact_id). Ver 525_vehicle_owner_delisting.sql.';

CREATE INDEX IF NOT EXISTS idx_inventory_vehicles_owner
  ON inventory_vehicles (account_id, owner_contact_id)
  WHERE owner_contact_id IS NOT NULL;

-- ============================================================
-- 2. Baja por silencio, en la difusión y en el destinatario
--
-- `no_reply_checked_at` es lo que garantiza "una sola vez": un vehículo
-- que alguien vuelve a publicar después de la baja no se vuelve a
-- ocultar, porque su destinatario ya está revisado.
-- ============================================================
ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS no_reply_hide_after_days INTEGER;

ALTER TABLE broadcasts DROP CONSTRAINT IF EXISTS broadcasts_no_reply_hide_range;
ALTER TABLE broadcasts ADD CONSTRAINT broadcasts_no_reply_hide_range
  CHECK (no_reply_hide_after_days IS NULL OR no_reply_hide_after_days BETWEEN 1 AND 365);

COMMENT ON COLUMN broadcasts.no_reply_hide_after_days IS
  'Días desde el envío original tras los cuales se ocultan los vehículos de quien no respondió. NULL = sin baja por silencio. Se cancela con follow_up_cancelled_at.';

ALTER TABLE broadcast_recipients
  ADD COLUMN IF NOT EXISTS no_reply_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS no_reply_hidden_count INTEGER;

COMMENT ON COLUMN broadcast_recipients.no_reply_checked_at IS
  'Cuándo se le aplicó la baja por silencio (o se comprobó que había escrito). Una vez revisado no se vuelve a revisar.';
COMMENT ON COLUMN broadcast_recipients.no_reply_hidden_count IS
  'Cuántos vehículos se le ocultaron por no responder. 0 si había escrito o no era propietario de ninguno.';

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_no_reply_due
  ON broadcast_recipients (broadcast_id, sent_at)
  WHERE no_reply_checked_at IS NULL AND status IN ('sent', 'delivered', 'read');

-- ============================================================
-- 3. hide_owner_vehicles
--
-- Oculta los vehículos pedidos que SIGAN disponibles y les agrega a las
-- notas internas una línea fechada con el motivo, sin borrar lo que ya
-- decían. Devuelve los ids que de verdad cambió, para que el llamador
-- sincronice la base de conocimiento del bot solo de esos.
--
-- En SQL porque agregar texto a las notas existentes no se puede con el
-- cliente de Supabase sin leer y reescribir cada fila — con la carrera
-- que eso trae contra una edición humana. Y la condición
-- `status = 'available'` es lo que garantiza que nunca se pisa un
-- vehículo reservado o vendido a mano.
--
-- La fecha va en hora de Colombia a propósito: la base corre en UTC, y
-- una baja a las 8 de la noche quedaría fechada al día siguiente. Es la
-- misma zona que el contenedor del app (ver 523_business_hours.sql).
-- ============================================================
-- Devuelve una tabla con columna nombrada y no un SETOF UUID: así
-- PostgREST responde `[{ "vehicle_id": ... }]`, una forma que se lee sin
-- adivinar cómo serializa un conjunto de escalares.
CREATE OR REPLACE FUNCTION public.hide_owner_vehicles(
  p_account_id  UUID,
  p_vehicle_ids UUID[],
  p_reason      TEXT
)
RETURNS TABLE(vehicle_id UUID)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE inventory_vehicles v
     SET status = 'hidden',
         internal_notes =
           CASE
             WHEN COALESCE(btrim(v.internal_notes), '') = '' THEN ''
             ELSE v.internal_notes || E'\n'
           END
           || 'Oculto automáticamente el '
           || to_char(NOW() AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD')
           || ': ' || p_reason || '.',
         updated_at = NOW()
   WHERE v.account_id = p_account_id
     AND v.id = ANY(p_vehicle_ids)
     AND v.status = 'available'
  RETURNING v.id;
$$;

REVOKE ALL ON FUNCTION public.hide_owner_vehicles(UUID, UUID[], TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hide_owner_vehicles(UUID, UUID[], TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.hide_owner_vehicles(UUID, UUID[], TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.hide_owner_vehicles(UUID, UUID[], TEXT) TO service_role;

-- ============================================================
-- 4. apply_due_no_reply_hides
--
-- Una pasada de la baja por silencio. Toma con SKIP LOCKED los
-- destinatarios vencidos de difusiones con plazo y sin cancelar, y a
-- cada uno:
--   - si escribió algo después del envío original (el mismo EXISTS sobre
--     `messages` que la 524), lo marca revisado con 0: respondió;
--   - si no, le oculta todos los vehículos disponibles de los que es
--     propietario;
--   - y lo marca revisado con la cantidad.
--
-- El plazo cuenta desde el envío ORIGINAL (`sent_at`), no desde el
-- recordatorio: así lo pidió el cliente.
--
-- Devuelve (cuenta, vehículo) de lo ocultado para que el cron sincronice
-- la base de conocimiento del bot. No pasa por el horario de atención:
-- no le escribe a nadie.
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_due_no_reply_hides(p_limit INTEGER)
RETURNS TABLE(account_id UUID, vehicle_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  r      RECORD;
  v_ids  UUID[];
BEGIN
  FOR r IN
    SELECT br.id                                AS recipient_id,
           br.contact_id                        AS contact_id,
           COALESCE(br.sent_at, br.created_at)  AS sent_ref,
           b.account_id                         AS acc,
           b.no_reply_hide_after_days           AS days
      FROM broadcast_recipients br
      JOIN broadcasts b ON b.id = br.broadcast_id
     WHERE b.no_reply_hide_after_days IS NOT NULL
       AND b.follow_up_cancelled_at IS NULL
       AND br.no_reply_checked_at IS NULL
       AND br.status IN ('sent', 'delivered', 'read')
       AND COALESCE(br.sent_at, br.created_at)
           <= NOW() - make_interval(days => b.no_reply_hide_after_days)
     ORDER BY COALESCE(br.sent_at, br.created_at)
     LIMIT GREATEST(p_limit, 0)
     FOR UPDATE OF br SKIP LOCKED
  LOOP
    v_ids := ARRAY[]::UUID[];

    IF r.contact_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
       WHERE c.contact_id = r.contact_id
         AND m.sender_type = 'customer'
         AND m.created_at > r.sent_ref
    ) THEN
      SELECT COALESCE(array_agg(h.hidden_id), ARRAY[]::UUID[])
        INTO v_ids
        FROM hide_owner_vehicles(
               r.acc,
               ARRAY(
                 SELECT iv.id
                   FROM inventory_vehicles iv
                  WHERE iv.account_id = r.acc
                    AND iv.owner_contact_id = r.contact_id
                    AND iv.status = 'available'
               ),
               'el propietario no respondió en ' || r.days || ' días'
             ) AS h(hidden_id);
    END IF;

    UPDATE broadcast_recipients
       SET no_reply_checked_at   = NOW(),
           no_reply_hidden_count = COALESCE(array_length(v_ids, 1), 0)
     WHERE id = r.recipient_id;

    RETURN QUERY SELECT r.acc, x FROM unnest(v_ids) AS x;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_due_no_reply_hides(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_due_no_reply_hides(INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.apply_due_no_reply_hides(INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_due_no_reply_hides(INTEGER) TO service_role;
