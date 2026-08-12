-- ============================================================
-- 511_rename_location_to_plate_city.sql
--
-- `location_city` → `plate_city`.
--
-- La 510 creó esa columna leyendo la cabecera "PLACA" de la lista de
-- precios del cliente, que contiene ciudades, y la interpretó como la
-- sede donde está el vehículo. Es otra cosa: es la ciudad donde el carro
-- está MATRICULADO. Un vehículo parqueado en Barranquilla puede tener
-- placa de Bogotá, y de eso dependen los impuestos y lo que cuesta el
-- traspaso — una de las primeras preguntas de cualquier comprador.
--
-- El nombre viejo no era solo impreciso: invitaba a filtrar "vehículos
-- en Barranquilla" y obtener los matriculados allí, que no son los
-- mismos carros.
--
-- La 510 ya quedó corregida para instalaciones nuevas, así que esta
-- migración solo actúa donde la versión anterior alcanzó a correr.
-- Idempotente en ambos sentidos.
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_vehicles' AND column_name = 'location_city'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'inventory_vehicles' AND column_name = 'plate_city'
    ) THEN
      -- Ambas existen: la 510 corregida creó `plate_city` y la versión
      -- previa había dejado `location_city`. Se conserva el dato viejo
      -- allí donde el nuevo esté vacío, y recién entonces se descarta la
      -- columna: nunca se borra un valor que no se haya copiado.
      UPDATE inventory_vehicles
      SET plate_city = location_city
      WHERE plate_city IS NULL AND location_city IS NOT NULL;

      ALTER TABLE inventory_vehicles DROP COLUMN location_city;
    ELSE
      ALTER TABLE inventory_vehicles RENAME COLUMN location_city TO plate_city;
    END IF;
  END IF;
END $$;

-- El índice de la 510 viajaba con el nombre viejo cuando esa versión
-- alcanzó a correr; RENAME COLUMN lo conserva pero con su nombre
-- anterior. Se rehace con el nombre correcto.
DROP INDEX IF EXISTS idx_inventory_vehicles_city;
CREATE INDEX IF NOT EXISTS idx_inventory_vehicles_plate_city
  ON inventory_vehicles (account_id, plate_city)
  WHERE plate_city IS NOT NULL;

COMMENT ON COLUMN inventory_vehicles.plate_city IS
  'Ciudad de matrícula del vehículo, no su ubicación. En la hoja del cliente venía bajo la cabecera "PLACA".';
