-- ============================================================
-- 518_showcase_brand_color.sql
--
-- Color de marca para la vitrina pública.
--
-- Agrega la columna `public_brand_color` en `accounts`, configurable
-- desde el CRM en Ajustes → Public showcase.
--
-- Decisiones de diseño:
--   * NULLABLE a propósito: una cuenta que no haya configurado un color
--     de marca no tiene por qué tener un valor forzado en base de datos.
--   * TOLERANTE Y SEGURO: el código de la vitrina valida el formato
--     hexadecimal (/^#[0-9a-fA-F]{6}$/) mediante `resolveBrandColor()` y
--     resuelve a una constante de respaldo cuando el valor está ausente
--     o es inválido. Esto permite desplegar el código antes o después de
--     esta migración sin romper la vitrina ni bloquear la lectura.
--   * Sin reescritura de tabla: ADD COLUMN IF NOT EXISTS nullable es una
--     operación puramente de catálogo que no bloquea la tabla `accounts`.
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS public_brand_color TEXT;

COMMENT ON COLUMN accounts.public_brand_color IS
  'Color de marca de la vitrina pública en formato hexadecimal (#rrggbb). Nullable: si no se configura o es inválido, la vitrina usa el color de respaldo institucional.';
