-- ============================================================
-- 538_returning_lead_bot_reactivation.sql
--
-- El lead que vuelve habla primero con el bot.
--
-- Con el asesor pegajoso (P2) la pausa del traspaso también lo es: sin
-- esto, un cliente que vuelve semanas después por otra campaña no
-- recibiría nunca respuesta del bot, solo la de un asesor que quizá ya
-- no lo recuerda. Decisión del Director: le responde primero el bot, y
-- cuando traspasa va directo a su mismo asesor (eso lo hace 537).
--
-- LA REGLA: entra un mensaje del cliente en una conversación con la IA
-- pausada, y el último mensaje ANTERIOR de la conversación —de cualquier
-- remitente— tiene más de N días (`assignment_settings.
-- bot_reactivate_after_days`, 7 por defecto, NULL = desactivado). Se
-- reactiva la IA igual que "Reactivar IA": pausa fuera, tope y contador
-- de transferencias rechazadas a cero. El asesor y la nota del traspaso
-- se conservan.
--
-- SOLO SI EL ASESOR ES `agent`, O NO HAY ASESOR (decisión del Director
-- del 2026-09-23). Si el hilo es de un owner/admin —la campaña de
-- propietarios de Angélica—, el bot NUNCA se reactiva solo: a un
-- propietario que vuelve a escribir no se le habla como a un comprador.
-- Un asesor que ya dejó la cuenta cuenta como "sin asesor".
--
-- NO se usa el `referral` del anuncio como disparador (decisión del
-- Tech Lead): reactivaría el bot en medio de una negociación viva con el
-- asesor, solo porque el cliente volvió a tocar el anuncio.
--
-- POR QUÉ SE MIDE CONTRA EL PROPIO ENTRANTE Y NO CONTRA `now()`
--
-- "Anterior" es `created_at < el del entrante`. En una ráfaga procesada
-- en paralelo, el segundo mensaje ve al primero como anterior y no
-- reactiva de nuevo, sin importar en qué orden terminen de procesarse; y
-- un mensaje que Meta entrega con retraso se juzga por cuándo lo mandó
-- el cliente. El UPDATE es uno solo y condicionado, así que dos llamadas
-- simultáneas no pueden reactivar dos veces.
--
-- Idempotente.
-- ============================================================

CREATE OR REPLACE FUNCTION reactivate_ai_for_returning_lead(
  p_conversation_id    UUID,
  p_inbound_message_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days       INTEGER;
  v_inbound_at TIMESTAMPTZ;
  v_previous   TIMESTAMPTZ;
  v_updated    INTEGER;
  v_account    UUID;
  v_assignee   UUID;
BEGIN
  SELECT m.created_at INTO v_inbound_at
  FROM messages m
  WHERE m.id = p_inbound_message_id
    AND m.conversation_id = p_conversation_id
    AND m.sender_type = 'customer';
  IF v_inbound_at IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Sin fila de configuración rige el valor por defecto (7): la cuenta
  -- que nunca abrió la pantalla de Ajustes se comporta como la que sí.
  SELECT CASE WHEN s.account_id IS NULL THEN 7 ELSE s.bot_reactivate_after_days END,
         c.account_id, c.assigned_agent_id
    INTO v_days, v_account, v_assignee
  FROM conversations c
  LEFT JOIN assignment_settings s ON s.account_id = c.account_id
  WHERE c.id = p_conversation_id;
  IF v_days IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Con asesor vigente que no es `agent` (owner/admin), nunca.
  IF is_active_member(v_account, v_assignee)
     AND NOT is_assignable_agent(v_account, v_assignee) THEN
    RETURN FALSE;
  END IF;

  SELECT MAX(m.created_at) INTO v_previous
  FROM messages m
  WHERE m.conversation_id = p_conversation_id
    AND m.created_at < v_inbound_at;

  -- Una conversación pausada sin ningún mensaje anterior (poco probable,
  -- p. ej. pausada a mano antes del primer mensaje) cuenta como inactiva.
  IF v_previous IS NOT NULL
     AND v_previous > v_inbound_at - make_interval(days => v_days) THEN
    RETURN FALSE;
  END IF;

  UPDATE conversations
  SET ai_autoreply_disabled = FALSE,
      ai_reply_count = 0,
      ai_handoff_attempts = 0
  WHERE id = p_conversation_id
    AND ai_autoreply_disabled = TRUE;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN v_updated > 0;
END;
$$;

ALTER FUNCTION reactivate_ai_for_returning_lead(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION reactivate_ai_for_returning_lead(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reactivate_ai_for_returning_lead(UUID, UUID) TO service_role;

COMMENT ON FUNCTION reactivate_ai_for_returning_lead(UUID, UUID) IS
  'Reactiva la IA pausada de una conversación cuando el entrante llega tras más de assignment_settings.bot_reactivate_after_days días sin mensajes. Conserva asesor y nota. Devuelve TRUE si reactivó.';
