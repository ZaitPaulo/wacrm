-- ============================================================
-- 526_message_referral.sql
--
-- De qué anuncio viene un mensaje.
--
-- Cuando alguien toca un anuncio de Meta con clic a WhatsApp, el primer
-- mensaje trae un objeto `referral`: titular y texto del anuncio, su id,
-- su URL y el `ctwa_clid` que identifica el clic. El webhook lo
-- descartaba, así que ni el bot ni el asesor sabían a qué se refería un
-- "¿Puedo obtener más información sobre esto?". El 2026-09-17, con la
-- primera campaña, 17 de 36 prospectos se fueron sin respuesta a eso.
--
-- Por qué en `messages` y no en `conversations`:
--   El origen es del mensaje que lo trajo. Una misma conversación puede
--   recibir clics de dos anuncios en días distintos, y guardarlo en el
--   hilo obligaría a elegir uno y perder el otro.
--
-- Por qué jsonb entero y no columnas:
--   Hoy se leen el titular y el texto; mañana puede hacer falta el
--   `ctwa_clid` para atribuir conversiones o la imagen para mostrarla. El
--   objeto crudo no obliga a otra migración por cada campo.
--
-- Nullable: casi ningún mensaje viene de un anuncio.
-- ============================================================

ALTER TABLE messages ADD COLUMN IF NOT EXISTS referral jsonb;

COMMENT ON COLUMN messages.referral IS
  'Objeto referral de Meta cuando el mensaje llegó desde un anuncio (clic a WhatsApp). Null en los demás.';
