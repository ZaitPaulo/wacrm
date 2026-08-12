-- ============================================================
-- 510_inventory_lora_fields.sql
--
-- Alinea `inventory_vehicles` con la lista de precios que el cliente
-- lleva hoy en Excel ("FORMATO DE LISTA DE PRECIO LORA MOTORS").
--
-- Ocho columnas que su hoja tiene y nosotros no. Todas anulables o con
-- default, así que las 15 filas existentes siguen válidas sin tocarlas.
--
-- Dos trampas de nomenclatura de la hoja original, anotadas aquí porque
-- quien escriba el importador se va a topar con ellas:
--
--   * Su columna "MODELO" es el AÑO (convención colombiana). La línea
--     del vehículo va en "VEHICULO" → nuestro `model`.
--   * Su columna "PLACA" contiene ciudades (BARRANQUILLA, BOGOTA): es la
--     ciudad donde el vehículo está MATRICULADO, no dónde está parqueado.
--     Importa para impuestos y para el costo del traspaso. La placa en sí
--     está en "Nº DE PLACA" → nuestro `license_plate`.
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

-- Cilindraje. TEXTO y no numérico a propósito: hoy la hoja trae "1.5",
-- pero "2.0 TDI" o "1.6 Turbo" son igual de comunes y un NUMERIC los
-- rechazaría.
ALTER TABLE inventory_vehicles
  ADD COLUMN IF NOT EXISTS engine_displacement TEXT;

-- Ciudad de matrícula. NO es dónde está el carro: un vehículo parqueado
-- en Barranquilla puede estar matriculado en Bogotá, y de eso dependen
-- los impuestos y lo que cuesta el traspaso. Es de las primeras cosas
-- que pregunta un comprador.
ALTER TABLE inventory_vehicles
  ADD COLUMN IF NOT EXISTS plate_city TEXT;

-- Precio con garantía incluida. Interno por ahora: la vitrina sigue
-- publicando un solo precio, y el asesor decide cuándo ofrecerla.
-- Publicarlo después es un cambio de una línea en la vitrina; retirarlo
-- cuando los clientes ya lo vieron, no.
ALTER TABLE inventory_vehicles
  ADD COLUMN IF NOT EXISTS warranty_price NUMERIC(12,2)
  CHECK (warranty_price IS NULL OR warranty_price >= 0);

-- Vencimientos de documentos. DATE y no TIMESTAMPTZ: son fechas de
-- calendario, sin hora ni zona, y compararlas con NOW() en otra zona
-- daría un día de diferencia.
ALTER TABLE inventory_vehicles
  ADD COLUMN IF NOT EXISTS soat_expires_at DATE;
ALTER TABLE inventory_vehicles
  ADD COLUMN IF NOT EXISTS tecnomecanica_expires_at DATE;

-- Prenda: el vehículo tiene un gravamen a favor de un tercero. En la
-- hoja son 'SI' / 'NA'.
ALTER TABLE inventory_vehicles
  ADD COLUMN IF NOT EXISTS has_lien BOOLEAN NOT NULL DEFAULT false;

-- "Se encuentra en vitrina" = la vitrina FÍSICA (el local), confirmado
-- con el cliente. No tiene relación con la vitrina web, que se resuelve
-- con `status` y `accounts.showcase_enabled`. Se llama `on_display`
-- justamente para que nadie los confunda al leer el esquema.
ALTER TABLE inventory_vehicles
  ADD COLUMN IF NOT EXISTS on_display BOOLEAN NOT NULL DEFAULT false;

-- Si en esta unidad se acepta recibir otro vehículo en parte de pago.
-- Default `true`: es lo habitual en el negocio, y marcar la excepción
-- cuesta menos que marcar la norma.
ALTER TABLE inventory_vehicles
  ADD COLUMN IF NOT EXISTS accepts_trade_in BOOLEAN NOT NULL DEFAULT true;

-- Los tableros y la vitrina filtran por ciudad; el resto son campos de
-- ficha que no se consultan en conjunto y no justifican un índice.
CREATE INDEX IF NOT EXISTS idx_inventory_vehicles_plate_city
  ON inventory_vehicles (account_id, plate_city)
  WHERE plate_city IS NOT NULL;

COMMENT ON COLUMN inventory_vehicles.engine_displacement IS
  'Cilindraje tal como lo escribe el operador ("1.5", "2.0 TDI").';
COMMENT ON COLUMN inventory_vehicles.plate_city IS
  'Ciudad de matrícula del vehículo, no su ubicación. En la hoja del cliente venía bajo la cabecera "PLACA".';
COMMENT ON COLUMN inventory_vehicles.warranty_price IS
  'Precio con garantía incluida. Interno: la vitrina no lo publica.';
COMMENT ON COLUMN inventory_vehicles.on_display IS
  'Exhibido en la vitrina FÍSICA del local. No controla la vitrina web.';
