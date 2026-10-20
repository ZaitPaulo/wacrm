-- ============================================================
-- 555 — Hoja de vida del contacto (cambio hoja-de-vida-contacto, D2 y D3)
--
-- Tres funciones `SECURITY DEFINER` que dejan a cualquier miembro de la
-- cuenta LEER la historia completa de un contacto, aunque sus
-- conversaciones, negocios y citas sean de otro asesor:
--
--   * get_contact_timeline: la línea de tiempo, armada al consultar con
--     un UNION ALL de las tablas de origen (sin tabla duplicada).
--   * get_contact_summary: los conteos del resumen y si quien mira
--     atiende al contacto.
--   * get_contact_conversation_messages: un hilo en solo lectura.
--
-- Saltan la RLS a propósito, así que la PRIMERA sentencia de cada una
-- resuelve la cuenta del contacto (o de la conversación) y exige
-- `is_account_member`. Si no se cumple devuelven cero filas, igual que la
-- RLS. Ninguna escribe nada: la bandeja, el embudo y la Agenda siguen
-- gobernados por `conversation_visible` / `contact_visible`.
--
-- El costo de adquisición solo viaja si quien consulta es admin u owner.
-- Lo decide la función, no la interfaz.
--
-- La función devuelve datos, no frases: el texto se arma en el cliente
-- con next-intl.
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

-- Datos de un vehículo tal como los muestra la hoja de vida.
CREATE OR REPLACE FUNCTION contact_timeline_vehicle(iv inventory_vehicles)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'id', iv.id,
    'brand', iv.brand,
    'model', iv.model,
    'year', iv.year,
    'license_plate', iv.license_plate
  );
$$;

-- ============================================================
-- LÍNEA DE TIEMPO
--
-- Orden: occurred_at DESC y, para desempatar, sort_key DESC
-- (`kind:source_id`, único por fila). El cursor es el par
-- (p_before, p_before_key) de la última fila recibida: la página
-- siguiente trae lo estrictamente anterior, sin repetir ni saltar
-- eventos con la misma fecha.
-- ============================================================
DROP FUNCTION IF EXISTS get_contact_timeline(UUID, TEXT[], TIMESTAMPTZ, TEXT, INTEGER);
CREATE FUNCTION get_contact_timeline(
  p_contact_id UUID,
  p_kinds TEXT[] DEFAULT NULL,
  p_before TIMESTAMPTZ DEFAULT NULL,
  p_before_key TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  occurred_at TIMESTAMPTZ,
  kind TEXT,
  source_id UUID,
  sort_key TEXT,
  actor_user_id UUID,
  actor_name TEXT,
  data JSONB,
  link JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_account  UUID;
  v_is_admin BOOLEAN;
  v_limit    INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
BEGIN
  SELECT c.account_id INTO v_account FROM contacts c WHERE c.id = p_contact_id;
  IF v_account IS NULL OR NOT is_account_member(v_account) THEN
    RETURN;
  END IF;
  v_is_admin := is_account_member(v_account, 'admin');

  RETURN QUERY
  WITH convs AS (
    SELECT cv.*
    FROM conversations cv
    WHERE cv.contact_id = p_contact_id
      AND cv.account_id = v_account
  ),
  names AS (
    SELECT p.user_id, p.full_name
    FROM profiles p
    WHERE p.account_id = v_account
  ),
  ev (occurred_at, kind, source_id, actor_user_id, data, link) AS (
    -- Primer contacto y su origen (el anuncio, si llegó por uno).
    SELECT
      LEAST(ct.created_at, (SELECT MIN(cv.created_at) FROM convs cv)),
      'first_contact',
      ct.id,
      NULL::UUID,
      jsonb_build_object(
        'channel', (SELECT cv.channel::TEXT FROM convs cv ORDER BY cv.created_at LIMIT 1),
        'ad', (
          SELECT jsonb_build_object(
            'headline', m.referral->>'headline',
            'source_type', m.referral->>'source_type',
            'source_url', m.referral->>'source_url'
          )
          FROM messages m
          JOIN convs cv ON cv.id = m.conversation_id
          WHERE m.referral IS NOT NULL
          ORDER BY m.created_at
          LIMIT 1
        )
      ),
      NULL::JSONB
    FROM contacts ct
    WHERE ct.id = p_contact_id

    UNION ALL
    -- Conversaciones: una fila por hilo, en la fecha de su último mensaje.
    SELECT
      COALESCE(cv.last_message_at, cv.created_at),
      'conversation',
      cv.id,
      NULL::UUID,
      jsonb_build_object(
        'channel', cv.channel::TEXT,
        'status', cv.status,
        'first_at', st.first_at,
        'last_at', st.last_at,
        'message_count', st.n,
        'assigned_agent_id', cv.assigned_agent_id,
        'assigned_agent_name', na.full_name,
        'had_handoff', cv.assigned_agent_id IS NOT NULL OR EXISTS (
          SELECT 1 FROM conversation_assignments ca
          WHERE ca.conversation_id = cv.id AND ca.to_agent_id IS NOT NULL
        )
      ),
      jsonb_build_object('conversation_id', cv.id)
    FROM convs cv
    LEFT JOIN LATERAL (
      SELECT MIN(m.created_at) AS first_at, MAX(m.created_at) AS last_at, COUNT(*) AS n
      FROM messages m
      WHERE m.conversation_id = cv.id
    ) st ON TRUE
    LEFT JOIN names na ON na.user_id = cv.assigned_agent_id

    UNION ALL
    -- Asignaciones y traspasos (las sembradas por la 531 no son cambios).
    SELECT
      ca.changed_at,
      'assignment',
      ca.id,
      ca.changed_by,
      jsonb_build_object(
        'channel', cv.channel::TEXT,
        'from_agent_id', ca.from_agent_id,
        'from_agent_name', nf.full_name,
        'to_agent_id', ca.to_agent_id,
        'to_agent_name', nt.full_name
      ),
      jsonb_build_object('conversation_id', cv.id)
    FROM conversation_assignments ca
    JOIN convs cv ON cv.id = ca.conversation_id
    LEFT JOIN names nf ON nf.user_id = ca.from_agent_id
    LEFT JOIN names nt ON nt.user_id = ca.to_agent_id
    WHERE NOT ca.is_seed

    UNION ALL
    -- La cita, en su fecha y con su estado actual.
    SELECT
      a.starts_at,
      'appointment',
      a.id,
      a.created_by,
      jsonb_build_object(
        'status', a.status,
        'purpose', a.purpose,
        'starts_at', a.starts_at,
        'duration_minutes', a.duration_minutes,
        'assigned_agent_id', a.assigned_agent_id,
        'assigned_agent_name', na.full_name,
        'customer_response', a.customer_response,
        'vehicles', COALESCE((
          SELECT jsonb_agg(contact_timeline_vehicle(iv) ORDER BY iv.brand, iv.model)
          FROM appointment_vehicles av
          JOIN inventory_vehicles iv ON iv.id = av.vehicle_id
          WHERE av.appointment_id = a.id
        ), '[]'::JSONB)
      ),
      jsonb_build_object('appointment_id', a.id, 'starts_at', a.starts_at)
    FROM appointments a
    LEFT JOIN names na ON na.user_id = a.assigned_agent_id
    WHERE a.contact_id = p_contact_id
      AND a.account_id = v_account

    UNION ALL
    -- Lo que le pasó a cada cita. Los envíos de confirmación y
    -- recordatorio son operativos y no se muestran.
    SELECT
      e.created_at,
      'appointment_event',
      e.id,
      e.actor_user_id,
      e.data || jsonb_build_object(
        'event', e.kind,
        'purpose', a.purpose,
        'starts_at', a.starts_at,
        'from_name', nf.full_name,
        'to_name', nt.full_name
      ),
      jsonb_build_object('appointment_id', a.id, 'starts_at', a.starts_at)
    FROM appointment_events e
    JOIN appointments a ON a.id = e.appointment_id
    LEFT JOIN names nf ON e.kind = 'reassigned' AND nf.user_id::TEXT = e.data->>'from'
    LEFT JOIN names nt ON e.kind = 'reassigned' AND nt.user_id::TEXT = e.data->>'to'
    WHERE a.contact_id = p_contact_id
      AND a.account_id = v_account
      AND e.kind IN (
        'created', 'rescheduled', 'reassigned', 'status_changed',
        'customer_confirmed', 'customer_change_requested'
      )

    UNION ALL
    -- Negocios creados.
    SELECT
      d.created_at,
      'deal_created',
      d.id,
      NULL::UUID,
      jsonb_build_object(
        'title', d.title,
        'value', d.value,
        'currency', d.currency,
        'status', d.status,
        'stage_name', s.name,
        'stage_color', s.color,
        'pipeline_name', pl.name
      ),
      jsonb_build_object('deal_id', d.id, 'pipeline_id', d.pipeline_id)
    FROM deals d
    LEFT JOIN pipeline_stages s ON s.id = d.stage_id
    LEFT JOIN pipelines pl ON pl.id = d.pipeline_id
    WHERE d.contact_id = p_contact_id
      AND d.account_id = v_account

    UNION ALL
    -- Cambios de etapa y cierres (desde la 554). La fila del alta no es
    -- un cambio: ya la cuenta `deal_created`.
    SELECT
      de.created_at,
      CASE
        WHEN de.to_status IN ('won', 'lost') AND de.to_status IS DISTINCT FROM de.from_status
          THEN 'deal_closed'
        ELSE 'deal_stage'
      END,
      de.id,
      de.actor_user_id,
      jsonb_build_object(
        'title', d.title,
        'value', d.value,
        'currency', d.currency,
        'from_stage_name', fs.name,
        'to_stage_name', ts.name,
        'from_status', de.from_status,
        'to_status', de.to_status
      ),
      jsonb_build_object('deal_id', d.id, 'pipeline_id', d.pipeline_id)
    FROM deal_stage_events de
    JOIN deals d ON d.id = de.deal_id
    LEFT JOIN pipeline_stages fs ON fs.id = de.from_stage_id
    LEFT JOIN pipeline_stages ts ON ts.id = de.to_stage_id
    WHERE de.contact_id = p_contact_id
      AND de.account_id = v_account
      AND (de.from_stage_id IS NOT NULL OR de.from_status IS NOT NULL)

    UNION ALL
    -- Consultas por un vehículo.
    SELECT
      vi.created_at,
      'inquiry',
      vi.id,
      NULL::UUID,
      jsonb_build_object('vehicle', contact_timeline_vehicle(iv)),
      jsonb_build_object('vehicle_id', iv.id)
    FROM vehicle_inquiries vi
    JOIN inventory_vehicles iv ON iv.id = vi.vehicle_id
    WHERE vi.contact_id = p_contact_id
      AND vi.account_id = v_account

    UNION ALL
    -- Le vendimos.
    SELECT
      iv.sold_at,
      'sale',
      iv.id,
      NULL::UUID,
      jsonb_build_object('vehicle', contact_timeline_vehicle(iv), 'sold_price', iv.sold_price),
      jsonb_build_object('vehicle_id', iv.id)
    FROM inventory_vehicles iv
    WHERE iv.sold_to_contact_id = p_contact_id
      AND iv.account_id = v_account
      AND iv.sold_at IS NOT NULL

    UNION ALL
    -- Nos dejó el vehículo en venta (consignación).
    SELECT
      iv.created_at,
      'consignment',
      iv.id,
      NULL::UUID,
      jsonb_build_object('vehicle', contact_timeline_vehicle(iv), 'status', iv.status::TEXT),
      jsonb_build_object('vehicle_id', iv.id)
    FROM inventory_vehicles iv
    WHERE iv.owner_contact_id = p_contact_id
      AND iv.account_id = v_account

    UNION ALL
    -- Le compramos o nos lo entregó en retoma. El costo, solo para admin.
    SELECT
      COALESCE(va.purchase_date::TIMESTAMPTZ, iv.created_at),
      'acquisition',
      iv.id,
      NULL::UUID,
      jsonb_build_object(
        'vehicle', contact_timeline_vehicle(iv),
        'acquisition_kind', iv.acquisition_kind
      ) || CASE
        WHEN v_is_admin AND va.purchase_cost IS NOT NULL
          THEN jsonb_build_object('purchase_cost', va.purchase_cost)
        ELSE '{}'::JSONB
      END,
      jsonb_build_object('vehicle_id', iv.id)
    FROM inventory_vehicles iv
    LEFT JOIN vehicle_acquisitions va ON va.vehicle_id = iv.id
    WHERE iv.seller_contact_id = p_contact_id
      AND iv.account_id = v_account

    UNION ALL
    -- Documentos.
    SELECT
      doc.created_at,
      'document',
      doc.id,
      doc.uploaded_by,
      jsonb_build_object(
        'file_name', doc.file_name,
        'category', doc.category::TEXT,
        'mime_type', doc.mime_type
      ),
      jsonb_build_object('document_id', doc.id)
    FROM documents doc
    WHERE doc.contact_id = p_contact_id
      AND doc.account_id = v_account

    UNION ALL
    -- Notas.
    SELECT
      n.created_at,
      'note',
      n.id,
      n.user_id,
      jsonb_build_object('text', n.note_text),
      NULL::JSONB
    FROM contact_notes n
    WHERE n.contact_id = p_contact_id
      AND n.account_id = v_account

    UNION ALL
    -- Interacciones registradas a mano.
    SELECT
      i.occurred_at,
      'interaction',
      i.id,
      i.user_id,
      jsonb_build_object(
        'interaction_kind', i.kind,
        'outcome', i.outcome,
        'duration_seconds', i.duration_seconds,
        'note', i.note
      ),
      NULL::JSONB
    FROM contact_interactions i
    WHERE i.contact_id = p_contact_id
      AND i.account_id = v_account
  )
  SELECT
    ev.occurred_at,
    ev.kind,
    ev.source_id,
    ev.kind || ':' || ev.source_id::TEXT,
    ev.actor_user_id,
    na.full_name,
    ev.data,
    ev.link
  FROM ev
  LEFT JOIN names na ON na.user_id = ev.actor_user_id
  WHERE ev.occurred_at IS NOT NULL
    AND (p_kinds IS NULL OR ev.kind = ANY (p_kinds))
    AND (
      p_before IS NULL
      OR (ev.occurred_at, ev.kind || ':' || ev.source_id::TEXT)
         < (p_before, COALESCE(p_before_key, '~'))
    )
  ORDER BY ev.occurred_at DESC, 4 DESC
  LIMIT v_limit;
END;
$$;

ALTER FUNCTION get_contact_timeline(UUID, TEXT[], TIMESTAMPTZ, TEXT, INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION get_contact_timeline(UUID, TEXT[], TIMESTAMPTZ, TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_contact_timeline(UUID, TEXT[], TIMESTAMPTZ, TEXT, INTEGER) TO authenticated, service_role;

COMMENT ON FUNCTION get_contact_timeline(UUID, TEXT[], TIMESTAMPTZ, TEXT, INTEGER) IS
  'Hoja de vida de un contacto para cualquier miembro de su cuenta (cero filas para otra cuenta). Orden occurred_at DESC, sort_key DESC; cursor (p_before, p_before_key). El costo de adquisición solo para admin+.';

-- ============================================================
-- RESUMEN
--
-- `can_edit` dice si quien mira puede escribir el contacto según la RLS
-- sin cambios (`contacts_update`): rol agent o más y `contact_visible`.
-- La ficha lo usa para ofrecer o no la edición y "Agendar visita".
-- ============================================================
DROP FUNCTION IF EXISTS get_contact_summary(UUID);
CREATE FUNCTION get_contact_summary(p_contact_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_created TIMESTAMPTZ;
BEGIN
  SELECT c.account_id, c.created_at INTO v_account, v_created
  FROM contacts c WHERE c.id = p_contact_id;
  IF v_account IS NULL OR NOT is_account_member(v_account) THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'client_since', LEAST(v_created, (
      SELECT MIN(cv.created_at) FROM conversations cv
      WHERE cv.contact_id = p_contact_id AND cv.account_id = v_account
    )),
    'agents', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'conversation_id', cv.id,
        'channel', cv.channel::TEXT,
        'agent_id', cv.assigned_agent_id,
        'agent_name', p.full_name
      ) ORDER BY cv.last_message_at DESC NULLS LAST)
      FROM conversations cv
      LEFT JOIN profiles p ON p.user_id = cv.assigned_agent_id AND p.account_id = v_account
      WHERE cv.contact_id = p_contact_id AND cv.account_id = v_account
    ), '[]'::JSONB),
    'appointments_total', (
      SELECT COUNT(*) FROM appointments a
      WHERE a.contact_id = p_contact_id AND a.account_id = v_account
    ),
    'appointments_attended', (
      SELECT COUNT(*) FROM appointments a
      WHERE a.contact_id = p_contact_id AND a.account_id = v_account AND a.status = 'attended'
    ),
    'vehicles_bought', (
      SELECT COUNT(*) FROM inventory_vehicles iv
      WHERE iv.sold_to_contact_id = p_contact_id AND iv.account_id = v_account AND iv.sold_at IS NOT NULL
    ),
    'vehicles_purchased', (
      SELECT COUNT(*) FROM inventory_vehicles iv
      WHERE iv.seller_contact_id = p_contact_id AND iv.account_id = v_account
        AND iv.acquisition_kind IS DISTINCT FROM 'trade_in'
    ),
    'vehicles_traded_in', (
      SELECT COUNT(*) FROM inventory_vehicles iv
      WHERE iv.seller_contact_id = p_contact_id AND iv.account_id = v_account
        AND iv.acquisition_kind = 'trade_in'
    ),
    'consignments', (
      SELECT COUNT(*) FROM inventory_vehicles iv
      WHERE iv.owner_contact_id = p_contact_id AND iv.account_id = v_account
    ),
    'open_deals', (
      SELECT COUNT(*) FROM deals d
      WHERE d.contact_id = p_contact_id AND d.account_id = v_account AND d.status = 'open'
    ),
    'can_edit', is_account_member(v_account, 'agent') AND contact_visible(v_account, p_contact_id)
  );
END;
$$;

ALTER FUNCTION get_contact_summary(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION get_contact_summary(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_contact_summary(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION get_contact_summary(UUID) IS
  'Resumen de la hoja de vida de un contacto (NULL para otra cuenta). can_edit = agent+ y contact_visible.';

-- ============================================================
-- HILO EN SOLO LECTURA
--
-- Los mensajes de una conversación para cualquier miembro de su cuenta,
-- del más reciente al más antiguo. No habilita ninguna escritura: la
-- RLS de `messages` sigue igual y la conversación no aparece en la
-- bandeja de quien la lee por aquí.
-- ============================================================
DROP FUNCTION IF EXISTS get_contact_conversation_messages(UUID, TIMESTAMPTZ, INTEGER);
CREATE FUNCTION get_contact_conversation_messages(
  p_conversation_id UUID,
  p_before TIMESTAMPTZ DEFAULT NULL,
  p_limit INTEGER DEFAULT 50
)
RETURNS SETOF messages
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
BEGIN
  SELECT c.account_id INTO v_account FROM conversations c WHERE c.id = p_conversation_id;
  IF v_account IS NULL OR NOT is_account_member(v_account) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT m.*
  FROM messages m
  WHERE m.conversation_id = p_conversation_id
    AND (p_before IS NULL OR m.created_at < p_before)
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
END;
$$;

ALTER FUNCTION get_contact_conversation_messages(UUID, TIMESTAMPTZ, INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION get_contact_conversation_messages(UUID, TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_contact_conversation_messages(UUID, TIMESTAMPTZ, INTEGER) TO authenticated, service_role;

COMMENT ON FUNCTION get_contact_conversation_messages(UUID, TIMESTAMPTZ, INTEGER) IS
  'Mensajes de una conversación en solo lectura para cualquier miembro de su cuenta (cero filas para otra cuenta). Lo usa la hoja de vida del contacto.';
