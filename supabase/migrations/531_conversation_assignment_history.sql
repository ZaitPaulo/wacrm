-- ============================================================
-- 531_conversation_assignment_history.sql
--
-- El historial de quién tuvo cada conversación deja de perderse.
--
-- Hasta hoy el único rastro de la propiedad de un lead era
-- `conversations.assigned_agent_id`, y eso es ESTADO, no registro: una
-- foto del ahora. Se pisa en cada reasignación y se borra entero al
-- devolverle el hilo al bot (`POST /api/ai/autoreply/[id]` con
-- `paused:false` pone la columna en NULL). Si un asesor atendió 40
-- clientes este mes y hoy tiene 12 abiertos, el 40 no existe en ninguna
-- parte: no hay de dónde sacarlo.
--
-- Esta migración crea el registro append-only que faltaba, lo llena
-- desde un TRIGGER, y siembra el estado de hoy para que el conteo de
-- "clientes en gestión" no arranque en cero.
--
-- DECISIONES (ver openspec/changes/agent-performance-dashboard/design.md)
--
--   * EVENTOS, NO PERÍODOS. Cada fila es UN CAMBIO (`from_agent_id` →
--     `to_agent_id`), no un intervalo con `started_at`/`ended_at`. La
--     alternativa obligaba al trigger a cerrar la fila anterior con un
--     UPDATE: rompe la inmutabilidad y abre una carrera entre dos
--     cambios simultáneos. Con eventos cada escritura es un INSERT
--     independiente y los períodos se derivan cuando alguien los pida,
--     con `LEAD(changed_at) OVER (PARTITION BY conversation_id)`.
--
--   * TRIGGER, NO CÓDIGO DE APLICACIÓN. Hay CINCO caminos que asignan
--     —la IA (`handOffToHuman`), el motor de automatizaciones
--     (`assign_conversation`), el motor de flujos, la bandeja y la API
--     v1— más las correcciones a mano por SQL. Basta que uno se olvide
--     para que la estadística mienta, y el que se agregue mañana nace
--     olvidado. Es el mismo razonamiento que puso el horario de
--     atención en `outbound/gate.ts` y no en cada automatización.
--
--   * AFTER, NO BEFORE. El historial NO puede abortar la asignación.
--     Un fallo acá cuesta una fila de estadística; un BEFORE que
--     reviente cuesta un cliente sin asesor y, peor, el 200 que Meta
--     espera del webhook. Por eso además el cuerpo entero va envuelto
--     en `EXCEPTION WHEN OTHERS → RAISE WARNING`, igual que
--     `notify_conversation_assigned` (migración 027).
--
--   * `changed_by` GUARDA `auth.uid()`, que es NULL en todos los
--     caminos de service-role. OJO: eso NO separa "lo hizo el sistema"
--     de "lo hizo una persona". La bandeja escribe la asignación con
--     service-role (`escribeConServiceRole()` en
--     `src/lib/inbox/assignment.ts`) cuando el que actúa es un `agent`,
--     así que un asesor que reasigna o devuelve al bot también deja
--     NULL. NULL = escrito con service-role: IA, automatizaciones,
--     flujos, API v1 y todo `agent` desde la bandeja. Un valor no nulo
--     solo aparece cuando la sesión del usuario escribe directo (hoy,
--     admin/owner). Nada del código lee esta columna todavía.
--
--   * SIN FK SOBRE LOS ASESORES. Ni `from_agent_id`, ni `to_agent_id`,
--     ni `changed_by` referencian `auth.users`. Primero por simetría:
--     `conversations.assigned_agent_id` tampoco la tiene. Y sobre todo
--     porque un historial que se borra cuando el asesor deja la cuenta
--     no es un historial — justo el mes en que hay que mirar cuánto
--     atendió es cuando ya no está.
--
-- LÍMITE CONOCIDO: el historial empieza a capturar el día que esto se
-- despliega. Lo anterior no se reconstruye, porque no existe: no hay
-- registro de asignaciones previas en ninguna tabla. Lo único que se
-- rescata es la foto de hoy, y se rescata declarada como aproximación
-- (ver la siembra, al final).
--
-- ORDEN DE DESPLIEGUE: sale junto con la 532 y la 533 (lote 531-533;
-- el 530 quedó vacío a propósito, ver design.md → Migration Plan).
--
-- Idempotente — seguro de re-ejecutar (la siembra incluida).
--
-- Rollback: `DROP TRIGGER record_conversation_assignment ON
-- conversations;` deja de registrar sin tocar lo ya registrado.
-- `DROP TABLE conversation_assignments;` lo borra todo. La siembra
-- sola se limpia con `DELETE FROM conversation_assignments WHERE
-- is_seed;`.
-- ============================================================

-- ============================================================
-- TABLA
-- ============================================================
CREATE TABLE IF NOT EXISTS conversation_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Desnormalizado desde `conversations` para que la RLS y las
  -- métricas por cuenta no tengan que unir contra la conversación en
  -- cada fila. Mismo patrón que el resto de las tablas de la 017.
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  -- Quién la tenía antes. NULL = no la tenía nadie (estaba en la cola
  -- compartida), que es el caso del primer traspaso de la IA.
  from_agent_id   UUID,
  -- Quién la tiene desde este instante. NULL = se devolvió al bot / a
  -- la cola compartida.
  to_agent_id     UUID,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- `auth.uid()` del que hizo el cambio, o NULL si se escribió con
  -- service-role: IA, automatizaciones, flujos, webhooks, API v1 y
  -- también todo `agent` que reasigna o devuelve al bot desde la
  -- bandeja. NULL no significa "lo hizo el sistema".
  changed_by      UUID,
  -- TRUE solo en las filas que esta migración sembró con la foto del
  -- estado actual. No son cambios observados: su `changed_at` es una
  -- aproximación y por eso cualquier cálculo de duración las excluye.
  is_seed         BOOLEAN NOT NULL DEFAULT FALSE,
  -- Una fila que no mueve nada no es un cambio. El trigger ya lo
  -- filtra con IS DISTINCT FROM; la restricción está para que tampoco
  -- pueda entrar por SQL a mano.
  CONSTRAINT conversation_assignments_real_change
    CHECK (from_agent_id IS DISTINCT FROM to_agent_id)
);

-- La consulta de continuidad de `pickHandoffAgent`: la última
-- asignación de ESTA conversación. Corre en el camino caliente de cada
-- traspaso de la IA, así que va por índice y no por barrido.
CREATE INDEX IF NOT EXISTS idx_conversation_assignments_conversation
  ON conversation_assignments (conversation_id, changed_at DESC);

-- La consulta del dashboard: todo el historial de una cuenta, del más
-- reciente al más antiguo.
CREATE INDEX IF NOT EXISTS idx_conversation_assignments_account
  ON conversation_assignments (account_id, changed_at DESC);

COMMENT ON TABLE conversation_assignments IS
  'Historial append-only de cada cambio de conversations.assigned_agent_id. Lo escribe el trigger record_conversation_assignment, nunca la aplicación. Las filas con is_seed = TRUE son la foto del estado que había al desplegar la migración 531, con changed_at aproximado.';

COMMENT ON COLUMN conversation_assignments.changed_by IS
  'auth.uid() de la sesión que escribió el cambio, o NULL cuando se escribió con service-role. NULL incluye a la IA, automatizaciones, flujos, API v1 y a todo usuario con rol agent que reasigna o devuelve al bot desde la bandeja (escribeConServiceRole): NO distingue sistema de persona.';

COMMENT ON COLUMN conversation_assignments.is_seed IS
  'TRUE en las filas sembradas por la migración 531 con el estado actual. changed_at es conversations.updated_at, o sea una aproximación: excluirlas de cualquier cálculo de duración.';

-- ============================================================
-- PRIVILEGIOS DE TABLA
--
-- EXPLÍCITOS Y LOAD-BEARING, y en los DOS sentidos. Los dos stacks
-- arrancan en extremos opuestos y ninguno de los dos es el que
-- queremos:
--
--   * En el stack LOCAL, una tabla nueva creada por `postgres` solo le
--     deja a `authenticated` TRUNCATE/REFERENCES/TRIGGER/MAINTAIN: sin
--     el GRANT, el cliente recibe `permission denied for table
--     conversation_assignments` aunque la RLS esté impecable (es lo
--     que documenta la migración 528).
--
--   * En el VPS hay `ALTER DEFAULT PRIVILEGES` de `postgres` y de
--     `supabase_admin` que le dan `arwdDxtm` —o sea TODO, incluido
--     DELETE— sobre cada tabla nueva a `anon`, `authenticated` y
--     `service_role`. Comprobado el 2026-09-21 en `pg_default_acl`.
--     Ahí el riesgo es el contrario: la tabla nace abierta y lo único
--     que la tapa es la RLS.
--
-- Y `psql` como `postgres` NO detecta ninguno de los dos casos, porque
-- es superusuario y se salta privilegios y RLS por igual.
--
-- Por eso se REVOCA primero y se concede después: así el resultado es
-- el mismo en los dos stacks y no depende de con qué privilegios por
-- defecto nació la tabla.
--
-- Solo SELECT para `authenticated`: escribir el historial no es cosa
-- de nadie más que del trigger, que corre SECURITY DEFINER como
-- `postgres` y no pasa por estos privilegios.
--
-- A `service_role` tampoco se le dan UPDATE ni DELETE, en vez del
-- `GRANT ALL` que usan otras tablas. "Append-only" es un requisito del
-- registro, no una costumbre: si nadie tiene el privilegio, no hace
-- falta confiar en que nadie lo use. Borrar el historial de una cuenta
-- sigue siendo posible por el CASCADE al borrar la cuenta o la
-- conversación, que es exactamente cuando debe desaparecer.
--
-- `anon` no necesita nada: nadie lee esto sin sesión.
-- ============================================================
REVOKE ALL ON conversation_assignments FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON conversation_assignments TO authenticated;
GRANT SELECT, INSERT ON conversation_assignments TO service_role;

-- ============================================================
-- RLS — SOLO LECTURA, Y SOLO owner / admin
--
-- `is_account_member(account_id, 'admin')` es owner o admin: la
-- jerarquía de la 017 es owner > admin > agent > viewer y la
-- comprobación es ">= min_role".
--
-- El `agent` NO lee el historial, ni siquiera las filas que lo nombran
-- a él. Es una métrica de desempeño y la mira quien dirige, no el
-- medido. `viewer` tampoco, aunque la 520 lo deje ver todas las
-- conversaciones: ver la cartera es supervisión, ver el desempeño de
-- cada asesor es otra cosa.
--
-- No hay política de INSERT, UPDATE ni DELETE a propósito. Sin
-- política, la RLS niega: ni siquiera el owner puede reescribir su
-- propio historial desde el cliente.
-- ============================================================
ALTER TABLE conversation_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_assignments_select ON conversation_assignments;
CREATE POLICY conversation_assignments_select ON conversation_assignments FOR SELECT
  USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- TRIGGER — EL REGISTRO
--
-- `AFTER INSERT OR UPDATE OF assigned_agent_id`: la cláusula `OF` hace
-- que la sentencia tenga que MENCIONAR la columna para que el trigger
-- corra, así que los UPDATE de `last_message_at` / `unread_count` que
-- dispara cada mensaje entrante ni siquiera entran acá. Es el mismo
-- recorte que ya usan `enforce_agent_keeps_assignment` (520) y
-- `notify_conversation_assigned` (027) sobre esta misma tabla.
--
-- El `IS DISTINCT FROM` cubre el otro caso: una sentencia que sí
-- menciona la columna pero le escribe el mismo valor que ya tenía —una
-- reasignación al mismo asesor, un UPDATE que copia la fila entera— no
-- es un cambio y no deja fila.
--
-- SECURITY DEFINER porque el INSERT tiene que entrar venga de donde
-- venga: un `agent` que se pasa la conversación a un compañero no
-- tiene privilegio de INSERT sobre esta tabla, y no debería tenerlo.
-- ============================================================
CREATE OR REPLACE FUNCTION record_conversation_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Una conversación que nace sin asesor no cambió de manos: su
    -- primera fila la escribirá el traspaso, cuando ocurra.
    IF NEW.assigned_agent_id IS NULL THEN
      RETURN NEW;
    END IF;
    v_from := NULL;
  ELSE
    IF NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN
      RETURN NEW;
    END IF;
    v_from := OLD.assigned_agent_id;
  END IF;

  INSERT INTO conversation_assignments (
    account_id, conversation_id, from_agent_id, to_agent_id, changed_by
  ) VALUES (
    NEW.account_id, NEW.id, v_from, NEW.assigned_agent_id, auth.uid()
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- PERDER UNA FILA DE ESTADÍSTICA ES PREFERIBLE A DEJAR UN CLIENTE
  -- SIN ASESOR. Este trigger cuelga del mismo UPDATE que usa la
  -- transferencia de la IA dentro del webhook de Meta: si lanzara, se
  -- llevaría por delante la asignación, el aviso al cliente y el 200
  -- que Meta espera. El WARNING queda en el log del contenedor.
  RAISE WARNING 'No se pudo registrar el cambio de asignación de la conversación %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION record_conversation_assignment() OWNER TO postgres;

COMMENT ON FUNCTION record_conversation_assignment() IS
  'Escribe una fila en conversation_assignments por cada cambio real de conversations.assigned_agent_id. AFTER y con EXCEPTION WHEN OTHERS: nunca aborta la asignación.';

DROP TRIGGER IF EXISTS record_conversation_assignment ON conversations;
CREATE TRIGGER record_conversation_assignment
  AFTER INSERT OR UPDATE OF assigned_agent_id ON conversations
  FOR EACH ROW EXECUTE FUNCTION record_conversation_assignment();

-- ============================================================
-- SIEMBRA DEL ESTADO ACTUAL
--
-- Sin esto, "clientes en gestión" arrancaría en cero y el dueño vería
-- una tabla vacía con 105 conversaciones repartidas delante suyo
-- (conteo del 2026-09-21 en producción). Se siembra una fila por cada
-- conversación HOY asignada, como si el asesor la hubiera recibido de
-- la cola compartida.
--
-- `changed_at = updated_at` es una APROXIMACIÓN y se declara como tal
-- con `is_seed = TRUE`: `updated_at` se mueve con cada mensaje, así
-- que es la fecha de la última actividad, no la de la asignación. Sirve
-- para contar clientes en gestión; NO sirve para medir cuánto tiempo
-- lleva el asesor con el hilo, y por eso los cálculos de duración
-- excluyen estas filas.
--
-- El tiempo de respuesta no se siembra: `messages.sender_id` está
-- vacío hacia atrás y no hay forma honesta de saber quién contestó.
-- Nace vacío y se llena desde el despliegue.
--
-- `NOT EXISTS` hace la siembra idempotente Y la deja fuera del camino
-- de una re-ejecución posterior: si la conversación ya tiene historial
-- —porque el trigger ya registró algo— no se le inventa un pasado.
-- ============================================================
INSERT INTO conversation_assignments (
  account_id, conversation_id, from_agent_id, to_agent_id, changed_at, changed_by, is_seed
)
SELECT
  c.account_id,
  c.id,
  NULL,
  c.assigned_agent_id,
  COALESCE(c.updated_at, c.created_at, now()),
  NULL,
  TRUE
FROM conversations c
WHERE c.assigned_agent_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM conversation_assignments ca
    WHERE ca.conversation_id = c.id
  );
