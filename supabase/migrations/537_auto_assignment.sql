-- ============================================================
-- 537_auto_assignment.sql
--
-- La asignación automática, en UN solo lugar (P3 + P4).
--
-- Todo camino automático que asigna —el traspaso de la IA, la acción
-- "asignar" de las automatizaciones, la derivación de los flujos y el job
-- de conversaciones olvidadas— resuelve al asesor acá, en este orden:
--
--   1. CONSERVAR: si la conversación tiene un asesor vigente (miembro
--      owner/admin/agent), se queda con él. P2: el asesor es pegajoso.
--   2. CONTINUIDAD: el asesor del contacto según el historial de
--      cualquiera de sus conversaciones, si sigue siendo `agent`.
--   3. PREFERIDO: el que pide el camino (el `agent_id` de una
--      automatización, el `assign_to` de un flujo), si es vigente.
--   4. PORCENTAJES: el reparto configurado, salvo que el camino lo
--      desactive (un flujo sin asesor configurado nunca repartió).
--
-- POR QUÉ EN SQL Y NO EN TYPESCRIPT (antes vivía en pick-agent.ts)
--
--   * La cuota solo es correcta si leer el historial y escribir la
--     asignación ocurren bajo el MISMO candado. Dos traspasos simultáneos
--     en TypeScript leerían la misma cuenta y elegirían al mismo asesor.
--     Acá un `pg_advisory_xact_lock` por cuenta los serializa.
--   * La herencia al crear conversaciones (535) necesita la misma regla
--     de continuidad dentro de un trigger. Dos implementaciones que deben
--     coincidir es exactamente cómo divergen.
--
-- EL ALGORITMO DE PORCENTAJES (determinista, auditable)
--
-- Se cuentan las asignaciones con `source = 'weighted'` de la cuenta
-- desde `weights_updated_at` (la continuidad no consume cuota: ese lead
-- ya era de alguien; y mover la perilla reinicia la cuenta). Para cada
-- candidato, con n = sus asignaciones, N = las de todos, P = la suma de
-- porcentajes de los candidatos:
--
--     déficit = percent · (N + 1) − n · P
--
-- Gana el mayor déficit. Es "el más por debajo de su cuota" escrito sin
-- divisiones (todo entero, sin redondeos que dependan de la máquina).
-- Empates: mayor porcentaje, luego el perfil más antiguo, luego user_id.
-- Con 34/33/33 reparte A, B, C, A, B, C…
--
-- Candidatos: los de la lista que siguen siendo `agent`. Si la lista
-- está vacía o ya nadie en ella es candidato, se reparte parejo entre
-- todos los `agent` (una cuenta nueva no se queda sin reparto).
--
-- P4 se mide en HORAS y solo toca lo que quedó sin asesor después de
-- activarse la regla (ver run_stale_assignment_job).
--
-- Idempotente.
-- ============================================================

-- ============================================================
-- Elección por porcentajes (llamar con el candado de la cuenta tomado)
-- ============================================================
CREATE OR REPLACE FUNCTION pick_weighted_agent(p_account_id UUID)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since  TIMESTAMPTZ;
  v_agent  UUID;
  v_listed BOOLEAN;
BEGIN
  SELECT s.weights_updated_at INTO v_since
  FROM assignment_settings s WHERE s.account_id = p_account_id;

  SELECT EXISTS (
    SELECT 1 FROM assignment_weights w
    JOIN profiles p ON p.account_id = w.account_id AND p.user_id = w.user_id
    WHERE w.account_id = p_account_id AND p.account_role = 'agent'
  ) INTO v_listed;

  WITH cand AS (
    SELECT w.user_id, w.percent, p.created_at
    FROM assignment_weights w
    JOIN profiles p ON p.account_id = w.account_id AND p.user_id = w.user_id
    WHERE w.account_id = p_account_id AND p.account_role = 'agent' AND v_listed
    UNION ALL
    -- Sin lista utilizable: reparto parejo entre todos los `agent`.
    SELECT p.user_id, 1, p.created_at
    FROM profiles p
    WHERE p.account_id = p_account_id AND p.account_role = 'agent' AND NOT v_listed
  ),
  counts AS (
    SELECT ca.to_agent_id AS user_id, COUNT(*)::BIGINT AS n
    FROM conversation_assignments ca
    WHERE ca.account_id = p_account_id
      AND ca.source = 'weighted'
      AND ca.changed_at >= COALESCE(v_since, '-infinity'::TIMESTAMPTZ)
    GROUP BY ca.to_agent_id
  ),
  scored AS (
    SELECT c.user_id, c.percent, c.created_at, COALESCE(k.n, 0) AS n
    FROM cand c LEFT JOIN counts k ON k.user_id = c.user_id
  ),
  totals AS (
    SELECT SUM(n)::BIGINT AS big_n, SUM(percent)::BIGINT AS big_p FROM scored
  )
  SELECT s.user_id INTO v_agent
  FROM scored s CROSS JOIN totals t
  ORDER BY (s.percent::BIGINT * (t.big_n + 1) - s.n * t.big_p) DESC,
           s.percent DESC,
           s.created_at ASC NULLS LAST,
           s.user_id ASC
  LIMIT 1;

  RETURN v_agent;
END;
$$;

-- ============================================================
-- Resolver asesor (sin escribir). Devuelve el asesor y cómo se eligió:
--   kept | continuity | preferred | weighted | none
-- ============================================================
CREATE OR REPLACE FUNCTION resolve_auto_agent(
  p_account_id      UUID,
  p_contact_id      UUID,
  p_current_agent   UUID,
  p_preferred_agent UUID,
  p_allow_weighted  BOOLEAN,
  OUT agent_user_id UUID,
  OUT source        TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF is_active_member(p_account_id, p_current_agent) THEN
    agent_user_id := p_current_agent; source := 'kept'; RETURN;
  END IF;

  agent_user_id := contact_continuity_agent(p_account_id, p_contact_id);
  IF agent_user_id IS NOT NULL THEN
    source := 'continuity'; RETURN;
  END IF;

  IF is_active_member(p_account_id, p_preferred_agent) THEN
    agent_user_id := p_preferred_agent; source := 'preferred'; RETURN;
  END IF;

  IF p_allow_weighted THEN
    agent_user_id := pick_weighted_agent(p_account_id);
    IF agent_user_id IS NOT NULL THEN
      source := 'weighted'; RETURN;
    END IF;
  END IF;

  agent_user_id := NULL; source := 'none';
END;
$$;

-- El asesor como lo necesita la aplicación: user_id para la
-- conversación, profile_id para el negocio y el nombre para el cliente.
CREATE OR REPLACE FUNCTION assignment_agent_json(p_account_id UUID, p_user_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN p_user_id IS NULL THEN NULL ELSE jsonb_build_object(
    'user_id', p_user_id,
    'profile_id', (SELECT p.id FROM profiles p WHERE p.account_id = p_account_id AND p.user_id = p_user_id),
    'full_name', COALESCE((SELECT p.full_name FROM profiles p WHERE p.account_id = p_account_id AND p.user_id = p_user_id), '')
  ) END;
$$;

-- ============================================================
-- auto_assign_conversation — automatizaciones, flujos y el job
--
-- Devuelve { outcome, source, agent }:
--   outcome = assigned | kept | no_agent | not_found
-- ============================================================
CREATE OR REPLACE FUNCTION auto_assign_conversation(
  p_conversation_id UUID,
  p_origin          TEXT,
  p_preferred_agent UUID DEFAULT NULL,
  p_allow_weighted  BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv   RECORD;
  v_pick   RECORD;
BEGIN
  SELECT c.id, c.account_id, c.contact_id, c.assigned_agent_id INTO v_conv
  FROM conversations c WHERE c.id = p_conversation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  -- Serializa las elecciones de la cuenta: la cuota que lee una la ve la
  -- siguiente.
  PERFORM pg_advisory_xact_lock(hashtextextended('crm.assign.account:' || v_conv.account_id::TEXT, 0));

  SELECT * INTO v_pick FROM resolve_auto_agent(
    v_conv.account_id, v_conv.contact_id, v_conv.assigned_agent_id,
    p_preferred_agent, p_allow_weighted
  );

  IF v_pick.source = 'kept' THEN
    RETURN jsonb_build_object('outcome', 'kept', 'source', 'kept',
      'agent', assignment_agent_json(v_conv.account_id, v_pick.agent_user_id));
  END IF;
  IF v_pick.agent_user_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'no_agent', 'source', 'none', 'agent', NULL);
  END IF;

  PERFORM set_config('crm.assignment_source', v_pick.source, true);
  PERFORM set_config('crm.assignment_origin', p_origin, true);
  -- Un asesor que dejó la cuenta no es vigente: la guarda de la 535 lo
  -- deja pasar. Uno vigente ya salió arriba como 'kept'.
  UPDATE conversations SET assigned_agent_id = v_pick.agent_user_id
  WHERE id = p_conversation_id;

  RETURN jsonb_build_object('outcome', 'assigned', 'source', v_pick.source,
    'agent', assignment_agent_json(v_conv.account_id, v_pick.agent_user_id));
END;
$$;

-- ============================================================
-- ai_handoff_assign — el traspaso de la IA
--
-- Hace en UNA transacción lo que antes eran tres escrituras sueltas:
--   1. elige asesor (conservar → continuidad → porcentajes);
--   2. crea el negocio RICO (título "Nombre — Vehículo" y la nota) ANTES
--      de escribir el asesor, para que el negocio genérico del trigger de
--      la 536 no le gane el lugar;
--   3. un único UPDATE con asesor + pausa de la IA + nota. Que la nota
--      vaya en el mismo UPDATE que el asesor es lo que deja a
--      `notify_conversation_assigned` (521) reconocer el traspaso y
--      mandarle la nota al asesor;
--   4. si el asesor se CONSERVÓ (el lead que vuelve), no hay cambio de
--      asignación y ese aviso no sale: se inserta uno propio.
--
-- Devuelve { outcome, source, agent, deal }:
--   outcome = assigned | kept | no_agent | not_found
--   deal    = created | already_open | skipped:<motivo>
-- ============================================================
CREATE OR REPLACE FUNCTION ai_handoff_assign(
  p_conversation_id UUID,
  p_summary         TEXT,
  p_deal_title      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv    RECORD;
  v_pick    RECORD;
  v_deal    TEXT;
  v_outcome TEXT;
  v_contact TEXT;
BEGIN
  SELECT c.id, c.account_id, c.contact_id, c.assigned_agent_id INTO v_conv
  FROM conversations c WHERE c.id = p_conversation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('crm.assign.account:' || v_conv.account_id::TEXT, 0));

  SELECT * INTO v_pick FROM resolve_auto_agent(
    v_conv.account_id, v_conv.contact_id, v_conv.assigned_agent_id, NULL, TRUE
  );

  -- (2) El negocio primero. Se crea también sin asesor (cola compartida)
  -- y también cuando el asesor es owner/admin: el traspaso es intención
  -- de compra detectada por el bot. Un fallo acá no tumba el traspaso.
  BEGIN
    v_deal := ensure_open_deal_for_contact(
      p_conversation_id, v_pick.agent_user_id, p_deal_title, p_summary
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'No se pudo crear el negocio del traspaso de %: %', p_conversation_id, SQLERRM;
    v_deal := 'skipped:error';
  END;

  -- (3)
  IF v_pick.source NOT IN ('kept', 'none') THEN
    PERFORM set_config('crm.assignment_source', v_pick.source, true);
    PERFORM set_config('crm.assignment_origin', 'ai_handoff', true);
    UPDATE conversations
    SET assigned_agent_id = v_pick.agent_user_id,
        ai_autoreply_disabled = TRUE,
        ai_handoff_summary = p_summary
    WHERE id = p_conversation_id;
    v_outcome := 'assigned';
  ELSE
    UPDATE conversations
    SET ai_autoreply_disabled = TRUE,
        ai_handoff_summary = p_summary
    WHERE id = p_conversation_id;
    v_outcome := CASE WHEN v_pick.source = 'kept' THEN 'kept' ELSE 'no_agent' END;
  END IF;

  -- (4) El lead que vuelve: su asesor se entera.
  IF v_outcome = 'kept' THEN
    BEGIN
      SELECT COALESCE(NULLIF(ct.name, ''), ct.phone) INTO v_contact
      FROM contacts ct WHERE ct.id = v_conv.contact_id;

      INSERT INTO notifications (
        account_id, user_id, type, conversation_id, contact_id,
        actor_user_id, title, body
      ) VALUES (
        v_conv.account_id, v_pick.agent_user_id, 'conversation_assigned',
        p_conversation_id, v_conv.contact_id, NULL,
        'Tu cliente pidió un asesor',
        'Conversación con ' || COALESCE(v_contact, 'un contacto')
          || CASE WHEN COALESCE(p_summary, '') <> '' THEN E'\n' || p_summary ELSE '' END
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'No se pudo avisar al asesor de la conversación %: %', p_conversation_id, SQLERRM;
    END;
  END IF;

  RETURN jsonb_build_object(
    'outcome', v_outcome,
    'source', v_pick.source,
    'agent', assignment_agent_json(v_conv.account_id, v_pick.agent_user_id),
    'deal', v_deal
  );
END;
$$;

-- ============================================================
-- run_stale_assignment_job — P4
--
-- Asigna las conversaciones no cerradas sin asesor vigente, en las que
-- el CLIENTE escribió, que quedaron así DESPUÉS de activarse la regla y
-- llevan X horas así:
--
--     EXISTS (un mensaje entrante del cliente)
--     espera_desde = GREATEST(sin_asesor_desde, primer entrante del cliente)
--     espera_desde >= stale_assign_enabled_at
--     now() - espera_desde >= X horas
--
-- `sin_asesor_desde` = el último cambio de su historial (una devolución a
-- NULL, o la asignación a alguien que después dejó la cuenta), o su
-- creación si nunca tuvo asesor.
--
-- SOLO LEADS QUE ESCRIBEN (decisión del Tech Lead, 2026-09-23). Una
-- difusión crea una conversación por destinatario; sin este filtro, una
-- difusión a 500 contactos producía 500 asignaciones y 500 negocios
-- Prospecto a las 3 horas. Una conversación que solo tiene salientes no
-- es un lead y no entra nunca. En cuanto el cliente responde, entra con
-- la cuenta normal de horas, y el reloj corre desde SU PRIMER ENTRANTE
-- —no desde que se creó la conversación con la difusión—: el lead nace
-- cuando escribe. Y nunca antes de la activación: una difusión de antes
-- de activar a la que el cliente responde después sí entra (el lead es
-- nuevo); un cliente que ya había escrito antes de activar, no.
--
-- Costo: el primer entrante se lee con `ORDER BY created_at LIMIT 1`
-- sobre `idx_messages_conversation_created` (532), y solo para las
-- conversaciones que ya pasaron los filtros baratos (no cerradas, sin
-- asesor vigente, cuenta con la regla activa).
--
-- "NUNCA LAS DE ANTES" (decisión del Director del 2026-09-23): lo que ya
-- estaba sin asignar al activar la regla no lo toca este job jamás, ni
-- al activarla ni X horas después; lo asigna un admin a mano si quiere.
-- Una que un admin suelte DESPUÉS de activar sí entra, porque su
-- `sin_asesor_desde` es posterior. Cambiar X (3 → 5) no mueve la marca
-- de activación (534), así que tampoco resucita el rezago.
--
-- Para una huérfana —su asesor dejó la cuenta— `sin_asesor_desde` es el
-- instante de esa asignación: la salida del miembro no deja rastro. Si
-- esa asignación fue antes de activar, no entra; es el lado seguro.
--
-- Seguro ante ejecuciones concurrentes:
--   * candado de ejecución no bloqueante: si otra corrida lo tiene, esta
--     devuelve `skipped` sin tocar nada;
--   * `FOR UPDATE SKIP LOCKED` sobre las candidatas;
--   * `auto_assign_conversation` vuelve a comprobar, con la fila
--     bloqueada, que siga sin asesor vigente.
-- Idempotente: una conversación ya asignada deja de ser candidata.
--
-- Devuelve { skipped, assigned, conversation_ids }.
-- ============================================================
CREATE OR REPLACE FUNCTION run_stale_assignment_job(p_limit INTEGER DEFAULT 50)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row      RECORD;
  v_result   JSONB;
  v_assigned INTEGER := 0;
  v_ids      UUID[] := '{}';
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('crm.stale_assignment_job', 0)) THEN
    RETURN jsonb_build_object('skipped', TRUE, 'assigned', 0, 'conversation_ids', '[]'::JSONB);
  END IF;

  FOR v_row IN
    SELECT c.id
    FROM conversations c
    JOIN assignment_settings s ON s.account_id = c.account_id
    CROSS JOIN LATERAL (
      SELECT GREATEST(
               COALESCE(
                 (SELECT MAX(ca.changed_at) FROM conversation_assignments ca
                  WHERE ca.conversation_id = c.id),
                 c.created_at
               ),
               (SELECT m.created_at FROM messages m
                WHERE m.conversation_id = c.id AND m.sender_type = 'customer'
                ORDER BY m.created_at ASC
                LIMIT 1)
             ) AS desde
    ) espera
    WHERE s.stale_assign_after_hours IS NOT NULL
      AND s.stale_assign_enabled_at IS NOT NULL
      AND c.status <> 'closed'
      AND (c.assigned_agent_id IS NULL
           OR NOT is_active_member(c.account_id, c.assigned_agent_id))
      -- Solo leads que escribieron: sin entrante del cliente, nunca.
      AND EXISTS (
        SELECT 1 FROM messages m
        WHERE m.conversation_id = c.id AND m.sender_type = 'customer'
      )
      AND espera.desde >= s.stale_assign_enabled_at
      AND espera.desde <= now() - make_interval(hours => s.stale_assign_after_hours)
    ORDER BY espera.desde ASC, c.id ASC
    LIMIT GREATEST(p_limit, 0)
    FOR UPDATE OF c SKIP LOCKED
  LOOP
    v_result := auto_assign_conversation(v_row.id, 'stale_job', NULL, TRUE);
    IF v_result->>'outcome' = 'assigned' THEN
      v_assigned := v_assigned + 1;
      v_ids := v_ids || v_row.id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('skipped', FALSE, 'assigned', v_assigned,
                            'conversation_ids', to_jsonb(v_ids));
END;
$$;

-- ------------------------------------------------------------
-- Dueño y privilegios: solo service-role. Todas escriben saltándose la
-- RLS y ninguna comprueba sesión: no son para el navegador.
-- ------------------------------------------------------------
ALTER FUNCTION pick_weighted_agent(UUID) OWNER TO postgres;
ALTER FUNCTION resolve_auto_agent(UUID, UUID, UUID, UUID, BOOLEAN) OWNER TO postgres;
ALTER FUNCTION assignment_agent_json(UUID, UUID) OWNER TO postgres;
ALTER FUNCTION auto_assign_conversation(UUID, TEXT, UUID, BOOLEAN) OWNER TO postgres;
ALTER FUNCTION ai_handoff_assign(UUID, TEXT, TEXT) OWNER TO postgres;
ALTER FUNCTION run_stale_assignment_job(INTEGER) OWNER TO postgres;

REVOKE ALL ON FUNCTION pick_weighted_agent(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION resolve_auto_agent(UUID, UUID, UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION assignment_agent_json(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION auto_assign_conversation(UUID, TEXT, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ai_handoff_assign(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION run_stale_assignment_job(INTEGER) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION pick_weighted_agent(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION resolve_auto_agent(UUID, UUID, UUID, UUID, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION assignment_agent_json(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION auto_assign_conversation(UUID, TEXT, UUID, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION ai_handoff_assign(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION run_stale_assignment_job(INTEGER) TO service_role;
