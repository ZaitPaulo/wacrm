-- ============================================================
-- 535_sticky_contact_assignment.sql
--
-- El asesor pertenece al CONTACTO y no lo pisa ningún camino automático
-- (P2). Cuatro piezas:
--
--   1. `conversation_assignments` gana `source` y `origin`, para que el
--      historial diga CÓMO se eligió al asesor (continuidad, preferido,
--      porcentajes) y QUIÉN lo pidió (traspaso de la IA, automatización,
--      flujo, job, herencia). El reparto por porcentajes cuenta su cuota
--      leyendo `source = 'weighted'`, así que esto no es decoración: es
--      lo que lo hace auditable.
--
--   2. Funciones de vigencia y continuidad, compartidas por el trigger
--      de herencia y por la asignación automática (537) para que no
--      haya dos definiciones de "el asesor de este contacto".
--
--   3. HERENCIA: una conversación nueva de un contacto que ya tiene
--      asesor nace con ese asesor. Trigger BEFORE INSERT y no código,
--      porque hay más de seis caminos que crean conversaciones
--      (inbound, resolve-conversation, send, meta-send de automatizaciones
--      y de flujos, identity-links…) y el que se agregue mañana nacería
--      olvidado. Mismo argumento que la 531.
--
--   4. GUARDA: una escritura sin sesión (service-role o psql) no puede
--      cambiar a un asesor vigente. Conserva el anterior y avisa con un
--      WARNING, sin abortar la sentencia.
--
-- CÓMO VIAJA EL ORIGEN HASTA EL TRIGGER DE HISTORIAL
--
-- Por dos ajustes locales de transacción, `crm.assignment_source` y
-- `crm.assignment_origin`, que fija quien asigna justo antes de su
-- UPDATE/INSERT. El trigger de historial los copia a la fila y los
-- LIMPIA, para que no se le peguen a la siguiente asignación de la misma
-- transacción. Un cambio que no pasó por el motor automático (la sesión
-- de un admin, SQL) queda con los dos en NULL.
--
-- Idempotente.
-- ============================================================

-- ============================================================
-- 1. Origen en el historial
-- ============================================================
ALTER TABLE conversation_assignments
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS origin TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversation_assignments_source_check'
  ) THEN
    ALTER TABLE conversation_assignments
      ADD CONSTRAINT conversation_assignments_source_check
      CHECK (source IS NULL OR source IN ('continuity', 'preferred', 'weighted'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversation_assignments_origin_check'
  ) THEN
    ALTER TABLE conversation_assignments
      ADD CONSTRAINT conversation_assignments_origin_check
      CHECK (origin IS NULL OR origin IN ('ai_handoff', 'automation', 'flow', 'stale_job', 'inheritance'));
  END IF;
END $$;

COMMENT ON COLUMN conversation_assignments.source IS
  'Cómo eligió al asesor el motor automático: continuity (el asesor del contacto), preferred (el que pidió la automatización o el flujo), weighted (reparto por porcentajes; es lo que cuenta la cuota). NULL = el cambio no pasó por el motor (sesión de un admin, SQL a mano).';

COMMENT ON COLUMN conversation_assignments.origin IS
  'Qué camino pidió la asignación automática: ai_handoff, automation, flow, stale_job, inheritance. NULL = no fue automática.';

-- La cuota del reparto: asignaciones por porcentaje de una cuenta desde
-- el último cambio de porcentajes.
CREATE INDEX IF NOT EXISTS idx_conversation_assignments_weighted
  ON conversation_assignments (account_id, changed_at)
  WHERE source = 'weighted';

-- El trigger de la 531, ampliado para copiar el origen. Mismo contrato:
-- AFTER, y nunca aborta la asignación.
CREATE OR REPLACE FUNCTION record_conversation_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from   UUID;
  v_source TEXT := NULLIF(current_setting('crm.assignment_source', true), '');
  v_origin TEXT := NULLIF(current_setting('crm.assignment_origin', true), '');
BEGIN
  -- Se limpian SIEMPRE, se registre o no: el origen describe esta
  -- sentencia y no la siguiente.
  PERFORM set_config('crm.assignment_source', '', true);
  PERFORM set_config('crm.assignment_origin', '', true);

  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_agent_id IS NULL THEN
      RETURN NEW;
    END IF;
    v_from := NULL;
  ELSE
    IF NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN
      RETURN NEW;
    END IF;
    v_from := OLD.assigned_agent_id;
  END IF;

  INSERT INTO conversation_assignments (
    account_id, conversation_id, from_agent_id, to_agent_id, changed_by, source, origin
  ) VALUES (
    NEW.account_id, NEW.id, v_from, NEW.assigned_agent_id, auth.uid(),
    -- Un origen solo describe una asignación A alguien: una devolución
    -- a NULL nunca es "por porcentajes".
    CASE WHEN NEW.assigned_agent_id IS NULL THEN NULL ELSE v_source END,
    CASE WHEN NEW.assigned_agent_id IS NULL THEN NULL ELSE v_origin END
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'No se pudo registrar el cambio de asignación de la conversación %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION record_conversation_assignment() OWNER TO postgres;

-- ============================================================
-- 2. Vigencia y continuidad
-- ============================================================

-- ¿Sigue siendo alguien de la cuenta que puede tener clientes? Es la
-- vara para CONSERVAR un asesor: owner, admin o agent. Incluye a los
-- admin a propósito: Angélica (admin) lleva la campaña de propietarios
-- y ningún proceso automático debe quitarle esas conversaciones.
CREATE OR REPLACE FUNCTION is_active_member(p_account_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.account_id = p_account_id
      AND p.user_id = p_user_id
      AND p.account_role IN ('owner', 'admin', 'agent')
  );
$$;

-- ¿Se le pueden DAR clientes automáticamente? Solo a los `agent`: es la
-- regla de pick-agent desde el 2026-09-07 (el reparto le mandó un
-- cliente a un admin y fue un error).
CREATE OR REPLACE FUNCTION is_assignable_agent(p_account_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.account_id = p_account_id
      AND p.user_id = p_user_id
      AND p.account_role = 'agent'
  );
$$;

-- El asesor de continuidad de un CONTACTO: el último asesor nombrado en
-- el historial de CUALQUIERA de sus conversaciones (un hilo por canal),
-- si sigue siendo `agent`. Si el último ya no lo es, no hay continuidad:
-- no se busca a uno anterior, igual que hacía pick-agent.
--
-- Se ignoran las filas con `to_agent_id` NULL: antes de este cambio
-- "Reactivar IA" dejaba la conversación en NULL, y esas devoluciones al
-- bot no deben borrar quién atendía al cliente.
CREATE OR REPLACE FUNCTION contact_continuity_agent(p_account_id UUID, p_contact_id UUID)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agent UUID;
BEGIN
  IF p_contact_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT ca.to_agent_id INTO v_agent
  FROM conversation_assignments ca
  JOIN conversations c ON c.id = ca.conversation_id
  WHERE c.account_id = p_account_id
    AND c.contact_id = p_contact_id
    AND ca.to_agent_id IS NOT NULL
  ORDER BY ca.changed_at DESC, ca.id DESC
  LIMIT 1;

  IF v_agent IS NOT NULL AND is_assignable_agent(p_account_id, v_agent) THEN
    RETURN v_agent;
  END IF;
  RETURN NULL;
END;
$$;

ALTER FUNCTION is_active_member(UUID, UUID) OWNER TO postgres;
ALTER FUNCTION is_assignable_agent(UUID, UUID) OWNER TO postgres;
ALTER FUNCTION contact_continuity_agent(UUID, UUID) OWNER TO postgres;

-- Internas: las usan triggers y RPCs SECURITY DEFINER. Nadie desde el
-- cliente tiene por qué preguntar por la cartera de otro.
REVOKE ALL ON FUNCTION is_active_member(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION is_assignable_agent(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION contact_continuity_agent(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION is_active_member(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION is_assignable_agent(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION contact_continuity_agent(UUID, UUID) TO service_role;

-- ============================================================
-- 3. Herencia al crear la conversación
--
-- No pausa la IA: el cliente que escribe por un canal nuevo lo atiende
-- primero el bot y, cuando traspasa, la asignación automática conserva
-- al asesor heredado. Nunca lanza: una conversación que no se crea es un
-- mensaje perdido.
-- ============================================================
CREATE OR REPLACE FUNCTION inherit_contact_agent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agent UUID;
BEGIN
  IF NEW.assigned_agent_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_agent := contact_continuity_agent(NEW.account_id, NEW.contact_id);
  IF v_agent IS NOT NULL THEN
    NEW.assigned_agent_id := v_agent;
    PERFORM set_config('crm.assignment_source', 'continuity', true);
    PERFORM set_config('crm.assignment_origin', 'inheritance', true);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'No se pudo heredar el asesor del contacto %: %', NEW.contact_id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION inherit_contact_agent() OWNER TO postgres;

DROP TRIGGER IF EXISTS inherit_contact_agent ON conversations;
CREATE TRIGGER inherit_contact_agent
  BEFORE INSERT ON conversations
  FOR EACH ROW EXECUTE FUNCTION inherit_contact_agent();

-- ============================================================
-- 4. Guarda: ningún camino sin sesión pisa a un asesor vigente
--
-- Con sesión (`auth.uid()` no nulo) no se mira nada acá: ahí mandan la
-- RLS, el trigger de la 520 y el endpoint de reasignación, que solo deja
-- a owner/admin. Sin sesión —service-role de la IA, automatizaciones,
-- flujos, el job, psql— un asesor vigente se CONSERVA.
--
-- No lanza a propósito: el nodo de derivación de un flujo escribe
-- `status = 'pending'` y el asesor en la misma sentencia, y lo primero
-- tiene que pasar aunque lo segundo no. El WARNING queda en el log.
--
-- Escape para correcciones deliberadas de un operador:
--   BEGIN; SET LOCAL crm.assignment_override = 'on'; UPDATE ...; COMMIT;
-- ============================================================
CREATE OR REPLACE FUNCTION protect_sticky_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.assigned_agent_id IS NULL
     OR NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN
    RETURN NEW;
  END IF;
  IF COALESCE(current_setting('crm.assignment_override', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF NOT is_active_member(OLD.account_id, OLD.assigned_agent_id) THEN
    RETURN NEW;
  END IF;

  RAISE WARNING
    'Asignación automática ignorada: la conversación % conserva a su asesor vigente % (se pidió %)',
    OLD.id, OLD.assigned_agent_id, NEW.assigned_agent_id;
  NEW.assigned_agent_id := OLD.assigned_agent_id;
  -- El origen que traía esta sentencia ya no describe nada.
  PERFORM set_config('crm.assignment_source', '', true);
  PERFORM set_config('crm.assignment_origin', '', true);
  RETURN NEW;
END;
$$;

ALTER FUNCTION protect_sticky_assignment() OWNER TO postgres;

DROP TRIGGER IF EXISTS protect_sticky_assignment ON conversations;
CREATE TRIGGER protect_sticky_assignment
  BEFORE UPDATE OF assigned_agent_id ON conversations
  FOR EACH ROW EXECUTE FUNCTION protect_sticky_assignment();
