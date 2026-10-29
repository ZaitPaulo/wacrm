-- ============================================================
-- 558_contact_summary_status.sql
--
-- "Cómo va" en la ficha del contacto (rediseño de la hoja de vida).
--
-- `get_contact_summary` (555) contaba el pasado: citas, vehículos,
-- negocios abiertos. El asesor no veía lo que tiene que hacer AHORA.
-- Se le agregan cuatro claves, sin tocar las que ya existían:
--
--   * awaiting_reply   — la conversación del contacto que espera
--                        respuesta hace más tiempo (`awaiting_reply_since`,
--                        551) o NULL.
--   * next_appointment — la próxima cita vigente (agendada o confirmada,
--                        desde hoy) con su primer vehículo, o NULL.
--   * open_deal        — el negocio abierto más reciente, con su etapa y
--                        en qué posición va dentro del embudo, o NULL.
--   * last_contact     — lo último que pasó con el cliente: la última
--                        interacción registrada o el último mensaje, lo
--                        que sea más reciente, o NULL.
--
-- Sigue siendo SECURITY DEFINER con el mismo control de cuenta: ver es
-- de todo el equipo (553). Nada de esto es nuevo para quien mira: la
-- línea de tiempo ya muestra citas, negocios con valor y mensajes.
--
-- Misma firma y mismo tipo de retorno: CREATE OR REPLACE conserva los
-- GRANT. Idempotente.
-- ============================================================

CREATE OR REPLACE FUNCTION get_contact_summary(p_contact_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
  v_created TIMESTAMPTZ;
  v_last_interaction JSONB;
  v_last_message TIMESTAMPTZ;
BEGIN
  SELECT c.account_id, c.created_at INTO v_account, v_created
  FROM contacts c WHERE c.id = p_contact_id;
  IF v_account IS NULL OR NOT is_account_member(v_account) THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
           'source', 'interaction',
           'occurred_at', i.occurred_at,
           'interaction_kind', i.kind,
           'outcome', i.outcome
         )
    INTO v_last_interaction
  FROM contact_interactions i
  WHERE i.contact_id = p_contact_id AND i.account_id = v_account
  ORDER BY i.occurred_at DESC
  LIMIT 1;

  SELECT MAX(cv.last_message_at) INTO v_last_message
  FROM conversations cv
  WHERE cv.contact_id = p_contact_id AND cv.account_id = v_account;

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
    'can_edit', is_account_member(v_account, 'agent') AND contact_visible(v_account, p_contact_id),

    'awaiting_reply', (
      SELECT jsonb_build_object(
        'conversation_id', cv.id,
        'channel', cv.channel::TEXT,
        'since', cv.awaiting_reply_since
      )
      FROM conversations cv
      WHERE cv.contact_id = p_contact_id AND cv.account_id = v_account
        AND cv.awaiting_reply_since IS NOT NULL
      ORDER BY cv.awaiting_reply_since
      LIMIT 1
    ),
    'next_appointment', (
      SELECT jsonb_build_object(
        'id', a.id,
        'starts_at', a.starts_at,
        'purpose', a.purpose,
        'status', a.status,
        'assigned_agent_id', a.assigned_agent_id,
        'vehicle', (
          SELECT contact_timeline_vehicle(iv)
          FROM appointment_vehicles av
          JOIN inventory_vehicles iv ON iv.id = av.vehicle_id
          WHERE av.appointment_id = a.id
          ORDER BY iv.brand, iv.model
          LIMIT 1
        )
      )
      FROM appointments a
      WHERE a.contact_id = p_contact_id AND a.account_id = v_account
        AND a.status IN ('scheduled', 'confirmed')
        AND a.ends_at >= NOW()
      ORDER BY a.starts_at
      LIMIT 1
    ),
    'open_deal', (
      SELECT jsonb_build_object(
        'id', d.id,
        'title', d.title,
        'value', d.value,
        'currency', d.currency,
        'stage_name', ps.name,
        -- Posición 1..N dentro de su embudo, para la barra de avance.
        'stage_index', (
          SELECT COUNT(*) FROM pipeline_stages s
          WHERE s.pipeline_id = d.pipeline_id AND s.position <= ps.position
        ),
        'stage_count', (
          SELECT COUNT(*) FROM pipeline_stages s WHERE s.pipeline_id = d.pipeline_id
        )
      )
      FROM deals d
      JOIN pipeline_stages ps ON ps.id = d.stage_id
      WHERE d.contact_id = p_contact_id AND d.account_id = v_account AND d.status = 'open'
      ORDER BY d.updated_at DESC NULLS LAST
      LIMIT 1
    ),
    'last_contact', CASE
      WHEN v_last_interaction IS NOT NULL
       AND (v_last_message IS NULL OR (v_last_interaction->>'occurred_at')::TIMESTAMPTZ >= v_last_message)
        THEN v_last_interaction
      WHEN v_last_message IS NOT NULL
        THEN jsonb_build_object('source', 'message', 'occurred_at', v_last_message)
      ELSE NULL
    END
  );
END;
$$;

ALTER FUNCTION get_contact_summary(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION get_contact_summary(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_contact_summary(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION get_contact_summary(UUID) IS
  'Resumen de la hoja de vida de un contacto (NULL para otra cuenta): conteos, can_edit = agent+ y contact_visible, y "cómo va" (awaiting_reply, next_appointment, open_deal, last_contact).';
