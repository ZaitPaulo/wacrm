-- ============================================================
-- 504_inventory_vehicle_specs.sql
--
-- Especificaciones estructuradas del vehículo (antes vivían sueltas en
-- el JSONB `features`). Se vuelven columnas para poder mostrarlas
-- siempre y FILTRAR por ellas en la vitrina:
--
--   transmission, fuel_type, body_type — enums (texto con CHECK)
--   color                              — texto libre
--   condition                          — new | used (default 'used')
--   doors                              — entero
--
-- Todas anulables (las filas existentes quedan en NULL / 'used').
-- Idempotente: ADD COLUMN IF NOT EXISTS con el CHECK inline (en re-run
-- la columna ya existe y la cláusula se omite completa).
-- ============================================================

ALTER TABLE inventory_vehicles
  ADD COLUMN IF NOT EXISTS transmission TEXT
    CHECK (transmission IN ('manual', 'automatic', 'cvt', 'other')),
  ADD COLUMN IF NOT EXISTS fuel_type TEXT
    CHECK (fuel_type IN ('gasoline', 'diesel', 'hybrid', 'electric', 'lpg', 'other')),
  ADD COLUMN IF NOT EXISTS body_type TEXT
    CHECK (body_type IN ('sedan', 'suv', 'hatchback', 'pickup', 'coupe', 'van', 'wagon', 'convertible', 'other')),
  ADD COLUMN IF NOT EXISTS color TEXT,
  ADD COLUMN IF NOT EXISTS condition TEXT NOT NULL DEFAULT 'used'
    CHECK (condition IN ('new', 'used')),
  ADD COLUMN IF NOT EXISTS doors INTEGER
    CHECK (doors >= 0);

-- Índices para los filtros más usados de la vitrina.
CREATE INDEX IF NOT EXISTS idx_inventory_vehicles_body_type
  ON inventory_vehicles (account_id, body_type);
CREATE INDEX IF NOT EXISTS idx_inventory_vehicles_fuel_type
  ON inventory_vehicles (account_id, fuel_type);
