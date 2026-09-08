-- ============================================================
-- 520_restrict_inbox_by_assignment.sql
--
-- La bandeja deja de ser común: el asesor solo ve lo suyo.
--
-- Hasta hoy la RLS de los datos operativos preguntaba una sola cosa
-- —`is_account_member(account_id)`, o sea el rol mínimo `viewer`—, así
-- que cualquier miembro de la cuenta leía todas las conversaciones, sus
-- mensajes, todos los contactos y todos los negocios. El rol solo
-- diferenciaba la escritura. Con un asesor en la cuenta eso significa
-- que ve la cartera de sus compañeros.
--
-- La regla nueva:
--   * `owner`, `admin` y `viewer` siguen viendo TODO. `viewer` es un rol
--     de supervisión de solo lectura; recortarlo lo dejaría inservible.
--   * `agent` ve únicamente las conversaciones donde
--     `assigned_agent_id` es él.
--   * Lo no asignado queda invisible para el asesor. Es deliberado: un
--     prospecto sin dueño es responsabilidad del admin, que lo reparte
--     a mano. No hay bandeja de "sin asignar" ni reparto automático.
--   * El contacto se ve si tiene una conversación visible; el negocio
--     se ve si su contacto se ve. Sin eso ocultar el chat no serviría
--     de nada: la ficha del contacto muestra el mismo hilo y la tarjeta
--     del embudo muestra el nombre.
--
-- Decisiones de diseño (ver openspec/changes/restrict-inbox-by-assignment):
--   * DOS FUNCIONES, NO UNA CONDICIÓN REPETIDA. `conversation_visible`
--     y `contact_visible` son calcadas de `is_account_member`
--     (migración 017): `SECURITY DEFINER`, `STABLE`, search_path fijo.
--     Incluyen la pertenencia a la cuenta, así que REEMPLAZAN a
--     `is_account_member` en la política en vez de sumarse — una
--     llamada por fila, no dos.
--   * `SECURITY DEFINER` no es adorno: el `EXISTS` sobre
--     `conversations` dentro de `contact_visible` corre sin RLS, que es
--     lo que evita que la política de `contacts` dispare en cadena la
--     de `conversations`.
--   * `account_role` en NULL da falso, igual que en
--     `is_account_member` (el `CASE` sin rama devuelve NULL). Un perfil
--     sin rol no ve nada: mismo criterio que ya regía.
--   * TAMBIÉN SE CIERRA LA ESCRITURA. Las políticas de UPDATE/DELETE
--     pedían solo `is_account_member(..., 'agent')`: sin esto, un
--     asesor podía modificar por API con su sesión exactamente lo que
--     la bandeja le esconde.
--   * `INSERT` no cambia en ninguna tabla. Crear no es ver.
--   * EL TRIGGER, NO UN PRIVILEGIO DE COLUMNA. Un asesor puede pasarle
--     la conversación a otro miembro pero no dejarla sin asignar. Eso
--     exige saber qué columna cambia Y quién la cambia: la RLS no
--     filtra por columna, y el `REVOKE UPDATE … GRANT UPDATE(col)` que
--     usa `notifications` es por rol de base (`authenticated`), no por
--     `account_role`.
--
-- Lo que esta migración NO toca:
--   * `notifications`: ya está acotada por `auth.uid() = user_id`
--     (migración 027). Cada quien ve sus avisos y nada más.
--   * Los caminos con service-role —webhooks de entrada, motor de
--     automatizaciones, motor de flujos, auto-respuesta de IA y API
--     pública v1— siguen viendo la cuenta completa. La API v1 filtra a
--     mano por `account_id`, así que quien tenga una API key sigue
--     viendo todo: las llaves las crea el admin.
--   * Las tablas de configuración (`tags`, `custom_fields`,
--     `pipelines`, plantillas, difusiones, automatizaciones, flujos):
--     son de cuenta, no de cartera.
--
-- OJO AL DESPLEGAR: esto recorta en vivo a los asesores que ya existen.
-- Al aplicarla (2026-09-07) la cuenta tenía 8 conversaciones, 3 de ellas
-- asignadas, y 3 miembros con rol `agent`: las 5 sin asignar dejaron de
-- verse para ellos en ese momento. Lo que no se reparte, no se ve.
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

-- ============================================================
-- FUNCIONES DE VISIBILIDAD
-- ============================================================

-- ¿Puede quien consulta ver esta conversación?
--
-- Devuelve true si es miembro de la cuenta Y (su rol no es `agent`, o
-- la conversación le está asignada). Sustituye a `is_account_member`
-- en las políticas de `conversations` y `messages`.
CREATE OR REPLACE FUNCTION conversation_visible(
  p_account_id UUID,
  p_assigned_agent_id UUID
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_id = p_account_id
      AND (
        p.account_role <> 'agent'
        OR p_assigned_agent_id = auth.uid()
      )
  );
$$;

ALTER FUNCTION conversation_visible(UUID, UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION conversation_visible(UUID, UUID) TO authenticated, service_role;

COMMENT ON FUNCTION conversation_visible(UUID, UUID) IS
  'True si auth.uid() es miembro de la cuenta y (su rol no es agent, o la conversación le está asignada). Reemplaza a is_account_member en las políticas de conversations y messages.';

-- ¿Puede quien consulta ver este contacto?
--
-- Un `agent` lo ve solo si alguna de sus conversaciones le está
-- asignada. Un contacto sin conversación asignada —porque nunca
-- escribió, o porque su conversación sigue sin repartir— es del admin.
--
-- `p_contact_id` en NULL (un negocio sin contacto) da falso para el
-- asesor por la misma vía: el `EXISTS` no encuentra nada.
CREATE OR REPLACE FUNCTION contact_visible(
  p_account_id UUID,
  p_contact_id UUID
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_id = p_account_id
      AND (
        p.account_role <> 'agent'
        OR EXISTS (
          SELECT 1
          FROM conversations c
          WHERE c.contact_id = p_contact_id
            AND c.assigned_agent_id = auth.uid()
        )
      )
  );
$$;

ALTER FUNCTION contact_visible(UUID, UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION contact_visible(UUID, UUID) TO authenticated, service_role;

COMMENT ON FUNCTION contact_visible(UUID, UUID) IS
  'True si auth.uid() es miembro de la cuenta y (su rol no es agent, o el contacto tiene al menos una conversación asignada a él). Un contacto sin conversación asignada solo lo ven owner/admin/viewer.';

-- ============================================================
-- ÍNDICES
--
-- `contact_visible` corre un EXISTS por cada fila de `contacts` que se
-- evalúe, y la bandeja del asesor pasa a barrer `conversations`
-- filtrando por asignación. Ninguno de los dos accesos tenía índice:
-- `idx_conversations_contact_id` (migración 001) es solo por contacto.
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_conversations_contact_assigned
  ON conversations (contact_id, assigned_agent_id);

CREATE INDEX IF NOT EXISTS idx_conversations_account_assigned
  ON conversations (account_id, assigned_agent_id);

-- ============================================================
-- RLS — CONVERSACIONES Y MENSAJES
-- ============================================================

-- ---- conversations ---------------------------------------------
DROP POLICY IF EXISTS conversations_select ON conversations;
CREATE POLICY conversations_select ON conversations FOR SELECT
  USING (conversation_visible(account_id, assigned_agent_id));

-- INSERT no cambia: sigue bastando el rol `agent` de la cuenta. En la
-- práctica las conversaciones las crea el webhook con service-role.
-- El WITH CHECK explícito es LOAD-BEARING. Sin él, Postgres reusa el
-- USING para validar la fila resultante, y entonces un asesor que le
-- pasa la conversación a un compañero se la estaría dejando invisible
-- a sí mismo *en la misma sentencia*: la comprobación fallaría y la
-- reasignación —que es justo lo que queremos permitir— sería imposible.
-- Quién puede quedarse sin la conversación lo decide el trigger de más
-- abajo, no esta política.
DROP POLICY IF EXISTS conversations_update ON conversations;
CREATE POLICY conversations_update ON conversations FOR UPDATE
  USING (
    is_account_member(account_id, 'agent')
    AND conversation_visible(account_id, assigned_agent_id)
  )
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS conversations_delete ON conversations;
CREATE POLICY conversations_delete ON conversations FOR DELETE
  USING (
    is_account_member(account_id, 'agent')
    AND conversation_visible(account_id, assigned_agent_id)
  );

-- ---- messages --------------------------------------------------
-- Misma forma que traía la migración 017 (EXISTS sobre el padre), solo
-- cambia la función. Las inserciones del webhook van con service-role y
-- saltan la RLS como siempre.
DROP POLICY IF EXISTS messages_select ON messages;
CREATE POLICY messages_select ON messages FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND conversation_visible(c.account_id, c.assigned_agent_id)
  )
);

DROP POLICY IF EXISTS messages_modify ON messages;
CREATE POLICY messages_modify ON messages FOR ALL USING (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND is_account_member(c.account_id, 'agent')
      AND conversation_visible(c.account_id, c.assigned_agent_id)
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND is_account_member(c.account_id, 'agent')
      AND conversation_visible(c.account_id, c.assigned_agent_id)
  )
);

-- ============================================================
-- RLS — CONTACTOS Y LO QUE CUELGA DE ELLOS
-- ============================================================

-- ---- contacts ---------------------------------------------------
DROP POLICY IF EXISTS contacts_select ON contacts;
CREATE POLICY contacts_select ON contacts FOR SELECT
  USING (contact_visible(account_id, id));

-- INSERT no cambia. Nota: un `agent` que inserte un contacto no podrá
-- verlo después (no tiene conversación asignada), por eso la interfaz
-- le esconde el alta y la importación.
DROP POLICY IF EXISTS contacts_update ON contacts;
CREATE POLICY contacts_update ON contacts FOR UPDATE
  USING (
    is_account_member(account_id, 'agent')
    AND contact_visible(account_id, id)
  );

DROP POLICY IF EXISTS contacts_delete ON contacts;
CREATE POLICY contacts_delete ON contacts FOR DELETE
  USING (
    is_account_member(account_id, 'agent')
    AND contact_visible(account_id, id)
  );

-- ---- contact_tags ----------------------------------------------
-- No lleva account_id: se resuelve por el contacto, como en la 017.
DROP POLICY IF EXISTS contact_tags_select ON contact_tags;
CREATE POLICY contact_tags_select ON contact_tags FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM contacts c
    WHERE c.id = contact_tags.contact_id
      AND contact_visible(c.account_id, c.id)
  )
);

DROP POLICY IF EXISTS contact_tags_modify ON contact_tags;
CREATE POLICY contact_tags_modify ON contact_tags FOR ALL USING (
  EXISTS (
    SELECT 1 FROM contacts c
    WHERE c.id = contact_tags.contact_id
      AND is_account_member(c.account_id, 'agent')
      AND contact_visible(c.account_id, c.id)
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM contacts c
    WHERE c.id = contact_tags.contact_id
      AND is_account_member(c.account_id, 'agent')
      AND contact_visible(c.account_id, c.id)
  )
);

-- ---- contact_custom_values -------------------------------------
DROP POLICY IF EXISTS contact_custom_values_select ON contact_custom_values;
CREATE POLICY contact_custom_values_select ON contact_custom_values FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM contacts c
    WHERE c.id = contact_custom_values.contact_id
      AND contact_visible(c.account_id, c.id)
  )
);

DROP POLICY IF EXISTS contact_custom_values_modify ON contact_custom_values;
CREATE POLICY contact_custom_values_modify ON contact_custom_values FOR ALL USING (
  EXISTS (
    SELECT 1 FROM contacts c
    WHERE c.id = contact_custom_values.contact_id
      AND is_account_member(c.account_id, 'agent')
      AND contact_visible(c.account_id, c.id)
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM contacts c
    WHERE c.id = contact_custom_values.contact_id
      AND is_account_member(c.account_id, 'agent')
      AND contact_visible(c.account_id, c.id)
  )
);

-- ---- contact_notes ---------------------------------------------
-- Las notas internas sobre un cliente son lo más sensible de la ficha.
DROP POLICY IF EXISTS contact_notes_select ON contact_notes;
CREATE POLICY contact_notes_select ON contact_notes FOR SELECT
  USING (contact_visible(account_id, contact_id));

DROP POLICY IF EXISTS contact_notes_insert ON contact_notes;
CREATE POLICY contact_notes_insert ON contact_notes FOR INSERT
  WITH CHECK (
    is_account_member(account_id, 'agent')
    AND contact_visible(account_id, contact_id)
  );

DROP POLICY IF EXISTS contact_notes_update ON contact_notes;
CREATE POLICY contact_notes_update ON contact_notes FOR UPDATE
  USING (
    is_account_member(account_id, 'agent')
    AND contact_visible(account_id, contact_id)
  );

DROP POLICY IF EXISTS contact_notes_delete ON contact_notes;
CREATE POLICY contact_notes_delete ON contact_notes FOR DELETE
  USING (
    is_account_member(account_id, 'agent')
    AND contact_visible(account_id, contact_id)
  );

-- ---- documents (migración 502) ---------------------------------
-- OJO: la tabla NO es `contact_documents`. La migración 501 la creó con
-- ese nombre y la 502 la borró para reemplazarla por `documents`, que
-- cuelga de un contacto Y/O de un vehículo.
--
-- Por eso acá la condición no es la misma que en el resto: un documento
-- SIN contacto es papelería del vehículo —la factura, el traspaso, la
-- revisión— y es del negocio, no de la cartera de nadie. Ese sigue
-- visible para cualquier miembro. El que cuelga de un contacto sigue al
-- contacto.
DROP POLICY IF EXISTS documents_select ON documents;
CREATE POLICY documents_select ON documents FOR SELECT
  USING (
    (contact_id IS NULL AND is_account_member(account_id))
    OR contact_visible(account_id, contact_id)
  );

DROP POLICY IF EXISTS documents_insert ON documents;
CREATE POLICY documents_insert ON documents FOR INSERT
  WITH CHECK (
    is_account_member(account_id, 'agent')
    AND (contact_id IS NULL OR contact_visible(account_id, contact_id))
  );

DROP POLICY IF EXISTS documents_update ON documents;
CREATE POLICY documents_update ON documents FOR UPDATE
  USING (
    is_account_member(account_id, 'agent')
    AND (contact_id IS NULL OR contact_visible(account_id, contact_id))
  );

DROP POLICY IF EXISTS documents_delete ON documents;
CREATE POLICY documents_delete ON documents FOR DELETE
  USING (
    is_account_member(account_id, 'agent')
    AND (contact_id IS NULL OR contact_visible(account_id, contact_id))
  );

-- ---- contact_channels (migración 513) --------------------------
-- Las identidades por canal de una persona: teléfono y usuarios de
-- Instagram / Messenger.
DROP POLICY IF EXISTS contact_channels_select ON contact_channels;
CREATE POLICY contact_channels_select ON contact_channels FOR SELECT
  USING (contact_visible(account_id, contact_id));

DROP POLICY IF EXISTS contact_channels_insert ON contact_channels;
CREATE POLICY contact_channels_insert ON contact_channels FOR INSERT
  WITH CHECK (
    is_account_member(account_id, 'agent')
    AND contact_visible(account_id, contact_id)
  );

DROP POLICY IF EXISTS contact_channels_update ON contact_channels;
CREATE POLICY contact_channels_update ON contact_channels FOR UPDATE
  USING (
    is_account_member(account_id, 'agent')
    AND contact_visible(account_id, contact_id)
  );

DROP POLICY IF EXISTS contact_channels_delete ON contact_channels;
CREATE POLICY contact_channels_delete ON contact_channels FOR DELETE
  USING (
    is_account_member(account_id, 'agent')
    AND contact_visible(account_id, contact_id)
  );

-- ---- contact_links (migración 514) -----------------------------
-- La vinculación se cuelga de la ficha que sobrevive: es la que
-- conserva las conversaciones, y por lo tanto la que decide quién ve.
DROP POLICY IF EXISTS contact_links_select ON contact_links;
CREATE POLICY contact_links_select ON contact_links FOR SELECT
  USING (contact_visible(account_id, surviving_contact_id));

DROP POLICY IF EXISTS contact_links_insert ON contact_links;
CREATE POLICY contact_links_insert ON contact_links FOR INSERT
  WITH CHECK (
    is_account_member(account_id, 'agent')
    AND contact_visible(account_id, surviving_contact_id)
  );

DROP POLICY IF EXISTS contact_links_update ON contact_links;
CREATE POLICY contact_links_update ON contact_links FOR UPDATE
  USING (
    is_account_member(account_id, 'agent')
    AND contact_visible(account_id, surviving_contact_id)
  );

DROP POLICY IF EXISTS contact_links_delete ON contact_links;
CREATE POLICY contact_links_delete ON contact_links FOR DELETE
  USING (
    is_account_member(account_id, 'agent')
    AND contact_visible(account_id, surviving_contact_id)
  );

-- ---- flow_runs --------------------------------------------------
-- Solo lectura desde el cliente; el motor corre con service-role.
DROP POLICY IF EXISTS flow_runs_select ON flow_runs;
CREATE POLICY flow_runs_select ON flow_runs FOR SELECT
  USING (contact_visible(account_id, contact_id));

-- ============================================================
-- RLS — NEGOCIOS
--
-- El negocio cuelga del contacto. Un negocio sin contacto queda
-- invisible para el asesor, igual que un contacto sin conversación
-- asignada — y así se evita la tarjeta con el nombre en blanco que
-- saldría si el negocio se viera pero su contacto no (el embudo trae
-- `contact:contacts(*)` embebido).
-- ============================================================
DROP POLICY IF EXISTS deals_select ON deals;
CREATE POLICY deals_select ON deals FOR SELECT
  USING (contact_visible(account_id, contact_id));

DROP POLICY IF EXISTS deals_update ON deals;
CREATE POLICY deals_update ON deals FOR UPDATE
  USING (
    is_account_member(account_id, 'agent')
    AND contact_visible(account_id, contact_id)
  );

DROP POLICY IF EXISTS deals_delete ON deals;
CREATE POLICY deals_delete ON deals FOR DELETE
  USING (
    is_account_member(account_id, 'agent')
    AND contact_visible(account_id, contact_id)
  );

-- ============================================================
-- TRIGGER — EL ASESOR PASA, NO SUELTA
--
-- Un `agent` puede reasignar su conversación a otro miembro (sale de
-- vacaciones, el cliente pide otro asesor), pero no puede dejarla sin
-- asignar: eso la mandaría al limbo que solo ve el admin, y sería la
-- forma fácil de zafarse de un cliente difícil.
--
-- El orden de las guardas es lo que hace que esto no rompa nada:
-- `auth.uid() IS NULL` primero, para que el handoff de la IA y el paso
-- `assign_conversation` de las automatizaciones —service-role, sin
-- usuario detrás— sigan pudiendo asignar y desasignar.
-- ============================================================
CREATE OR REPLACE FUNCTION enforce_agent_keeps_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role account_role_enum;
BEGIN
  -- Service-role (webhooks, motores, IA): pasa sin preguntar.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Solo importa cuando la conversación se está quedando sin asesor.
  IF NEW.assigned_agent_id IS NOT NULL
     OR OLD.assigned_agent_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.account_role INTO v_role
  FROM profiles p
  WHERE p.user_id = auth.uid()
    AND p.account_id = NEW.account_id;

  IF v_role = 'agent' THEN
    RAISE EXCEPTION
      'Un asesor puede pasar la conversación a otro miembro, pero no dejarla sin asignar'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION enforce_agent_keeps_assignment() OWNER TO postgres;

DROP TRIGGER IF EXISTS enforce_agent_keeps_assignment ON conversations;
CREATE TRIGGER enforce_agent_keeps_assignment
  BEFORE UPDATE OF assigned_agent_id ON conversations
  FOR EACH ROW EXECUTE FUNCTION enforce_agent_keeps_assignment();
