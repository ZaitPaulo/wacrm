-- ============================================================
-- 032_inventory_vehicles.sql
--
-- Inventario de vehículos para el CRM de compraventa. Sustituye a la
-- migración 031 (retirada): una sola tabla canónica de stock.
--
-- Decisiones de diseño (ver conversación):
--   * Scopeada por account_id (multi-tenant de wacrm, introducido en
--     017) — NECESARIO además para la sincronización con el knowledge
--     base (Fase 3), cuyo account_id es NOT NULL.
--   * RLS idéntica al patrón del repo (030/017): lectura para cualquier
--     miembro de la cuenta; escritura para rol 'agent'. Sin políticas
--     'anon' (el proyecto no las usa; el bot RAG lee vía service_role).
--   * license_plate / vin: únicos POR CUENTA e ignorando NULLs
--     (partial unique index), en vez del UNIQUE global del spec, para no
--     filtrar existencia entre cuentas y permitir cargas sin placa/VIN.
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

-- ============================================================
-- ENUM vehicle_status
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vehicle_status') THEN
    CREATE TYPE vehicle_status AS ENUM ('available', 'reserved', 'sold', 'hidden');
  END IF;
END $$;

-- ============================================================
-- TABLA inventory_vehicles
-- ============================================================
CREATE TABLE IF NOT EXISTS inventory_vehicles (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id     UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  brand          TEXT NOT NULL,
  model          TEXT NOT NULL,
  year           INTEGER NOT NULL CHECK (year BETWEEN 1900 AND 2100),
  license_plate  TEXT,
  vin            TEXT,
  price          NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  mileage        INTEGER CHECK (mileage >= 0),
  status         vehicle_status NOT NULL DEFAULT 'available',
  features       JSONB NOT NULL DEFAULT '{}'::jsonb,
  images         TEXT[] NOT NULL DEFAULT '{}',
  internal_notes TEXT,

  -- Enlace al documento del knowledge base (RAG) generado para este
  -- vehículo. Lo gestiona el sync de inventario (service-role). ON DELETE
  -- SET NULL: borrar el doc del KB no debe romper el vehículo.
  kb_document_id UUID REFERENCES ai_knowledge_documents(id) ON DELETE SET NULL
);

-- Índices de consulta
CREATE INDEX IF NOT EXISTS idx_inventory_vehicles_account
  ON inventory_vehicles (account_id);
CREATE INDEX IF NOT EXISTS idx_inventory_vehicles_status
  ON inventory_vehicles (account_id, status);
CREATE INDEX IF NOT EXISTS idx_inventory_vehicles_brand_model
  ON inventory_vehicles (account_id, brand, model);

-- Unicidad por cuenta (ignorando NULLs) — placa y VIN
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_vehicles_plate
  ON inventory_vehicles (account_id, license_plate)
  WHERE license_plate IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_vehicles_vin
  ON inventory_vehicles (account_id, vin)
  WHERE vin IS NOT NULL;

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE inventory_vehicles ENABLE ROW LEVEL SECURITY;

-- Mismo patrón que 030 (ai_knowledge) / 017 (contacts): lectura para
-- cualquier miembro; escritura para rol 'agent' o superior.
DROP POLICY IF EXISTS inventory_vehicles_select ON inventory_vehicles;
CREATE POLICY inventory_vehicles_select ON inventory_vehicles FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS inventory_vehicles_insert ON inventory_vehicles;
CREATE POLICY inventory_vehicles_insert ON inventory_vehicles FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS inventory_vehicles_update ON inventory_vehicles;
CREATE POLICY inventory_vehicles_update ON inventory_vehicles FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS inventory_vehicles_delete ON inventory_vehicles;
CREATE POLICY inventory_vehicles_delete ON inventory_vehicles FOR DELETE
  USING (is_account_member(account_id, 'agent'));

-- ============================================================
-- TRIGGER updated_at (reutiliza update_updated_at_column() de 001)
-- ============================================================
DROP TRIGGER IF EXISTS set_updated_at ON inventory_vehicles;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON inventory_vehicles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
