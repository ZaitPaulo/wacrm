-- ============================================================
-- 554 — Lo que la hoja de vida necesita y hoy no queda guardado
-- (cambio hoja-de-vida-contacto, D5, D6 y D7)
--
--   1. `deal_stage_events`: historial de etapas y estados de cada
--      negocio. `pipeline_stage_transitions` (528) son las REGLAS de qué
--      etapa puede seguir a cuál, no un historial. Lo llena un trigger de
--      aquí en adelante; los cambios anteriores no se pueden recuperar.
--   2. `contact_interactions`: llamadas, visitas sin cita y otras
--      interacciones que el equipo registra a mano.
--   3. `inventory_vehicles.seller_contact_id` y `acquisition_kind`: a
--      quién se le compró (o de quién se recibió en retoma) un vehículo.
--      Va en el vehículo y no en `vehicle_acquisitions` porque esa tabla
--      es solo de admin: lo reservado es el costo, no la contraparte.
--   4. Índices por contacto en las fuentes de la hoja de vida.
--
-- Las funciones que arman la hoja de vida van en la 555.
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

-- ============================================================
-- 1. HISTORIAL DE ETAPAS DE LOS NEGOCIOS
-- ============================================================
CREATE TABLE IF NOT EXISTS deal_stage_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id       UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  -- Copia del contacto del negocio en ese momento: la hoja de vida busca
  -- por contacto sin unir contra `deals`.
  contact_id    UUID REFERENCES contacts(id) ON DELETE CASCADE,
  -- NULL en la fila del alta: el negocio no venía de ninguna etapa.
  from_stage_id UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  to_stage_id   UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  from_status   TEXT,
  to_status     TEXT,
  -- `auth.uid()` de quien lo movió. NULL = service-role: automatizaciones,
  -- flujos, el bot o la API v1.
  actor_user_id UUID,
  -- clock_timestamp: dos cambios en la misma transacción quedan en orden.
  created_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_deal_stage_events_contact
  ON deal_stage_events (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deal_stage_events_deal
  ON deal_stage_events (deal_id, created_at DESC);

REVOKE ALL ON deal_stage_events FROM anon, authenticated;
GRANT SELECT ON deal_stage_events TO authenticated;
GRANT ALL ON deal_stage_events TO service_role;

ALTER TABLE deal_stage_events ENABLE ROW LEVEL SECURITY;

-- Igual que `deals_select`: el asesor ve por tabla el historial de los
-- negocios que ve en su embudo. La hoja de vida lo lee por la función de
-- la 555, que sí muestra los de todos. Sin políticas de escritura: solo
-- escribe el trigger.
DROP POLICY IF EXISTS deal_stage_events_select ON deal_stage_events;
CREATE POLICY deal_stage_events_select ON deal_stage_events FOR SELECT
  USING (contact_visible(account_id, contact_id));

CREATE OR REPLACE FUNCTION deals_log_stage_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id
     AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;

  INSERT INTO deal_stage_events (
    account_id, deal_id, contact_id,
    from_stage_id, to_stage_id, from_status, to_status, actor_user_id
  ) VALUES (
    NEW.account_id, NEW.id, NEW.contact_id,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.stage_id END, NEW.stage_id,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status,
    auth.uid()
  );
  RETURN NULL;
END;
$$;

ALTER FUNCTION deals_log_stage_event() OWNER TO postgres;

DROP TRIGGER IF EXISTS deals_log_stage_event ON deals;
CREATE TRIGGER deals_log_stage_event
  AFTER INSERT OR UPDATE OF stage_id, status ON deals
  FOR EACH ROW EXECUTE FUNCTION deals_log_stage_event();

COMMENT ON TABLE deal_stage_events IS
  'Historial de etapas y estados de cada negocio, desde la 554. Lo llena el trigger deals_log_stage_event; actor NULL = service-role.';

-- ============================================================
-- 2. INTERACCIONES REGISTRADAS A MANO
-- ============================================================
CREATE TABLE IF NOT EXISTS contact_interactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id       UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  -- Quién la registró. Sin FK, igual que `assigned_agent_id`: si el
  -- asesor se va, la interacción se conserva.
  user_id          UUID NOT NULL DEFAULT auth.uid(),
  kind             TEXT NOT NULL
    CHECK (kind IN ('call_outbound', 'call_inbound', 'walk_in', 'other')),
  -- Solo aplica a llamadas.
  outcome          TEXT
    CHECK (outcome IN ('answered', 'no_answer', 'voicemail', 'wrong_number')),
  duration_seconds INTEGER CHECK (duration_seconds >= 0),
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT contact_interactions_outcome_only_calls
    CHECK (outcome IS NULL OR kind IN ('call_outbound', 'call_inbound')),
  -- Un minuto de holgura por relojes desfasados. Las visitas futuras se
  -- agendan en la Agenda, no aquí.
  CONSTRAINT contact_interactions_not_future
    CHECK (occurred_at <= created_at + INTERVAL '1 minute')
);

CREATE INDEX IF NOT EXISTS idx_contact_interactions_contact
  ON contact_interactions (contact_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_interactions_account
  ON contact_interactions (account_id, occurred_at DESC);

DROP TRIGGER IF EXISTS set_updated_at ON contact_interactions;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON contact_interactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- El CHECK de fecha compara con `created_at`; al editar también hay que
-- impedir mover la interacción al futuro.
CREATE OR REPLACE FUNCTION contact_interactions_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.occurred_at > NOW() + INTERVAL '1 minute' THEN
    RAISE EXCEPTION 'occurred_at no puede ser futura' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM contacts c
    WHERE c.id = NEW.contact_id AND c.account_id = NEW.account_id
  ) THEN
    RAISE EXCEPTION 'el contacto no es de la cuenta' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- El autor, la cuenta y el contacto no se cambian al corregir.
    NEW.user_id := OLD.user_id;
    NEW.account_id := OLD.account_id;
    NEW.contact_id := OLD.contact_id;
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contact_interactions_guard ON contact_interactions;
CREATE TRIGGER contact_interactions_guard
  BEFORE INSERT OR UPDATE ON contact_interactions
  FOR EACH ROW EXECUTE FUNCTION contact_interactions_guard();

REVOKE ALL ON contact_interactions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON contact_interactions TO authenticated;
GRANT ALL ON contact_interactions TO service_role;

ALTER TABLE contact_interactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_interactions_select ON contact_interactions;
CREATE POLICY contact_interactions_select ON contact_interactions FOR SELECT
  USING (is_account_member(account_id));

-- Cualquier asesor registra sobre cualquier contacto de su cuenta, a su
-- nombre. El viewer no escribe.
DROP POLICY IF EXISTS contact_interactions_insert ON contact_interactions;
CREATE POLICY contact_interactions_insert ON contact_interactions FOR INSERT
  WITH CHECK (
    is_account_member(account_id, 'agent')
    AND user_id = auth.uid()
  );

-- Corrige o borra el autor (si sigue siendo agent+) o un admin.
DROP POLICY IF EXISTS contact_interactions_update ON contact_interactions;
CREATE POLICY contact_interactions_update ON contact_interactions FOR UPDATE
  USING (
    (user_id = auth.uid() AND is_account_member(account_id, 'agent'))
    OR is_account_member(account_id, 'admin')
  );

DROP POLICY IF EXISTS contact_interactions_delete ON contact_interactions;
CREATE POLICY contact_interactions_delete ON contact_interactions FOR DELETE
  USING (
    (user_id = auth.uid() AND is_account_member(account_id, 'agent'))
    OR is_account_member(account_id, 'admin')
  );

COMMENT ON TABLE contact_interactions IS
  'Interacciones registradas a mano (llamadas, visitas sin cita, otras). Lectura para todo miembro; alta para agent+ a su nombre; edición y borrado para el autor o admin.';

-- ============================================================
-- 3. VENDEDOR Y TIPO DE ADQUISICIÓN DEL VEHÍCULO
-- ============================================================
ALTER TABLE inventory_vehicles
  ADD COLUMN IF NOT EXISTS seller_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS acquisition_kind TEXT;

ALTER TABLE inventory_vehicles DROP CONSTRAINT IF EXISTS inventory_vehicles_acquisition_kind_check;
ALTER TABLE inventory_vehicles ADD CONSTRAINT inventory_vehicles_acquisition_kind_check
  CHECK (acquisition_kind IS NULL OR acquisition_kind IN ('purchase', 'trade_in'));

COMMENT ON COLUMN inventory_vehicles.seller_contact_id IS
  'Contacto a quien se le compró el vehículo o de quien se recibió en retoma. Distinto del propietario (consignación) y del comprador. El costo sigue en vehicle_acquisitions, solo admin.';
COMMENT ON COLUMN inventory_vehicles.acquisition_kind IS
  'purchase (compra) o trade_in (retoma). NULL = sin registrar.';

CREATE INDEX IF NOT EXISTS idx_inventory_vehicles_seller
  ON inventory_vehicles (account_id, seller_contact_id)
  WHERE seller_contact_id IS NOT NULL;

-- El vendedor tiene que ser de la misma cuenta. La FK no lo garantiza y
-- la ruta de API lo valida, pero la base es la que no se salta nadie.
CREATE OR REPLACE FUNCTION inventory_vehicles_seller_same_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.seller_contact_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.seller_contact_id IS DISTINCT FROM OLD.seller_contact_id)
     AND NOT EXISTS (
       SELECT 1 FROM contacts c
       WHERE c.id = NEW.seller_contact_id AND c.account_id = NEW.account_id
     ) THEN
    RAISE EXCEPTION 'el vendedor no es un contacto de la cuenta' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION inventory_vehicles_seller_same_account() OWNER TO postgres;

DROP TRIGGER IF EXISTS inventory_vehicles_seller_same_account ON inventory_vehicles;
CREATE TRIGGER inventory_vehicles_seller_same_account
  BEFORE INSERT OR UPDATE OF seller_contact_id ON inventory_vehicles
  FOR EACH ROW EXECUTE FUNCTION inventory_vehicles_seller_same_account();

-- ============================================================
-- 4. ÍNDICES POR CONTACTO EN LAS FUENTES DE LA HOJA DE VIDA
--
-- Ya existían: conversations(contact_id), messages(conversation_id,
-- created_at), conversation_assignments(conversation_id), appointments
-- (contact_id), appointment_events(appointment_id), deals(contact_id),
-- vehicle_inquiries(contact_id), documents(contact_id) e
-- inventory_vehicles(account_id, owner_contact_id).
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_contact_notes_contact_created
  ON contact_notes (contact_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_vehicles_sold_to
  ON inventory_vehicles (sold_to_contact_id)
  WHERE sold_to_contact_id IS NOT NULL;
