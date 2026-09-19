-- ============================================================
-- 529_deal_vehicle.sql
--
-- Vehículo del negocio.
--
-- En la compraventa casi todo negocio es "este cliente por este carro".
-- `deals.vehicle_id` guarda de qué vehículo del inventario se trata. Es
-- opcional: un negocio sin vehículo se comporta igual que antes, y las
-- automatizaciones (`create_deal`) siguen creando negocios sin vehículo.
--
-- Por qué FK compuesta `(account_id, vehicle_id)`:
--   Garantiza en la base que el vehículo sea de la misma cuenta que el
--   negocio, sin trigger (mismo patrón que la 528). Para eso hace falta un
--   `unique (account_id, id)` nuevo en `inventory_vehicles`; `id` ya es
--   único, este par existe solo para que la FK pueda apuntarle.
--
-- Por qué `ON DELETE SET NULL (vehicle_id)`:
--   Borrar el vehículo deja el negocio vivo y sin vehículo. La lista de
--   columnas (PostgreSQL 15+) es obligatoria aquí: un `SET NULL` a secas
--   anularía también `deals.account_id`, que es NOT NULL, y el borrado del
--   vehículo fallaría. Local: PostgreSQL 17.6. El VPS hay que verificarlo
--   con `select version()` antes de aplicar; si fuera < 15, cambiar por FK
--   simple a `inventory_vehicles(id) ON DELETE SET NULL` más un trigger
--   BEFORE INSERT OR UPDATE que compruebe la cuenta.
--
-- Nombre del embed para PostgREST: `inventory_vehicles!deals_vehicle_fkey`.
--
-- RLS: no cambia. `deals` ya filtra por cuenta y contacto visible, y la
-- comprobación de la FK la hace el sistema sin pasar por la RLS de
-- `inventory_vehicles`. `authenticated` ya tiene SELECT en
-- `inventory_vehicles` y `vehicle_inquiries` (el selector y la bandeja los
-- leen) y no hay tabla nueva, así que no hacen falta GRANTs.
--
-- Rollback:
--   `ALTER TABLE deals DROP COLUMN vehicle_id;` (arrastra la FK y el índice) y
--   `ALTER TABLE inventory_vehicles DROP CONSTRAINT inventory_vehicles_account_id_id_key;`
-- ============================================================

-- ---- unique (account_id, id) en inventory_vehicles --------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inventory_vehicles_account_id_id_key'
      AND conrelid = 'public.inventory_vehicles'::regclass
  ) THEN
    ALTER TABLE inventory_vehicles
      ADD CONSTRAINT inventory_vehicles_account_id_id_key UNIQUE (account_id, id);
  END IF;
END $$;

-- ---- columna ----------------------------------------------------------
ALTER TABLE deals ADD COLUMN IF NOT EXISTS vehicle_id UUID;

-- ---- FK compuesta -----------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deals_vehicle_fkey'
      AND conrelid = 'public.deals'::regclass
  ) THEN
    ALTER TABLE deals
      ADD CONSTRAINT deals_vehicle_fkey
      FOREIGN KEY (account_id, vehicle_id)
      REFERENCES inventory_vehicles(account_id, id)
      ON DELETE SET NULL (vehicle_id);
  END IF;
END $$;

-- Parcial: la mayoría de negocios no tendrá vehículo. Sirve al borrar un
-- vehículo (la FK busca sus negocios) y para listar negocios por vehículo.
CREATE INDEX IF NOT EXISTS idx_deals_vehicle
  ON deals(vehicle_id)
  WHERE vehicle_id IS NOT NULL;

COMMENT ON COLUMN deals.vehicle_id IS
  'Vehículo del inventario de este negocio (opcional, misma cuenta). Si se borra el vehículo queda en NULL.';

-- PostgREST necesita conocer la columna y la FK nuevas para el embed.
NOTIFY pgrst, 'reload schema';
