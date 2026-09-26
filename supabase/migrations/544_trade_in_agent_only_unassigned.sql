-- ============================================================
-- 544_trade_in_agent_only_unassigned.sql
--
-- El asesor de ventas y permutas SOLO recibe clientes sin asesor
-- (cambio `ventas-permutas-sin-reasignar`).
--
-- La 543 mandaba todo traspaso por 'vende_su_carro' o 'permuta' al asesor
-- configurado (Angélica) ANTES del orden normal: si hacía falta, le
-- quitaba la conversación a un asesor vigente con el override de la 535,
-- le movía el negocio abierto y le avisaba. Decisión del Director del
-- 2026-09-26: a un cliente que ya tiene asesor no se le cambia nada
-- automáticamente. Si tiene que pasar a Angélica, lo mueve a mano un
-- admin.
--
-- Ahora el asesor de ventas y permutas es el PREFERIDO de
-- `resolve_auto_agent` (537), que ya tiene el orden justo:
--
--   conservar el asesor vigente → continuidad del contacto →
--   preferido (ventas y permutas, solo con esos motivos) → porcentajes
--
-- Cuando gana el preferido se registra como 'reason' (no 'preferred'),
-- para que el historial distinga esta ruta de automatizaciones y flujos.
-- 'reason' no consume cuota del reparto.
--
-- Desaparece todo lo que solo existía para reasignar: el override, el
-- traslado del negocio y el aviso "Tu cliente pasó a …". La guarda de la
-- 535 vuelve a no tener excepciones automáticas.
--
-- Misma firma que la 543: sin DROP y sin cambios de permisos. Se quedan
-- `assignment_settings.trade_in_agent_id` y 'reason' en el CHECK.
--
-- Al aplicarla en producción había 0 asignaciones 'reason': no hay
-- reasignaciones que deshacer.
--
-- Idempotente. Rollback: volver a aplicar la función de la 543.
-- ============================================================

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
  v_source    TEXT;
  v_preferred UUID;
  v_deal      TEXT;
  v_outcome   TEXT;
  v_contact   TEXT;
BEGIN
  SELECT c.id, c.account_id, c.contact_id, c.assigned_agent_id INTO v_conv
  FROM conversations c WHERE c.id = p_conversation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('crm.assign.account:' || v_conv.account_id::TEXT, 0));

  -- (1) Venta o permuta: el asesor configurado entra como preferido, así
  -- que solo se elige si no hay asesor vigente ni continuidad.
  IF p_reason IN ('vende_su_carro', 'permuta') THEN
    SELECT s.trade_in_agent_id INTO v_preferred
    FROM assignment_settings s WHERE s.account_id = v_conv.account_id;
  END IF;

  SELECT * INTO v_pick FROM resolve_auto_agent(
    v_conv.account_id, v_conv.contact_id, v_conv.assigned_agent_id, v_preferred, TRUE
  );
  -- El único preferido que puede llegar acá es el de ventas y permutas.
  v_source := CASE WHEN v_pick.source = 'preferred' THEN 'reason' ELSE v_pick.source END;

  -- (2) El negocio primero (ver la 537). Un fallo acá no tumba el traspaso.
  BEGIN
    v_deal := ensure_open_deal_for_contact(
      p_conversation_id, v_pick.agent_user_id, p_deal_title, p_summary
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'No se pudo crear el negocio del traspaso de %: %', p_conversation_id, SQLERRM;
    v_deal := 'skipped:error';
  END;

  -- (3) Un único UPDATE con asesor + pausa + nota (ver la 537).
  IF v_source NOT IN ('kept', 'none') THEN
    PERFORM set_config('crm.assignment_source', v_source, true);
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
    v_outcome := CASE WHEN v_source = 'kept' THEN 'kept' ELSE 'no_agent' END;
  END IF;

  -- (4) El lead que vuelve: su asesor se entera (igual que la 537).
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
    'source', v_source,
    'agent', assignment_agent_json(v_conv.account_id, v_pick.agent_user_id),
    'deal', v_deal
  );
END;
$$;

COMMENT ON COLUMN assignment_settings.trade_in_agent_id IS
  'Asesor (auth.users.id) que recibe los traspasos de la IA con motivo vende_su_carro o permuta de clientes SIN asesor (ni vigente ni de continuidad). Nunca reemplaza a uno. NULL = desactivado. Tiene que ser miembro vigente (owner/admin/agent).';

COMMENT ON FUNCTION ai_handoff_assign(UUID, TEXT, TEXT, TEXT) IS
  'Traspaso de la IA en una transacción: elige asesor (conservar → continuidad → asesor de ventas y permutas si el motivo es vende_su_carro/permuta → porcentajes), crea el negocio, pausa la IA con la nota y avisa. Nunca reemplaza a un asesor vigente. Devuelve { outcome, source, agent, deal }.';
