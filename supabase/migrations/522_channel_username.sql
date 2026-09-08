-- ============================================================
-- 522_channel_username.sql
--
-- El nombre de usuario, para reconocer a quien no da su teléfono.
--
-- WhatsApp dejó de entregar el número de quien adopta un nombre de
-- usuario: manda un identificador con alcance de negocio (BSUID) con la
-- forma `CO.4481978948757066`, y junto a él el `profile.username` de esa
-- persona. Esos contactos existen desde el change
-- `identidad-bsuid-whatsapp`, y hasta ahora no tenían dónde guardar lo
-- único que un humano puede leer de ellos.
--
-- Por qué en `contact_channels` y no en `contacts`:
--   El nombre de usuario pertenece a la IDENTIDAD EN UN CANAL, no a la
--   persona. La misma persona puede tener un handle en WhatsApp y otro
--   distinto en Instagram, y ponerlo en `contacts` obligaría a una
--   columna por canal — exactamente lo que la 513 decidió no hacer
--   cuando eligió modelar la identidad en tabla aparte.
--
-- Por qué NO sirve el nombre de perfil que ya guardamos:
--   `contacts.name` trae el nombre para mostrar, que cada quien elige y
--   puede repetirse: dos «Juan» son indistinguibles cuando no hay
--   teléfono con el que separarlos. El nombre de usuario es único y
--   estable, y es el dato que la propia persona puede dictar por
--   teléfono para que la encuentren.
--
-- Nullable a propósito: la inmensa mayoría de las identidades no tiene
-- ninguno, y forzar una cadena vacía haría indistinguible "no tiene"
-- de "no lo sabemos todavía".
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

ALTER TABLE contact_channels
  ADD COLUMN IF NOT EXISTS username TEXT;

COMMENT ON COLUMN contact_channels.username IS
  'Identificador público legible de esa identidad, cuando el canal lo informa (profile.username en WhatsApp). NO es una llave: se muestra, no se usa para resolver el contacto.';

-- ============================================================
-- De paso, el comentario de `external_id` quedó desactualizado.
--
-- La 513 lo describía como "para WhatsApp es el teléfono normalizado",
-- que dejó de ser cierto: puede ser un BSUID. Corregirlo acá evita que
-- el próximo que lea el esquema saque la conclusión equivocada.
-- ============================================================
COMMENT ON COLUMN contact_channels.external_id IS
  'Identificador de la persona en ese canal. En WhatsApp es el teléfono normalizado (solo dígitos) o, cuando Meta no lo entrega porque la persona adoptó un nombre de usuario, su BSUID con la forma CO.4481978948757066.';
