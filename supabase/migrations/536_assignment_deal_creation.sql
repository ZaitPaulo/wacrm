-- ============================================================
-- 536_assignment_deal_creation.sql
--
-- Toda asignación a un asesor abre el negocio del contacto (P5).
--
-- Hasta hoy el único que creaba negocios era el traspaso de la IA
-- (`createHandoffDeal`, en TypeScript). Un lead que asignaba un admin a
-- mano, una automatización, un flujo o —desde este lote— el job de
-- conversaciones olvidadas o la herencia entre canales, no dejaba
-- tarjeta en el embudo.
--
-- DOS PIEZAS
--
--   * `ensure_open_deal_for_contact(...)`: crea el negocio SOLO si el
--     CONTACTO no tiene ninguno abierto (uno ganado o perdido antes no
--     lo impide, decisión del Director). Embudo por defecto con el mismo
--     criterio que `pickDefaultPipeline` —el llamado "Ventas" sin
--     distinguir mayúsculas ni espacios, o el más antiguo— y su etapa de
--     menor `position` (en producción, Ventas / Prospecto). Nace
--     asignado al asesor por su `profiles.id`: `deals.assigned_to`
--     apunta a profiles, NO a auth.users; ya hubo un bug por confundirlos.
--
--   * Trigger AFTER sobre `conversations.assigned_agent_id`: cuando el
--     nuevo asesor es `agent`, llama a la función con el título genérico
--     (el nombre del contacto). Las asignaciones a owner/admin NO crean
--     negocio: las administradoras llevan la campaña de propietarios, y
--     un propietario no es un lead de venta.
--
-- EL NEGOCIO RICO DEL TRASPASO NO SE PIERDE
--
-- El traspaso de la IA le pone al negocio un título con nombre y
-- vehículo, y la nota con la calificación. Si el trigger corriera antes
-- con el título genérico, el traspaso encontraría ya un negocio abierto
-- y el título rico se perdería. Se resuelve por TRANSACCIÓN, no por
-- carrera: `ai_handoff_assign` (537) crea primero el negocio rico y
-- DESPUÉS escribe el asesor; cuando este trigger corre, el contacto ya
-- tiene su negocio abierto y no hace nada.
--
-- UNICIDAD POR CONTACTO SIN ÍNDICE ÚNICO
--
-- A propósito no hay índice único por contacto: un cliente puede
-- comprar dos carros, y el alta manual desde la bandeja debe poder abrir
-- un segundo negocio. La regla "uno abierto por contacto" es de la
-- creación AUTOMÁTICA, y la garantiza un candado consultivo por contacto
-- dentro de la transacción: dos asignaciones simultáneas del mismo
-- contacto se serializan y la segunda ve el negocio de la primera. El
-- índice por conversación de la 532 sigue ahí y su 23505 se lee como
-- "ya existe".
--
-- NUNCA ABORTA LA ASIGNACIÓN: el trigger envuelve todo en
-- EXCEPTION WHEN OTHERS → WARNING. Perder una tarjeta es preferible a
-- dejar un cliente sin asesor.
--
-- Idempotente.
-- ============================================================

CREATE OR REPLACE FUNCTION ensure_open_deal_for_contact(
  p_conversation_id UUID,
  p_agent_user_id   UUID,
  p_title           TEXT DEFAULT NULL,
  p_notes           TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv     RECORD;
  v_pipeline UUID;
  v_stage    UUID;
  v_profile  UUID;
  v_currency TEXT;
  v_title    TEXT;
BEGIN
  SELECT c.id, c.account_id, c.contact_id, c.user_id,
         COALESCE(NULLIF(btrim(ct.name), ''), NULLIF(btrim(ct.phone), '')) AS contact_label
    INTO v_conv
  FROM conversations c
  LEFT JOIN contacts ct ON ct.id = c.contact_id
  WHERE c.id = p_conversation_id;

  IF NOT FOUND THEN
    RETURN 'skipped:conversation_not_found';
  END IF;
  IF v_conv.contact_id IS NULL THEN
    RETURN 'skipped:no_contact';
  END IF;

  -- Serializa la creación automática por contacto (ver cabecera).
  PERFORM pg_advisory_xact_lock(hashtextextended('crm.deal.contact:' || v_conv.contact_id::TEXT, 0));

  IF EXISTS (
    SELECT 1 FROM deals d
    WHERE d.account_id = v_conv.account_id
      AND d.contact_id = v_conv.contact_id
      AND d.status = 'open'
  ) THEN
    RETURN 'already_open';
  END IF;

  SELECT p.id INTO v_pipeline
  FROM pipelines p
  WHERE p.account_id = v_conv.account_id
  ORDER BY (lower(btrim(p.name)) = 'ventas') DESC, p.created_at ASC, p.id ASC
  LIMIT 1;
  IF v_pipeline IS NULL THEN
    RETURN 'skipped:no_pipeline';
  END IF;

  SELECT s.id INTO v_stage
  FROM pipeline_stages s
  WHERE s.pipeline_id = v_pipeline
  ORDER BY s.position ASC, s.created_at ASC, s.id ASC
  LIMIT 1;
  IF v_stage IS NULL THEN
    RETURN 'skipped:no_stage';
  END IF;

  IF p_agent_user_id IS NOT NULL THEN
    SELECT pr.id INTO v_profile
    FROM profiles pr
    WHERE pr.account_id = v_conv.account_id AND pr.user_id = p_agent_user_id;
  END IF;

  SELECT a.default_currency INTO v_currency FROM accounts a WHERE a.id = v_conv.account_id;

  v_title := COALESCE(NULLIF(btrim(p_title), ''), v_conv.contact_label, 'Nuevo prospecto');

  BEGIN
    INSERT INTO deals (
      account_id, user_id, pipeline_id, stage_id, contact_id, conversation_id,
      title, value, currency, status, assigned_to, notes
    ) VALUES (
      v_conv.account_id, v_conv.user_id, v_pipeline, v_stage, v_conv.contact_id, v_conv.id,
      v_title, 0, COALESCE(v_currency, 'USD'), 'open', v_profile, NULLIF(p_notes, '')
    );
  EXCEPTION WHEN unique_violation THEN
    -- `idx_deals_one_open_per_conversation` (532): esta conversación ya
    -- tiene su negocio abierto (p. ej. creado a mano con otro contacto).
    RETURN 'already_open';
  END;

  RETURN 'created';
END;
$$;

ALTER FUNCTION ensure_open_deal_for_contact(UUID, UUID, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION ensure_open_deal_for_contact(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ensure_open_deal_for_contact(UUID, UUID, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION ensure_open_deal_for_contact(UUID, UUID, TEXT, TEXT) IS
  'Crea el negocio de un contacto en la primera etapa del embudo por defecto si no tiene ninguno abierto. Devuelve created | already_open | skipped:<motivo>. Serializa por contacto con un candado consultivo.';

-- ------------------------------------------------------------
-- Trigger: negocio en cada asignación a un `agent`
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_deal_on_agent_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.assigned_agent_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN
    RETURN NEW;
  END IF;
  IF NOT is_assignable_agent(NEW.account_id, NEW.assigned_agent_id) THEN
    RETURN NEW;
  END IF;

  PERFORM ensure_open_deal_for_contact(NEW.id, NEW.assigned_agent_id, NULL, NULL);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'No se pudo crear el negocio de la conversación %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION create_deal_on_agent_assignment() OWNER TO postgres;

DROP TRIGGER IF EXISTS create_deal_on_agent_assignment ON conversations;
CREATE TRIGGER create_deal_on_agent_assignment
  AFTER INSERT OR UPDATE OF assigned_agent_id ON conversations
  FOR EACH ROW EXECUTE FUNCTION create_deal_on_agent_assignment();
