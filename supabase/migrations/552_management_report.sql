-- ============================================================
-- 552_management_report.sql
--
-- Informe de gestión de asesores (cambio informe-gestion-asesores): una
-- fila por cliente con quién lo atiende, cuándo llegó, en qué parte del
-- negocio está y qué se ha hecho con él. Lo descarga en Excel
-- `GET /api/reports/management`, solo para admin u owner.
--
-- 1. Una sola función con LATERAL, en vez de varias consultas desde
--    Node: contar mensajes por cliente obligaría a traerlos todos, y
--    PostgREST corta las respuestas largas.
-- 2. SECURITY INVOKER: aplica la RLS de quien llama. Un admin ya ve toda
--    la cuenta (migración 520); si otro rol la llamara, vería solo lo que
--    ya podía ver. La ruta además exige admin.
-- 3. Asesor = el de la conversación más reciente y, si no hay, el del
--    negocio reportado. Ojo: `deals.assigned_to` apunta a `profiles.id`,
--    no a `auth.users.id` como `conversations.assigned_agent_id`; por eso
--    se traduce a `profiles.user_id` antes de comparar.
-- 4. Negocio reportado = el abierto más reciente; si no hay abiertos, el
--    más reciente en cualquier estado.
-- 5. Mensaje "del asesor" = `agent` con `sender_id`. El bot, las
--    automatizaciones, los flujos, los recordatorios y la API v1 cuentan
--    aparte, como mensajes automáticos.
--
-- 6. Índices por contacto en `deals` y `contact_notes`, que no tenían:
--    sin ellos cada fila del informe recorre la tabla completa.
--
-- Sin tablas nuevas ni cambios de RLS. Idempotente.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_deals_contact
  ON deals(contact_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_notes_contact
  ON contact_notes(contact_id, created_at DESC);

DROP FUNCTION IF EXISTS management_report(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, INTEGER);

CREATE FUNCTION management_report(
  p_account_id UUID,
  -- Rango de llegada [p_from, p_to): la ruta manda el inicio del día
  -- siguiente a "hasta" para que el último día entre completo.
  p_from       TIMESTAMPTZ,
  p_to         TIMESTAMPTZ,
  -- NULL = todos, 'unassigned' = sin asesor, o el user_id de un asesor.
  p_agent      TEXT DEFAULT NULL,
  p_limit      INTEGER DEFAULT 10001
)
RETURNS TABLE (
  contact_id               UUID,
  contact_name             TEXT,
  phone                    TEXT,
  channel                  TEXT,
  arrived_at               TIMESTAMPTZ,
  agent_id                 UUID,
  agent_name               TEXT,
  pipeline_name            TEXT,
  stage_name               TEXT,
  deal_status              TEXT,
  tags                     TEXT,
  last_customer_message_at TIMESTAMPTZ,
  last_agent_message_at    TIMESTAMPTZ,
  customer_messages        INTEGER,
  agent_messages           INTEGER,
  automated_messages       INTEGER,
  appointments_total       INTEGER,
  appointments_attended    INTEGER,
  appointments_no_show     INTEGER,
  appointments_cancelled   INTEGER,
  next_appointment_at      TIMESTAMPTZ,
  last_note_at             TIMESTAMPTZ,
  last_note_author         TEXT,
  last_note_text           TEXT,
  handoff_summary          TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH base AS (
    SELECT c.id, c.name, c.phone, c.created_at
    FROM contacts c
    WHERE c.account_id = p_account_id
      AND c.merged_into_contact_id IS NULL
      AND c.created_at >= p_from
      AND c.created_at <  p_to
  ),
  enriched AS (
    SELECT
      b.*,
      conv.channel,
      d.pipeline_name,
      d.stage_name,
      d.status AS deal_status,
      COALESCE(conv.assigned_agent_id, d.assignee_user_id) AS agent_id
    FROM base b
    LEFT JOIN LATERAL (
      SELECT cv.channel::TEXT AS channel, cv.assigned_agent_id
      FROM conversations cv
      WHERE cv.contact_id = b.id
      ORDER BY cv.last_message_at DESC NULLS LAST, cv.created_at DESC
      LIMIT 1
    ) conv ON true
    LEFT JOIN LATERAL (
      SELECT p.name AS pipeline_name, s.name AS stage_name, dl.status,
             pr.user_id AS assignee_user_id
      FROM deals dl
      JOIN pipelines p        ON p.id = dl.pipeline_id
      JOIN pipeline_stages s  ON s.id = dl.stage_id
      LEFT JOIN profiles pr   ON pr.id = dl.assigned_to
      WHERE dl.contact_id = b.id
      ORDER BY (dl.status = 'open') DESC, dl.updated_at DESC NULLS LAST
      LIMIT 1
    ) d ON true
  ),
  filtered AS (
    SELECT e.*
    FROM enriched e
    WHERE p_agent IS NULL
       OR (p_agent = 'unassigned' AND e.agent_id IS NULL)
       OR e.agent_id::TEXT = p_agent
    ORDER BY e.created_at DESC, e.id
    LIMIT p_limit
  )
  SELECT
    f.id,
    f.name,
    f.phone,
    f.channel,
    f.created_at,
    f.agent_id,
    ap.full_name,
    f.pipeline_name,
    f.stage_name,
    f.deal_status,
    tg.tags,
    msg.last_customer_at,
    msg.last_agent_at,
    msg.customer_count,
    msg.agent_count,
    msg.automated_count,
    apt.total,
    apt.attended,
    apt.no_show,
    apt.cancelled,
    apt.next_at,
    nt.created_at,
    nt.author,
    nt.note_text,
    hs.summary
  FROM filtered f
  LEFT JOIN profiles ap ON ap.user_id = f.agent_id
  LEFT JOIN LATERAL (
    SELECT string_agg(t.name, ', ' ORDER BY t.name) AS tags
    FROM contact_tags ct
    JOIN tags t ON t.id = ct.tag_id
    WHERE ct.contact_id = f.id
  ) tg ON true
  LEFT JOIN LATERAL (
    SELECT
      max(m.created_at) FILTER (WHERE m.sender_type = 'customer') AS last_customer_at,
      max(m.created_at) FILTER (WHERE m.sender_type = 'agent' AND m.sender_id IS NOT NULL) AS last_agent_at,
      count(*) FILTER (WHERE m.sender_type = 'customer')::INTEGER AS customer_count,
      count(*) FILTER (WHERE m.sender_type = 'agent' AND m.sender_id IS NOT NULL)::INTEGER AS agent_count,
      count(*) FILTER (WHERE m.sender_type = 'bot'
                          OR (m.sender_type = 'agent' AND m.sender_id IS NULL))::INTEGER AS automated_count
    FROM conversations cv
    JOIN messages m ON m.conversation_id = cv.id
    WHERE cv.contact_id = f.id
  ) msg ON true
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE a.status <> 'cancelled')::INTEGER AS total,
      count(*) FILTER (WHERE a.status = 'attended')::INTEGER AS attended,
      count(*) FILTER (WHERE a.status = 'no_show')::INTEGER AS no_show,
      count(*) FILTER (WHERE a.status = 'cancelled')::INTEGER AS cancelled,
      min(a.starts_at) FILTER (WHERE a.starts_at > now()
                                 AND a.status IN ('scheduled', 'confirmed')) AS next_at
    FROM appointments a
    WHERE a.contact_id = f.id
  ) apt ON true
  LEFT JOIN LATERAL (
    SELECT n.created_at, n.note_text, np.full_name AS author
    FROM contact_notes n
    LEFT JOIN profiles np ON np.user_id = n.user_id
    WHERE n.contact_id = f.id
    ORDER BY n.created_at DESC
    LIMIT 1
  ) nt ON true
  LEFT JOIN LATERAL (
    SELECT cv.ai_handoff_summary AS summary
    FROM conversations cv
    WHERE cv.contact_id = f.id
      AND NULLIF(btrim(cv.ai_handoff_summary), '') IS NOT NULL
    ORDER BY cv.last_message_at DESC NULLS LAST
    LIMIT 1
  ) hs ON true
  ORDER BY f.created_at DESC, f.id
$$;

REVOKE EXECUTE ON FUNCTION management_report(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION management_report(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, INTEGER) TO authenticated, service_role;

COMMENT ON FUNCTION management_report(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, INTEGER) IS
  'Informe de gestión: una fila por contacto no fusionado que llegó en [p_from, p_to), con asesor (conversación más reciente, si no, negocio), negocio reportado, etiquetas, mensajes, citas, última nota y resumen del traspaso. SECURITY INVOKER: aplica la RLS de quien llama.';
