-- ============================================================
-- 524_broadcast_follow_up.sql
--
-- Seguimiento automático de difusiones: si un destinatario no responde
-- en N horas, el servidor le manda UNA plantilla de recordatorio.
-- Cambio de OpenSpec `seguimiento-automatico-de-difusiones`.
--
-- El caso que lo motivó: una consulta de disponibilidad a ~90 dueños de
-- vehículos, con recordatorio a los 2-3 días para quien no conteste.
-- Una automatización no podía hacerlo: nada la dispara cuando sale una
-- difusión, y su paso `send_template` exige una conversación que la
-- difusión nunca crea — justo quien no respondió no tiene ninguna.
--
-- ## Por qué el estado va en la MISMA fila del destinatario
--
-- `flagBroadcastReplyIfAny` (src/lib/inbound/core.ts) marca `replied` la
-- fila MÁS RECIENTE del contacto que siga en sent/delivered/read. Si el
-- recordatorio fuera otra difusión, la respuesta caería en la hija y la
-- original se quedaría "sin respuesta". En la misma fila, el destinatario
-- sigue en su escalon hasta que contesta, y la marca de siempre lo
-- encuentra sin tocar el webhook.
--
-- Las columnas nuevas no mueven los conteos de la difusión: el trigger
-- de la 005 solo actúa cuando cambia `status`.
--
-- ## Por qué el reclamo es una función SQL
--
-- "Vencido" depende del plazo de CADA difusión y "escribió después" es
-- un EXISTS con join; PostgREST no expresa ninguna de las dos sin traer
-- filas de más. Y el reclamo tiene que ser atómico: dos pasadas del cron
-- solapadas no pueden mandarle dos recordatorios a la misma persona,
-- porque un mensaje de WhatsApp no se puede retirar.
--
-- Idempotente — seguro de re-ejecutar.
-- ============================================================

-- ============================================================
-- 1. Configuración del seguimiento, en la difusión
--
-- El plazo va en HORAS aunque la interfaz lo pida en días: permite
-- probar con plazos cortos y no ata el esquema a la unidad que hoy
-- muestra la interfaz. Sin plantilla = sin seguimiento.
-- ============================================================
ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS follow_up_template_name TEXT,
  ADD COLUMN IF NOT EXISTS follow_up_template_language TEXT,
  ADD COLUMN IF NOT EXISTS follow_up_delay_hours INTEGER,
  ADD COLUMN IF NOT EXISTS follow_up_cancelled_at TIMESTAMPTZ;

ALTER TABLE broadcasts DROP CONSTRAINT IF EXISTS broadcasts_follow_up_delay_range;
ALTER TABLE broadcasts ADD CONSTRAINT broadcasts_follow_up_delay_range
  CHECK (follow_up_delay_hours IS NULL OR follow_up_delay_hours BETWEEN 1 AND 168);

-- Plantilla y plazo van juntos: uno sin el otro es una configuración a
-- medias que el cron no sabría interpretar.
ALTER TABLE broadcasts DROP CONSTRAINT IF EXISTS broadcasts_follow_up_complete;
ALTER TABLE broadcasts ADD CONSTRAINT broadcasts_follow_up_complete
  CHECK ((follow_up_template_name IS NULL) = (follow_up_delay_hours IS NULL));

COMMENT ON COLUMN broadcasts.follow_up_template_name IS
  'Plantilla del recordatorio a quien no responda. NULL = la difusión no tiene seguimiento. Ver 524_broadcast_follow_up.sql.';
COMMENT ON COLUMN broadcasts.follow_up_template_language IS
  'Idioma de la plantilla del recordatorio, tal como está aprobada en Meta.';
COMMENT ON COLUMN broadcasts.follow_up_delay_hours IS
  'Horas desde el envío original hasta el recordatorio (1-168). La interfaz lo pide en días.';
COMMENT ON COLUMN broadcasts.follow_up_cancelled_at IS
  'Cuándo se canceló el seguimiento. Cancelado, no sale ningún recordatorio que no hubiera salido ya.';

-- ============================================================
-- 2. Estado del recordatorio, en el destinatario
--
--   NULL      todavía no le toca, o le toca y no se ha reclamado
--   sending   reclamado por una pasada del cron
--   sent      salió
--   failed    Meta lo rechazó, no había destino, o la pasada murió
--   skipped   no le corresponde (escribió después, contacto borrado)
--
-- `follow_up_message_id` es solo trazabilidad: el webhook de estados
-- empareja por `whatsapp_message_id`, que sigue siendo el del mensaje
-- original, así que las entregas del recordatorio no mueven la escalera
-- de la fila. A propósito: esa escalera describe el mensaje original.
-- ============================================================
ALTER TABLE broadcast_recipients
  ADD COLUMN IF NOT EXISTS follow_up_status TEXT,
  ADD COLUMN IF NOT EXISTS follow_up_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS follow_up_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS follow_up_message_id TEXT,
  ADD COLUMN IF NOT EXISTS follow_up_error TEXT;

ALTER TABLE broadcast_recipients DROP CONSTRAINT IF EXISTS broadcast_recipients_follow_up_status_check;
ALTER TABLE broadcast_recipients ADD CONSTRAINT broadcast_recipients_follow_up_status_check
  CHECK (follow_up_status IS NULL OR follow_up_status IN ('sending', 'sent', 'failed', 'skipped'));

COMMENT ON COLUMN broadcast_recipients.follow_up_status IS
  'Estado del recordatorio: NULL (no ha salido), sending, sent, failed, skipped. Ver 524_broadcast_follow_up.sql.';
COMMENT ON COLUMN broadcast_recipients.follow_up_claimed_at IS
  'Cuándo lo reclamó una pasada del cron. Una fila en sending de más de 30 minutos se da por fallida y NO se reenvía.';
COMMENT ON COLUMN broadcast_recipients.follow_up_sent_at IS
  'Cuándo salió el recordatorio. Una respuesta con replied_at posterior cuenta como respuesta al recordatorio.';
COMMENT ON COLUMN broadcast_recipients.follow_up_message_id IS
  'Id de Meta del recordatorio. Solo trazabilidad: el webhook de estados sigue emparejando por whatsapp_message_id.';
COMMENT ON COLUMN broadcast_recipients.follow_up_error IS
  'Por qué el recordatorio falló o se omitió.';

-- Los candidatos: sin recordatorio todavía y con el original entregado
-- sin respuesta. Parcial para que no crezca con el historial ya resuelto.
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_follow_up_due
  ON broadcast_recipients (broadcast_id, sent_at)
  WHERE follow_up_status IS NULL AND status IN ('sent', 'delivered', 'read');

CREATE INDEX IF NOT EXISTS idx_broadcasts_follow_up_active
  ON broadcasts (account_id)
  WHERE follow_up_template_name IS NOT NULL AND follow_up_cancelled_at IS NULL;

-- ============================================================
-- 3. claim_due_broadcast_follow_ups
--
-- Una pasada, en tres pasos y en una transacción:
--
--   a. Las filas en `sending` de más de 30 minutos (la pasada que las
--      reclamó murió) pasan a `failed`. NO se reintentan: no hay forma de
--      saber si Meta llegó a aceptar el envío, y perder un recordatorio
--      es mejor que mandar dos. Misma ventana que DELIVERY_LOCK_STALE_MS.
--   b. Los vencidos que no deben recibirlo pasan a `skipped`: contacto
--      borrado, o contacto que ESCRIBIÓ DESPUÉS del envío. Esto último se
--      mira en `messages` y no solo en `status = 'replied'`, porque esa
--      marca se aplica únicamente a la difusión más reciente del
--      contacto: un dueño que está en dos difusiones y contestó recibiría
--      el recordatorio de la vieja.
--   c. El resto, hasta `p_limit`, pasa a `sending` con un UPDATE
--      condicionado a `follow_up_status IS NULL` — la pasada que llega
--      segunda no encuentra la fila — y se devuelve para enviarlo.
--
-- `p_account_ids` son las cuentas que están en horario de atención: el
-- llamador las filtra antes, así que lo de una cuenta fuera de horario ni
-- se reclama ni se omite; sigue vencido y sale en la primera pasada
-- dentro del horario.
-- ============================================================
CREATE OR REPLACE FUNCTION public.claim_due_broadcast_follow_ups(
  p_account_ids UUID[],
  p_limit       INTEGER
)
RETURNS TABLE(
  recipient_id      UUID,
  broadcast_id      UUID,
  account_id        UUID,
  contact_id        UUID,
  template_params   JSONB,
  template_name     TEXT,
  template_language TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  -- a. Pasadas interrumpidas.
  UPDATE broadcast_recipients r
     SET follow_up_status = 'failed',
         follow_up_error  = 'Envío interrumpido; no se reintenta para no duplicar el mensaje'
   WHERE r.follow_up_status = 'sending'
     AND r.follow_up_claimed_at < NOW() - INTERVAL '30 minutes';

  -- b. Vencidos que no deben recibirlo.
  UPDATE broadcast_recipients r
     SET follow_up_status = 'skipped',
         follow_up_error  = CASE
           WHEN r.contact_id IS NULL THEN 'El contacto fue borrado'
           ELSE 'El contacto escribió después del envío'
         END
    FROM broadcasts b
   WHERE b.id = r.broadcast_id
     AND b.account_id = ANY(p_account_ids)
     AND b.follow_up_template_name IS NOT NULL
     AND b.follow_up_cancelled_at IS NULL
     AND r.follow_up_status IS NULL
     AND r.status IN ('sent', 'delivered', 'read')
     AND COALESCE(r.sent_at, r.created_at)
         <= NOW() - make_interval(hours => b.follow_up_delay_hours)
     AND (
       r.contact_id IS NULL
       OR EXISTS (
         SELECT 1
           FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
          WHERE c.contact_id = r.contact_id
            AND m.sender_type = 'customer'
            AND m.created_at > COALESCE(r.sent_at, r.created_at)
       )
     );

  -- c. Reclamo. SKIP LOCKED además del WHERE: una pasada solapada ni
  --    siquiera espera por las filas que la otra está reclamando.
  RETURN QUERY
  WITH due AS (
    SELECT r.id
      FROM broadcast_recipients r
      JOIN broadcasts b ON b.id = r.broadcast_id
     WHERE b.account_id = ANY(p_account_ids)
       AND b.follow_up_template_name IS NOT NULL
       AND b.follow_up_cancelled_at IS NULL
       AND r.follow_up_status IS NULL
       AND r.status IN ('sent', 'delivered', 'read')
       AND r.contact_id IS NOT NULL
       AND COALESCE(r.sent_at, r.created_at)
           <= NOW() - make_interval(hours => b.follow_up_delay_hours)
     ORDER BY COALESCE(r.sent_at, r.created_at)
     LIMIT GREATEST(p_limit, 0)
     FOR UPDATE OF r SKIP LOCKED
  ),
  claimed AS (
    UPDATE broadcast_recipients r
       SET follow_up_status     = 'sending',
           follow_up_claimed_at = NOW()
      FROM due
     WHERE r.id = due.id
       AND r.follow_up_status IS NULL
    RETURNING r.id, r.broadcast_id, r.contact_id, r.template_params
  )
  SELECT cl.id,
         cl.broadcast_id,
         b.account_id,
         cl.contact_id,
         cl.template_params,
         b.follow_up_template_name,
         b.follow_up_template_language
    FROM claimed cl
    JOIN broadcasts b ON b.id = cl.broadcast_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_broadcast_follow_ups(UUID[], INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_due_broadcast_follow_ups(UUID[], INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.claim_due_broadcast_follow_ups(UUID[], INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_broadcast_follow_ups(UUID[], INTEGER) TO service_role;
