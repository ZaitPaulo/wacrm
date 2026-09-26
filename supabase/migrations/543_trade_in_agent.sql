-- ============================================================
-- 543_trade_in_agent.sql
--
-- El asesor para ventas y permutas (cambio `asesor-ventas-y-permutas`).
--
-- Los clientes que quieren VENDERLE su carro al concesionario o
-- entregarlo en PERMUTA los atiende una sola persona (en producción,
-- Angélica): avalúa, pide el peritaje y negocia la compra. Decisión del
-- Director del 2026-09-25: esos traspasos van SIEMPRE a ella, aunque el
-- cliente ya tenga asesor.
--
--   * `assignment_settings.trade_in_agent_id`: quién es. NULL =
--     desactivado. Cualquier miembro vigente (owner/admin/agent): Angélica
--     es `admin`, así que la vara es `is_active_member`, no
--     `is_assignable_agent`. Sin FK, igual que `assigned_agent_id`.
--
--   * `conversation_assignments.source` admite 'reason': la asignación
--     vino del motivo del traspaso. No consume cuota del reparto
--     (`pick_weighted_agent` solo cuenta 'weighted').
--
--   * `ai_handoff_assign` recibe `p_reason`. Con 'vende_su_carro' o
--     'permuta' y un asesor configurado vigente, se elige a ese asesor
--     ANTES del orden normal (conservar → continuidad → porcentajes).
--     Es la ÚNICA excepción a la guarda de la 535: pasa con
--     `crm.assignment_override`, encendido solo alrededor de su UPDATE y
--     apagado enseguida, así no se filtra a nada más de la transacción.
--     Además:
--       - los negocios ABIERTOS del contacto que tenía el asesor anterior
--         pasan al nuevo (los de otros asesores no: pueden ser otra
--         compra);
--       - el asesor anterior recibe un aviso "Tu cliente pasó a …".
--     Ninguna de las dos cosas puede tumbar el traspaso.
--
-- `p_reason` tiene DEFAULT NULL: entre esta migración y el despliegue del
-- código, la llamada de tres argumentos sigue igual que antes.
--
-- Idempotente. Rollback: vaciar el ajuste deja el comportamiento de
-- antes; el completo es restaurar la RPC de la 537.
-- ============================================================

ALTER TABLE assignment_settings
  ADD COLUMN IF NOT EXISTS trade_in_agent_id UUID;

COMMENT ON COLUMN assignment_settings.trade_in_agent_id IS
  'Asesor (auth.users.id) que recibe SIEMPRE los traspasos de la IA con motivo vende_su_carro o permuta, aunque la conversación ya tenga asesor. NULL = desactivado. Tiene que ser miembro vigente (owner/admin/agent).';

ALTER TABLE conversation_assignments
  DROP CONSTRAINT IF EXISTS conversation_assignments_source_check;
ALTER TABLE conversation_assignments
  ADD CONSTRAINT conversation_assignments_source_check
  CHECK (source IS NULL OR source IN ('continuity', 'preferred', 'weighted', 'reason'));

-- ============================================================
-- ai_handoff_assign — el traspaso de la IA, ahora con motivo
--
-- Otra firma: CREATE OR REPLACE crearía una sobrecarga y PostgREST no
-- sabría a cuál llamar con tres argumentos. Se borra la de la 537.
-- ============================================================
DROP FUNCTION IF EXISTS ai_handoff_assign(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION ai_handoff_assign(
  p_conversation_id UUID,
  p_summary         TEXT,
  p_deal_title      TEXT DEFAULT NULL,
  p_reason          TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv      RECORD;
  v_pick      RECORD;
  v_agent     UUID;
  v_source    TEXT;
  v_trade_in  UUID;
  -- El traspaso por motivo le QUITA la conversación a un asesor vigente.
  v_takeover  BOOLEAN := FALSE;
  v_deal      TEXT;
  v_outcome   TEXT;
  v_contact   TEXT;
  v_new_name  TEXT;
BEGIN
  SELECT c.id, c.account_id, c.contact_id, c.assigned_agent_id INTO v_conv
  FROM conversations c WHERE c.id = p_conversation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('crm.assign.account:' || v_conv.account_id::TEXT, 0));

  -- (1) Venta o permuta: el asesor configurado, antes que nada.
  IF p_reason IN ('vende_su_carro', 'permuta') THEN
    SELECT s.trade_in_agent_id INTO v_trade_in
    FROM assignment_settings s WHERE s.account_id = v_conv.account_id;

    IF is_active_member(v_conv.account_id, v_trade_in) THEN
      v_agent := v_trade_in;
      IF v_conv.assigned_agent_id IS NOT DISTINCT FROM v_trade_in THEN
        v_source := 'kept';
      ELSE
        v_source := 'reason';
        v_takeover := is_active_member(v_conv.account_id, v_conv.assigned_agent_id);
      END IF;
    END IF;
  END IF;

  -- Cualquier otro caso: el orden normal de la 537, sin cambios.
  IF v_source IS NULL THEN
    SELECT * INTO v_pick FROM resolve_auto_agent(
      v_conv.account_id, v_conv.contact_id, v_conv.assigned_agent_id, NULL, TRUE
    );
    v_agent := v_pick.agent_user_id;
    v_source := v_pick.source;
  END IF;

  -- (2) El negocio primero (ver la 537). Un fallo acá no tumba el traspaso.
  BEGIN
    v_deal := ensure_open_deal_for_contact(
      p_conversation_id, v_agent, p_deal_title, p_summary
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'No se pudo crear el negocio del traspaso de %: %', p_conversation_id, SQLERRM;
    v_deal := 'skipped:error';
  END;

  -- (2b) El negocio sigue a quien atiende la venta o permuta: los
  -- abiertos del contacto que llevaba el asesor anterior pasan al nuevo.
  -- `deals.assigned_to` es profiles.id, no auth.users.id.
  IF v_source = 'reason' AND v_conv.assigned_agent_id IS NOT NULL THEN
    BEGIN
      UPDATE deals d
      SET assigned_to = (
        SELECT p.id FROM profiles p
        WHERE p.account_id = v_conv.account_id AND p.user_id = v_agent
      )
      WHERE d.account_id = v_conv.account_id
        AND d.contact_id = v_conv.contact_id
        AND d.status = 'open'
        AND d.assigned_to = (
          SELECT p.id FROM profiles p
          WHERE p.account_id = v_conv.account_id AND p.user_id = v_conv.assigned_agent_id
        );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'No se pudo mover el negocio del contacto % a su nuevo asesor: %', v_conv.contact_id, SQLERRM;
    END;
  END IF;

  -- (3) Un único UPDATE con asesor + pausa + nota (ver la 537).
  IF v_source NOT IN ('kept', 'none') THEN
    PERFORM set_config('crm.assignment_source', v_source, true);
    PERFORM set_config('crm.assignment_origin', 'ai_handoff', true);
    -- La guarda de la 535 conservaría al asesor vigente. Este es el único
    -- camino automático que puede reemplazarlo, y solo en esta sentencia.
    IF v_takeover THEN
      PERFORM set_config('crm.assignment_override', 'on', true);
    END IF;
    UPDATE conversations
    SET assigned_agent_id = v_agent,
        ai_autoreply_disabled = TRUE,
        ai_handoff_summary = p_summary
    WHERE id = p_conversation_id;
    IF v_takeover THEN
      PERFORM set_config('crm.assignment_override', '', true);
    END IF;
    v_outcome := 'assigned';
  ELSE
    UPDATE conversations
    SET ai_autoreply_disabled = TRUE,
        ai_handoff_summary = p_summary
    WHERE id = p_conversation_id;
    v_outcome := CASE WHEN v_source = 'kept' THEN 'kept' ELSE 'no_agent' END;
  END IF;

  IF v_outcome = 'kept' OR v_takeover THEN
    SELECT COALESCE(NULLIF(ct.name, ''), ct.phone) INTO v_contact
    FROM contacts ct WHERE ct.id = v_conv.contact_id;
  END IF;

  -- (4) El lead que vuelve: su asesor se entera (igual que la 537).
  IF v_outcome = 'kept' THEN
    BEGIN
      INSERT INTO notifications (
        account_id, user_id, type, conversation_id, contact_id,
        actor_user_id, title, body
      ) VALUES (
        v_conv.account_id, v_agent, 'conversation_assigned',
        p_conversation_id, v_conv.contact_id, NULL,
        'Tu cliente pidió un asesor',
        'Conversación con ' || COALESCE(v_contact, 'un contacto')
          || CASE WHEN COALESCE(p_summary, '') <> '' THEN E'\n' || p_summary ELSE '' END
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'No se pudo avisar al asesor de la conversación %: %', p_conversation_id, SQLERRM;
    END;
  END IF;

  -- (5) Quien perdió la conversación por el motivo también se entera.
  IF v_takeover AND v_outcome = 'assigned' THEN
    BEGIN
      SELECT NULLIF(split_part(btrim(COALESCE(p.full_name, '')), ' ', 1), '') INTO v_new_name
      FROM profiles p
      WHERE p.account_id = v_conv.account_id AND p.user_id = v_agent;

      INSERT INTO notifications (
        account_id, user_id, type, conversation_id, contact_id,
        actor_user_id, title, body
      ) VALUES (
        v_conv.account_id, v_conv.assigned_agent_id, 'conversation_assigned',
        p_conversation_id, v_conv.contact_id, NULL,
        'Tu cliente pasó a ' || COALESCE(v_new_name, 'otro asesor'),
        'Conversación con ' || COALESCE(v_contact, 'un contacto') || ' · Motivo: '
          || CASE p_reason WHEN 'vende_su_carro' THEN 'quiere vender su carro' ELSE 'permuta' END
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'No se pudo avisar al asesor anterior de la conversación %: %', p_conversation_id, SQLERRM;
    END;
  END IF;

  RETURN jsonb_build_object(
    'outcome', v_outcome,
    'source', v_source,
    'agent', assignment_agent_json(v_conv.account_id, v_agent),
    'deal', v_deal
  );
END;
$$;

ALTER FUNCTION ai_handoff_assign(UUID, TEXT, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION ai_handoff_assign(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ai_handoff_assign(UUID, TEXT, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION ai_handoff_assign(UUID, TEXT, TEXT, TEXT) IS
  'Traspaso de la IA en una transacción: elige asesor (venta/permuta → asesor configurado; si no, conservar → continuidad → porcentajes), crea el negocio, pausa la IA con la nota y avisa. Devuelve { outcome, source, agent, deal }.';
