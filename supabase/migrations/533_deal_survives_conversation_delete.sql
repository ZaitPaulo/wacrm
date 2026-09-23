-- ============================================================
-- 533_deal_survives_conversation_delete.sql
--
-- Borrar un contacto deja de reventar cuando tiene un negocio.
--
-- ESTA ES UNA REGRESIÓN QUE INTRODUCE ESTE MISMO LOTE, y por eso la
-- corrección sale con él. Hasta ahora `deals.conversation_id` estaba
-- siempre en NULL —nadie lo escribía— así que el problema no podía
-- ocurrir. Con el traspaso de la IA creando el negocio (migración 532 +
-- `src/lib/ai/handoff-deal.ts`) y el alta desde la bandeja vinculándolo,
-- pasa a ser el caso normal.
--
-- LA CADENA QUE FALLA
--
--   contacts --[conversations_contact_id_fkey = CASCADE]--> conversations
--   conversations --[deals_conversation_id_fkey = NO ACTION]--> deals
--
-- Borrar el contacto arrastra sus conversaciones por CASCADE, y ahí el
-- FK de `deals` dice NO ACTION y aborta la transacción entera:
--
--   ERROR: update or delete on table "conversations" violates foreign
--          key constraint "deals_conversation_id_fkey" on table "deals"
--
-- Dónde se nota, o sea dónde borra contactos la aplicación:
--   * la ficha del contacto (`contact-detail-view.tsx`),
--   * la lista de contactos (`contacts/page.tsx`),
--   * el BORRADO MASIVO de la lista, un `.in('id', ids)` que falla
--     ENTERO si UN solo contacto de la selección tiene negocio — el
--     peor de los tres, porque el usuario no tiene forma de saber cuál
--     de los cuarenta que marcó lo está bloqueando,
--   * y la API pública v1.
--
-- POR QUÉ `SET NULL` Y NO `CASCADE`
--
-- Tres razones, y la tercera sola bastaría:
--
--   1. LO QUE YA DECIDIÓ EL ESQUEMA. `deals_contact_id_fkey` es
--      `ON DELETE SET NULL` desde la 017. O sea que el repo ya resolvió
--      esta pregunta para el otro padre del negocio: el negocio
--      sobrevive a la desaparición de aquello de lo que colgaba.
--      Contestarla distinto para la conversación sería incoherente.
--
--   2. EL PATRÓN DE LAS OTRAS SEIS HIJAS DE `conversations`. `messages`,
--      `message_reactions` y `notifications` van en CASCADE porque SON
--      la conversación: sin ella no significan nada. `flow_runs`,
--      `vehicle_inquiries` y `ai_usage_log` van en SET NULL porque
--      tienen valor propio. Un negocio es de la segunda clase, y con
--      diferencia: es la contabilidad de la venta.
--
--   3. CASCADE BORRARÍA PLATA. Un negocio `won` es el registro de una
--      venta hecha, con su valor y sus notas. Que borrar un contacto
--      —que es limpieza de base de datos, algo que se hace sin pensar y
--      en lote— se lleve en silencio la venta de un carro es una
--      pérdida de datos irreversible disfrazada de operación de
--      mantenimiento. SET NULL desvincula y conserva; la tarjeta queda
--      en su etapa, sin hilo al que volver.
--
-- La constraint NO ACTION original no fue una decisión: viene de la
-- 001 (`conversation_id UUID REFERENCES conversations(id)`, sin cláusula
-- de borrado, o sea el NO ACTION por defecto). TODAS las migraciones
-- posteriores que agregaron un `conversation_id` —la 010, la 027, la
-- 508— sí declararon la suya explícitamente. Esta se quedó sin declarar
-- porque en 2025 no había nada que la ejerciera.
--
-- EFECTO SOBRE EL ÍNDICE ÚNICO DE LA 532
--
-- Ninguno, y conviene saber por qué: `idx_deals_one_open_per_conversation`
-- es parcial `WHERE status = 'open' AND conversation_id IS NOT NULL`, así
-- que dos negocios abiertos que quedan desvinculados a la vez salen los
-- dos del índice en vez de colisionar. Se verifica explícitamente.
--
-- Idempotente — seguro de re-ejecutar: el DROP es `IF EXISTS` y el ADD
-- va siempre después, así que el resultado no depende de con qué
-- cláusula estaba la constraint antes.
--
-- Rollback: volver a declararla sin la cláusula.
--   ALTER TABLE deals DROP CONSTRAINT deals_conversation_id_fkey;
--   ALTER TABLE deals ADD CONSTRAINT deals_conversation_id_fkey
--     FOREIGN KEY (conversation_id) REFERENCES conversations(id);
-- Pero eso devuelve el fallo del borrado masivo, así que no es un
-- rollback que se quiera.
-- ============================================================

-- Postgres no deja cambiar la acción de borrado de una constraint en
-- sitio —`ALTER CONSTRAINT` solo toca DEFERRABLE—, así que se recrea.
-- El ADD revalida la tabla, que es instantáneo con los pocos negocios
-- que hay (0 al escribir esto) y toma un lock breve sobre `deals` y
-- `conversations`.
ALTER TABLE deals
  DROP CONSTRAINT IF EXISTS deals_conversation_id_fkey;

ALTER TABLE deals
  ADD CONSTRAINT deals_conversation_id_fkey
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
  ON DELETE SET NULL;

COMMENT ON COLUMN deals.conversation_id IS
  'La conversación de la que nació el negocio, o NULL. ON DELETE SET NULL: el negocio sobrevive a que se borre el contacto y su conversación, igual que sobrevive a que se borre el contacto (deals_contact_id_fkey). Un negocio ganado es el registro de una venta y no se borra por limpiar la base.';
