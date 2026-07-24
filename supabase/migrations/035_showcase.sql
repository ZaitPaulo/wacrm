-- ============================================================
-- 035_showcase.sql
--
-- Vitrina pública: la raíz del dominio (/) muestra el inventario
-- 'available' de UNA concesionaria. Se parametriza desde el CRM:
--
--   * accounts.showcase_enabled — marca la cuenta cuyos vehículos se
--     publican en la vitrina. Índice único parcial: solo UNA cuenta
--     puede ser la vitrina pública a la vez.
--   * accounts.public_whatsapp — número (formato internacional, solo
--     dígitos) al que apunta el botón "Comenzar compra" (wa.me).
--
-- La vitrina lee por service-role en el servidor, así que NO se abre
-- acceso anónimo a las tablas (RLS intacta).
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS showcase_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS public_whatsapp  TEXT;

-- Solo una cuenta puede ser la vitrina pública (raíz del dominio).
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_one_showcase
  ON accounts (showcase_enabled)
  WHERE showcase_enabled;
