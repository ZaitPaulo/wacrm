-- ============================================================
-- 539_assignment_data_seed.sql
--
-- Que el día del despliegue nada cambie de comportamiento hasta que un
-- admin configure. Tres movimientos de DATOS:
--
--   1. Una fila de `assignment_settings` por cuenta con P4 ACTIVADO a 3
--      horas (decisión del Director del 2026-09-23) y la reactivación del
--      lead que vuelve en 7 días. La marca de activación la fija el
--      trigger de la 534 en el instante del despliegue, y el job solo toca
--      conversaciones que queden sin asesor DESPUÉS de ella: las ~177 sin
--      asignar de hoy no se reparten nunca por este camino. Aplica a
--      todas las cuentas existentes (en producción hay una); una cuenta
--      creada después no tiene fila y P4 queda apagado hasta configurarlo.
--
--   2. Porcentajes que reproducen el reparto de hoy:
--        * si `ai_configs.handoff_agent_id` apunta a un `agent` de la
--          cuenta → 100 % a esa persona (el "asesor fijo" queda
--          subsumido: un asesor fijo es 100 % a una persona);
--        * si no → partes iguales entre los `agent`, y el resto de la
--          división se reparte de a un punto empezando por el más
--          antiguo (3 asesores → 34/33/33).
--      Hoy se repartía por carga; el reparto parejo es lo más parecido
--      que se puede expresar en porcentajes, y es lo que pidió el Tech
--      Lead. En producción (2026-09-23) `handoff_agent_id` es NULL y hay
--      3 `agent`: queda 34/33/33.
--      Cuentas que ya tienen porcentajes no se tocan (re-ejecución).
--
--   3. PAUSA DE LA IA en las conversaciones asignadas con la IA activa.
--      Hasta hoy tener asesor era lo que callaba al bot; desde este lote
--      lo único que lo calla es `ai_autoreply_disabled`. Sin esto, al
--      desplegar el bot empezaría a responder en 71 conversaciones con
--      asesor —68 de ellas son propietarios de la campaña de Angélica, a
--      los que les ofrecería carros—. Pausarlas reproduce exactamente lo
--      de hoy. No toca `assigned_agent_id`, así que no dispara historial,
--      avisos ni negocios.
--
-- Idempotente en 1 y 2 (no pisa lo configurado). El paso 3 está pensado
-- para correr UNA vez, al desplegar: re-ejecutarlo después volvería a
-- pausar la IA en hilos con asesor que la tengan activa a propósito
-- (herencia entre canales, lead que volvió).
--
-- Ensayado el 2026-09-23 contra la base del VPS, 531-539 en una
-- transacción con ROLLBACK: 71 → 0 asignadas con IA activa, pesos
-- Juan 34 / Brayan 33 / Robinson 33, X = 3 horas, N = 7, 0 negocios
-- creados, y el job no asigna nada justo después de desplegar.
-- ============================================================

-- 1. Configuración por cuenta
INSERT INTO assignment_settings (account_id, stale_assign_after_hours, bot_reactivate_after_days)
SELECT a.id, 3, 7
FROM accounts a
ON CONFLICT (account_id) DO NOTHING;

-- 2. Porcentajes
DO $$
DECLARE
  v_account RECORD;
  v_fixed   UUID;
  v_agents  UUID[];
  v_n       INTEGER;
  v_base    INTEGER;
  v_rest    INTEGER;
  v_weights JSONB;
BEGIN
  FOR v_account IN SELECT a.id FROM accounts a LOOP
    IF EXISTS (SELECT 1 FROM assignment_weights w WHERE w.account_id = v_account.id) THEN
      CONTINUE;
    END IF;

    SELECT ac.handoff_agent_id INTO v_fixed
    FROM ai_configs ac WHERE ac.account_id = v_account.id;

    IF v_fixed IS NOT NULL AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.account_id = v_account.id AND p.user_id = v_fixed AND p.account_role = 'agent'
    ) THEN
      v_weights := jsonb_build_array(jsonb_build_object('user_id', v_fixed, 'percent', 100));
    ELSE
      SELECT array_agg(p.user_id ORDER BY p.created_at ASC, p.user_id ASC) INTO v_agents
      FROM profiles p
      WHERE p.account_id = v_account.id AND p.account_role = 'agent';

      v_n := COALESCE(array_length(v_agents, 1), 0);
      -- Más de 100 asesores no caben en porcentajes enteros de al menos
      -- 1; esa cuenta se queda sin lista y reparte parejo igual.
      IF v_n = 0 OR v_n > 100 THEN
        CONTINUE;
      END IF;
      v_base := 100 / v_n;
      v_rest := 100 - v_base * v_n;

      SELECT jsonb_agg(jsonb_build_object(
               'user_id', v_agents[i],
               'percent', v_base + CASE WHEN i <= v_rest THEN 1 ELSE 0 END)
             ORDER BY i)
        INTO v_weights
      FROM generate_series(1, v_n) AS i;
    END IF;

    PERFORM set_assignment_weights(v_account.id, v_weights);
  END LOOP;
END $$;

-- 3. El asesor ya no calla al bot: se pausa donde lo callaba.
UPDATE conversations
SET ai_autoreply_disabled = TRUE
WHERE assigned_agent_id IS NOT NULL
  AND ai_autoreply_disabled = FALSE;
