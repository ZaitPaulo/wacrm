-- ============================================================
-- 553 — Los contactos son del negocio (cambio hoja-de-vida-contacto, D1)
--
-- Desde la 520, un `agent` solo veía los contactos con una conversación
-- asignada a él. Los dueños pidieron lo contrario para la ficha: cuando
-- un cliente vuelve o lo atiende otra persona, el equipo tiene que ver su
-- historia completa. Ver ≠ atender:
--
--   * VER: el contacto y lo que cuelga de él (etiquetas, campos, notas,
--     documentos, canales y vínculos) pasa a `is_account_member`.
--   * ESCRIBIR una nota: cualquier `agent` o superior, sobre cualquier
--     contacto de su cuenta.
--   * Todo lo demás queda como en la 520: `conversation_visible`,
--     `contact_visible`, la RLS de conversaciones, mensajes, negocios y
--     citas, y el UPDATE/DELETE de los contactos y sus tablas hijas. La
--     bandeja, el embudo y la Agenda del asesor no cambian, y no puede
--     editar los datos de un contacto que no atiende.
--
-- Se descartó abrir `contact_visible` para todos: la bandeja, el embudo,
-- los indicadores y la ESCRITURA dependen de esas funciones sin filtrar
-- en la consulta, y se habrían abierto en silencio.
--
-- Además: `get_contact_assignees`, para que la lista de Contactos del
-- asesor pueda mostrar quién atiende cada contacto sin abrirle la tabla
-- de conversaciones.
--
-- Idempotente — seguro de re-ejecutar.
--
-- DOWN (reponer la 520):
--   CREATE OR REPLACE ... no aplica; se recrean las políticas así:
--   DROP POLICY contacts_select ON contacts;
--   CREATE POLICY contacts_select ON contacts FOR SELECT
--     USING (contact_visible(account_id, id));
--   DROP POLICY contact_tags_select ON contact_tags;
--   CREATE POLICY contact_tags_select ON contact_tags FOR SELECT USING (
--     EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_tags.contact_id
--             AND contact_visible(c.account_id, c.id)));
--   DROP POLICY contact_custom_values_select ON contact_custom_values;
--   CREATE POLICY contact_custom_values_select ON contact_custom_values FOR SELECT USING (
--     EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_custom_values.contact_id
--             AND contact_visible(c.account_id, c.id)));
--   DROP POLICY contact_notes_select ON contact_notes;
--   CREATE POLICY contact_notes_select ON contact_notes FOR SELECT
--     USING (contact_visible(account_id, contact_id));
--   DROP POLICY contact_notes_insert ON contact_notes;
--   CREATE POLICY contact_notes_insert ON contact_notes FOR INSERT
--     WITH CHECK (is_account_member(account_id, 'agent')
--                 AND contact_visible(account_id, contact_id));
--   DROP POLICY documents_select ON documents;
--   CREATE POLICY documents_select ON documents FOR SELECT USING (
--     (contact_id IS NULL AND is_account_member(account_id))
--     OR contact_visible(account_id, contact_id));
--   DROP POLICY contact_channels_select ON contact_channels;
--   CREATE POLICY contact_channels_select ON contact_channels FOR SELECT
--     USING (contact_visible(account_id, contact_id));
--   DROP POLICY contact_links_select ON contact_links;
--   CREATE POLICY contact_links_select ON contact_links FOR SELECT
--     USING (contact_visible(account_id, surviving_contact_id));
--   DROP FUNCTION get_contact_assignees(UUID[]);
-- ============================================================

-- ---- contacts ---------------------------------------------------
DROP POLICY IF EXISTS contacts_select ON contacts;
CREATE POLICY contacts_select ON contacts FOR SELECT
  USING (is_account_member(account_id));

-- ---- contact_tags (sin account_id: se resuelve por el contacto) --
DROP POLICY IF EXISTS contact_tags_select ON contact_tags;
CREATE POLICY contact_tags_select ON contact_tags FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM contacts c
    WHERE c.id = contact_tags.contact_id
      AND is_account_member(c.account_id)
  )
);

-- ---- contact_custom_values -------------------------------------
DROP POLICY IF EXISTS contact_custom_values_select ON contact_custom_values;
CREATE POLICY contact_custom_values_select ON contact_custom_values FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM contacts c
    WHERE c.id = contact_custom_values.contact_id
      AND is_account_member(c.account_id)
  )
);

-- ---- contact_notes ---------------------------------------------
DROP POLICY IF EXISTS contact_notes_select ON contact_notes;
CREATE POLICY contact_notes_select ON contact_notes FOR SELECT
  USING (is_account_member(account_id));

-- Cualquier asesor deja una nota sobre cualquier cliente del negocio, a
-- su nombre. El `user_id = auth.uid()` evita firmar por otro.
DROP POLICY IF EXISTS contact_notes_insert ON contact_notes;
CREATE POLICY contact_notes_insert ON contact_notes FOR INSERT
  WITH CHECK (
    is_account_member(account_id, 'agent')
    AND user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM contacts c
      WHERE c.id = contact_notes.contact_id
        AND c.account_id = contact_notes.account_id
    )
  );

-- ---- documents -------------------------------------------------
DROP POLICY IF EXISTS documents_select ON documents;
CREATE POLICY documents_select ON documents FOR SELECT
  USING (is_account_member(account_id));

-- ---- contact_channels ------------------------------------------
DROP POLICY IF EXISTS contact_channels_select ON contact_channels;
CREATE POLICY contact_channels_select ON contact_channels FOR SELECT
  USING (is_account_member(account_id));

-- ---- contact_links ---------------------------------------------
DROP POLICY IF EXISTS contact_links_select ON contact_links;
CREATE POLICY contact_links_select ON contact_links FOR SELECT
  USING (is_account_member(account_id));

-- ============================================================
-- Quién atiende cada contacto, para la lista de Contactos.
--
-- El asesor ya no ve las conversaciones ajenas por tabla, pero sí el
-- contacto; sin esto la columna "Asesor" le saldría vacía justo en los
-- contactos que no atiende. Devuelve solo (contacto, asesor, fecha del
-- último mensaje), nada del contenido, y solo de la cuenta de quien
-- consulta.
-- ============================================================
CREATE OR REPLACE FUNCTION get_contact_assignees(p_contact_ids UUID[])
RETURNS TABLE (
  contact_id UUID,
  assigned_agent_id UUID,
  last_message_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.contact_id, c.assigned_agent_id, c.last_message_at
  FROM conversations c
  WHERE c.contact_id = ANY (p_contact_ids)
    AND is_account_member(c.account_id);
$$;

ALTER FUNCTION get_contact_assignees(UUID[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION get_contact_assignees(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_contact_assignees(UUID[]) TO authenticated, service_role;

COMMENT ON FUNCTION get_contact_assignees(UUID[]) IS
  'Asesor y último mensaje de cada conversación de los contactos dados, solo de la cuenta de quien consulta. Alimenta la columna Asesor de Contactos sin abrir la tabla conversations al rol agent.';
