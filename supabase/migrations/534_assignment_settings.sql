-- ============================================================
-- 534_assignment_settings.sql
--
-- La configuración del reparto automático, por cuenta.
--
--   * `assignment_settings`: una fila por cuenta con
--       - `stale_assign_after_hours` (P4): X HORAS sin asesor tras las
--         cuales el job asigna la conversación (1 a 720; NULL =
--         desactivado). En horas por decisión del Director del
--         2026-09-23: la cuenta de producción arranca en 3 (migración 539).
--       - `stale_assign_enabled_at`: cuándo se ACTIVÓ esa regla. El job
--         solo toca conversaciones que quedaron sin asesor DESPUÉS de este
--         instante: las que ya estaban sin asignar al activarla no las
--         reparte nunca (lo hace un admin a mano si quiere). Lo mantiene
--         un trigger; el cliente no puede escribirlo.
--       - `bot_reactivate_after_days`: N días de silencio tras los que
--         un mensaje del cliente reactiva la IA pausada (el lead que
--         vuelve). 7 por defecto, NULL = desactivado.
--       - `weights_updated_at`: cuándo se cambiaron los porcentajes por
--         última vez. La cuota del reparto se cuenta desde ese instante.
--
--   * `assignment_weights` (P3): cada asesor `agent` con su porcentaje
--     entero. La suma tiene que ser EXACTAMENTE 100 (o la lista vacía,
--     que significa "sin configurar" y reparte parejo).
--
-- DÓNDE SE VALIDA LA SUMA, Y POR QUÉ ASÍ
--
-- En un CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED: corre al
-- confirmar la transacción, no fila por fila. Eso deja reemplazar la
-- lista entera (borrar y reinsertar) sin pasar por estados intermedios
-- inválidos, y a la vez rechaza cualquier estado FINAL que no sume 100,
-- venga de la API, de la RPC o de SQL a mano. La API valida lo mismo
-- antes para dar un error legible; la base es la última palabra.
--
-- Reemplazar la lista va por la RPC `set_assignment_weights`, no por
-- escrituras sueltas: PostgREST no ofrece transacciones de varias
-- sentencias, y la RPC además comprueba que cada persona sea `agent` de
-- la cuenta y actualiza `weights_updated_at` en el mismo movimiento.
--
-- PRIVILEGIOS: REVOKE primero y GRANT después, igual que la 531. En el
-- VPS `pg_default_acl` le da TODO a `anon` sobre cada tabla nueva; en
-- local le quita el SELECT a `authenticated`. Así el resultado es el
-- mismo en los dos.
--
-- Idempotente. Rollback: DROP de las dos tablas y de la función.
-- ============================================================

CREATE TABLE IF NOT EXISTS assignment_settings (
  account_id                UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  -- 720 h = 30 días: más allá ya no es "una conversación olvidada".
  stale_assign_after_hours  INTEGER
    CHECK (stale_assign_after_hours BETWEEN 1 AND 720),
  stale_assign_enabled_at   TIMESTAMPTZ,
  bot_reactivate_after_days INTEGER DEFAULT 7
    CHECK (bot_reactivate_after_days BETWEEN 1 AND 365),
  weights_updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- La regla está activa si y solo si tiene su instante de activación.
  CONSTRAINT assignment_settings_stale_consistent
    CHECK ((stale_assign_after_hours IS NULL) = (stale_assign_enabled_at IS NULL))
);

COMMENT ON TABLE assignment_settings IS
  'Configuración del reparto automático por cuenta: plazo del job de conversaciones olvidadas (P4), días de silencio para reactivar la IA al lead que vuelve, y cuándo cambiaron los porcentajes.';

CREATE TABLE IF NOT EXISTS assignment_weights (
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- `auth.users.id`, igual que `conversations.assigned_agent_id`. Sin FK
  -- por simetría con esa columna; que sea `agent` de la cuenta lo
  -- comprueba `set_assignment_weights`, y el reparto ignora a quien ya
  -- no lo sea.
  user_id    UUID NOT NULL,
  percent    INTEGER NOT NULL CHECK (percent BETWEEN 1 AND 100),
  PRIMARY KEY (account_id, user_id)
);

COMMENT ON TABLE assignment_weights IS
  'Porcentaje de asignaciones automáticas de leads nuevos que recibe cada asesor (P3). Suma 100 por cuenta, validado al confirmar por el constraint trigger check_assignment_weights_sum. Lista vacía = reparto parejo entre los agent.';

-- ------------------------------------------------------------
-- Privilegios
-- ------------------------------------------------------------
REVOKE ALL ON assignment_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON assignment_weights  FROM PUBLIC, anon, authenticated;

-- La configuración general la escribe la ruta de Ajustes con la sesión
-- del admin; la RLS de abajo es la que acota a owner/admin.
GRANT SELECT, INSERT, UPDATE ON assignment_settings TO authenticated;
-- Los porcentajes solo se LEEN desde el cliente: se escriben por la RPC.
GRANT SELECT ON assignment_weights TO authenticated;
GRANT ALL ON assignment_settings TO service_role;
GRANT ALL ON assignment_weights  TO service_role;

-- ------------------------------------------------------------
-- RLS — solo owner / admin
-- ------------------------------------------------------------
ALTER TABLE assignment_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignment_weights  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS assignment_settings_select ON assignment_settings;
CREATE POLICY assignment_settings_select ON assignment_settings FOR SELECT
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS assignment_settings_insert ON assignment_settings;
CREATE POLICY assignment_settings_insert ON assignment_settings FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS assignment_settings_update ON assignment_settings;
CREATE POLICY assignment_settings_update ON assignment_settings FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS assignment_weights_select ON assignment_weights;
CREATE POLICY assignment_weights_select ON assignment_weights FOR SELECT
  USING (is_account_member(account_id, 'admin'));
-- Sin políticas de escritura: con RLS activa, niega. Solo la RPC escribe.

-- ------------------------------------------------------------
-- `stale_assign_enabled_at` lo decide la base
--
-- Se fija al ACTIVAR (NULL → valor), se conserva al cambiar el número
-- (3 → 5 horas no la reinicia) y se borra al desactivar. Lo que mande el
-- cliente en esa columna se ignora: si pudiera escribirla, podría fechar
-- la activación en el pasado y repartir el rezago que ya existía, que es
-- justo lo que el Director pidió evitar.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION assignment_settings_track_activation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.stale_assign_after_hours IS NULL THEN
    NEW.stale_assign_enabled_at := NULL;
  ELSIF TG_OP = 'INSERT' OR OLD.stale_assign_after_hours IS NULL THEN
    NEW.stale_assign_enabled_at := now();
  ELSE
    NEW.stale_assign_enabled_at := OLD.stale_assign_enabled_at;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assignment_settings_track_activation ON assignment_settings;
CREATE TRIGGER assignment_settings_track_activation
  BEFORE INSERT OR UPDATE ON assignment_settings
  FOR EACH ROW EXECUTE FUNCTION assignment_settings_track_activation();

-- ------------------------------------------------------------
-- Suma = 100, comprobada al confirmar
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_assignment_weights_sum()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID := COALESCE(NEW.account_id, OLD.account_id);
  v_total   BIGINT;
  v_count   BIGINT;
BEGIN
  SELECT COALESCE(SUM(percent), 0), COUNT(*) INTO v_total, v_count
  FROM assignment_weights
  WHERE account_id = v_account;

  IF v_count > 0 AND v_total <> 100 THEN
    RAISE EXCEPTION
      'Los porcentajes de asignación de la cuenta % suman %, no 100', v_account, v_total
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

ALTER FUNCTION check_assignment_weights_sum() OWNER TO postgres;

DROP TRIGGER IF EXISTS check_assignment_weights_sum ON assignment_weights;
CREATE CONSTRAINT TRIGGER check_assignment_weights_sum
  AFTER INSERT OR UPDATE OR DELETE ON assignment_weights
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_assignment_weights_sum();

-- ------------------------------------------------------------
-- RPC: reemplazar la lista de porcentajes
--
-- `p_weights` = [{ "user_id": "...", "percent": 34 }, ...]. Reemplaza la
-- lista ENTERA. Errores con mensaje fijo para que la ruta los traduzca;
-- la ruta valida antes lo mismo, así que en la práctica solo llegan acá
-- las carreras (alguien cambió el rol de un asesor entre medio).
--
-- SECURITY DEFINER porque escribe una tabla sin políticas de escritura;
-- por eso mismo comprueba el rol adentro con `auth.uid()`. Llamada con
-- service-role (`auth.uid()` NULL) también pasa: la usa la migración de
-- datos y no hay sesión que comprobar.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_assignment_weights(p_account_id UUID, p_weights JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item JSONB;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT is_account_member(p_account_id, 'admin') THEN
    RAISE EXCEPTION 'Solo owner o admin cambian los porcentajes' USING ERRCODE = '42501';
  END IF;

  IF p_weights IS NULL OR jsonb_typeof(p_weights) <> 'array' THEN
    RAISE EXCEPTION 'weights_invalid' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_weights) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.account_id = p_account_id
        AND p.user_id = (v_item->>'user_id')::UUID
        AND p.account_role = 'agent'
    ) THEN
      RAISE EXCEPTION 'weights_not_agent' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  DELETE FROM assignment_weights WHERE account_id = p_account_id;

  INSERT INTO assignment_weights (account_id, user_id, percent)
  SELECT p_account_id, (e->>'user_id')::UUID, (e->>'percent')::INTEGER
  FROM jsonb_array_elements(p_weights) e;

  -- La cuota se cuenta desde ahora: cambiar la perilla reinicia el
  -- reparto, que es lo que un admin espera al moverla.
  INSERT INTO assignment_settings (account_id, weights_updated_at)
  VALUES (p_account_id, now())
  ON CONFLICT (account_id) DO UPDATE SET weights_updated_at = now();
END;
$$;

ALTER FUNCTION set_assignment_weights(UUID, JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION set_assignment_weights(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_assignment_weights(UUID, JSONB) TO authenticated, service_role;
