-- ============================================================
-- 508_vehicle_economics.sql
--
-- El lado económico del inventario: cuánto costó cada vehículo,
-- en cuánto se vendió, y qué consultas de la vitrina lo originaron.
--
-- Decisiones de diseño (ver openspec/changes/add-vehicle-sales-dashboard):
--   * El COSTO DE ADQUISICIÓN va en tabla propia, NO como columnas de
--     inventory_vehicles. La RLS de esa tabla concede SELECT a
--     is_account_member(account_id) — cualquier miembro, incluido
--     'viewer'. Como la RLS de Postgres filtra FILAS y no COLUMNAS, un
--     vendedor pidiendo select=* recibiría el costo en el JSON.
--     Separarlo permite exigir rol 'admin' de verdad.
--   * El PRECIO DE VENTA sí vive en inventory_vehicles: no es secreto
--     (el comprador lo conoce) y evita un join en la consulta más
--     frecuente del tablero comercial.
--   * public_ref se genera con DEFAULT en la base, no en la aplicación:
--     evita duplicar el alfabeto en SQL y en JS, y elimina la condición
--     de carrera entre generar y persistir.
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

-- ============================================================
-- FUNCIÓN generate_vehicle_public_ref()
--
-- Código corto para identificar un vehículo en el mensaje de WhatsApp
-- que abre la vitrina. Alfabeto de 30 símbolos sin caracteres que se
-- confundan al leerlos en voz alta o teclearlos: sin 0/O, sin 1/I/L,
-- sin U (se confunde con V en mayúsculas).
--
-- 30^6 = 729 millones de combinaciones. Con decenas o cientos de
-- vehículos por cuenta la colisión es despreciable, y si ocurriera el
-- índice único la rechaza en vez de duplicar la referencia.
--
-- No es un secreto: viaja en la vitrina pública y en un mensaje de
-- WhatsApp. Por eso random() basta y no se usa un generador
-- criptográfico. Tampoco deriva de VIN ni placa — es opaco a propósito.
-- ============================================================
CREATE OR REPLACE FUNCTION generate_vehicle_public_ref()
RETURNS TEXT AS $$
DECLARE
  alphabet CONSTANT TEXT := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  result TEXT := '';
  i INTEGER;
BEGIN
  FOR i IN 1..6 LOOP
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::INTEGER, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- ============================================================
-- TABLA vehicle_acquisitions
--
-- Uno-a-uno con el vehículo (UNIQUE en vehicle_id): un auto se compra
-- una vez. Se guarda aparte por la RLS, no por normalización.
-- ============================================================
CREATE TABLE IF NOT EXISTS vehicle_acquisitions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  vehicle_id    UUID NOT NULL UNIQUE REFERENCES inventory_vehicles(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  purchase_cost NUMERIC(12,2) NOT NULL CHECK (purchase_cost >= 0),
  -- Anulable a propósito: se puede conocer el costo sin recordar la
  -- fecha exacta. El tablero cae a created_at del vehículo cuando falta.
  purchase_date DATE
);

CREATE INDEX IF NOT EXISTS idx_vehicle_acquisitions_account
  ON vehicle_acquisitions (account_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_acquisitions_vehicle
  ON vehicle_acquisitions (vehicle_id);

-- ============================================================
-- RLS de vehicle_acquisitions — 'admin' o superior
--
-- Esta es la única defensa real del dato. Un 'agent' que negocia el
-- precio con el cliente no debe poder leer en cuánto se compró el auto.
-- ============================================================
ALTER TABLE vehicle_acquisitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vehicle_acquisitions_select ON vehicle_acquisitions;
CREATE POLICY vehicle_acquisitions_select ON vehicle_acquisitions FOR SELECT
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS vehicle_acquisitions_insert ON vehicle_acquisitions;
CREATE POLICY vehicle_acquisitions_insert ON vehicle_acquisitions FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS vehicle_acquisitions_update ON vehicle_acquisitions;
CREATE POLICY vehicle_acquisitions_update ON vehicle_acquisitions FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS vehicle_acquisitions_delete ON vehicle_acquisitions;
CREATE POLICY vehicle_acquisitions_delete ON vehicle_acquisitions FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON vehicle_acquisitions;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON vehicle_acquisitions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- COLUMNAS DE CIERRE DE VENTA en inventory_vehicles
-- ============================================================
ALTER TABLE inventory_vehicles
  ADD COLUMN IF NOT EXISTS sold_price NUMERIC(12,2) CHECK (sold_price >= 0),
  ADD COLUMN IF NOT EXISTS sold_at TIMESTAMPTZ,
  -- Borrar el contacto no borra la historia de la venta: sólo se pierde
  -- a quién se le vendió.
  ADD COLUMN IF NOT EXISTS sold_to_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS public_ref TEXT;

-- Coherencia: un vehículo que no está vendido no puede arrastrar datos
-- de cierre. Hace cumplir el requisito de reversión a nivel de base, no
-- sólo en la capa de aplicación.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_vehicles_sold_coherence'
  ) THEN
    ALTER TABLE inventory_vehicles
      ADD CONSTRAINT inventory_vehicles_sold_coherence CHECK (
        status = 'sold'
        OR (sold_price IS NULL AND sold_at IS NULL AND sold_to_contact_id IS NULL)
      );
  END IF;
END $$;

-- ============================================================
-- BACKFILL de public_ref
--
-- En tres pasos en vez de ADD COLUMN ... NOT NULL DEFAULT: con un
-- default VOLATILE el comportamiento sobre filas preexistentes es
-- ambiguo entre versiones de Postgres, y aquí necesitamos un valor
-- DISTINTO por fila, no uno compartido.
-- ============================================================
UPDATE inventory_vehicles
  SET public_ref = generate_vehicle_public_ref()
  WHERE public_ref IS NULL;

ALTER TABLE inventory_vehicles
  ALTER COLUMN public_ref SET DEFAULT generate_vehicle_public_ref();

ALTER TABLE inventory_vehicles
  ALTER COLUMN public_ref SET NOT NULL;

-- Unicidad por cuenta, mismo patrón que placa y VIN en la 500.
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_vehicles_public_ref
  ON inventory_vehicles (account_id, public_ref);

-- Consulta del tablero comercial: vendidos por período.
CREATE INDEX IF NOT EXISTS idx_inventory_vehicles_sold_at
  ON inventory_vehicles (account_id, sold_at)
  WHERE sold_at IS NOT NULL;

-- ============================================================
-- TABLA vehicle_inquiries
--
-- Qué vehículo originó qué conversación. Es N:N con fecha propia (un
-- contacto pregunta por varios autos, un auto lo consultan muchos), así
-- que no cabe como columna en conversations.
--
-- No se persiste ningún estado de "convertida": la conversión se deriva
-- cruzando estas filas con los vehículos vendidos.
-- ============================================================
CREATE TABLE IF NOT EXISTS vehicle_inquiries (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  vehicle_id      UUID NOT NULL REFERENCES inventory_vehicles(id) ON DELETE CASCADE,
  contact_id      UUID REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_inquiries_account_vehicle
  ON vehicle_inquiries (account_id, vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_inquiries_created
  ON vehicle_inquiries (account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_vehicle_inquiries_contact
  ON vehicle_inquiries (contact_id);

-- No es dato sensible: mismo patrón que inventory_vehicles.
ALTER TABLE vehicle_inquiries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vehicle_inquiries_select ON vehicle_inquiries;
CREATE POLICY vehicle_inquiries_select ON vehicle_inquiries FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS vehicle_inquiries_insert ON vehicle_inquiries;
CREATE POLICY vehicle_inquiries_insert ON vehicle_inquiries FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS vehicle_inquiries_update ON vehicle_inquiries;
CREATE POLICY vehicle_inquiries_update ON vehicle_inquiries FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS vehicle_inquiries_delete ON vehicle_inquiries;
CREATE POLICY vehicle_inquiries_delete ON vehicle_inquiries FOR DELETE
  USING (is_account_member(account_id, 'agent'));
