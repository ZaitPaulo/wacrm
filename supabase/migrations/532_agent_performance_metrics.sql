-- ============================================================
-- 532_agent_performance_metrics.sql
--
-- Lo que la tabla de rendimiento por asesor necesita de la base.
--
-- Esta migración es la segunda mitad del cambio
-- `agent-performance-dashboard` y se despliega junto con la 531 y la
-- 533; ninguna de las tres sale sola (ver design.md → Migration Plan).
--
-- Trae tres cosas, en este orden:
--
--   1. La unicidad del negocio por conversación, que es lo que hace
--      segura la creación automática del negocio en el traspaso.
--   2. El índice de apoyo sobre `messages (conversation_id, created_at)`,
--      para el barrido sin ventana de tiempo.
--   3. La RPC `agent_performance_metrics()`, que devuelve la tabla del
--      dashboard ya agregada.
--
-- Las tres van en el mismo archivo porque describen una sola
-- capacidad: la tabla de rendimiento. (La 533, que protege el negocio
-- cuando se borra la conversación, es otra capacidad y va aparte; el
-- lote completo es 531, 532 y 533.)
--
-- Idempotente — seguro de re-ejecutar.
--
-- Rollback, por partes y en cualquier orden:
--   `DROP FUNCTION agent_performance_metrics();` — el dashboard deja de
--   mostrar la tabla; nada más la usa.
--   `DROP INDEX idx_messages_conversation_created;` — solo cuesta
--   rendimiento.
--   `DROP INDEX idx_deals_one_open_per_conversation;` — el código de la
--   IA trata la violación de unicidad como "ya existe", así que sin el
--   índice vuelve a ser posible el negocio duplicado, pero nada se
--   rompe.
-- ============================================================

-- ============================================================
-- UN SOLO NEGOCIO ABIERTO POR CONVERSACIÓN
--
-- La creación del negocio en el traspaso (`handOffToHuman`) necesita
-- deduplicar, porque una conversación se devuelve al bot y se vuelve a
-- transferir cuantas veces haga falta. La deduplicación NO puede ser un
-- `SELECT` previo desde la aplicación: dos traspasos casi simultáneos
-- —dos mensajes del cliente en ráfaga, dos `after()` del webhook
-- corriendo a la vez— pasarían los dos SELECT y crearían dos tarjetas
-- gemelas. Es exactamente el agujero que tiene `create_deal` en el
-- motor de automatizaciones (`engine.ts`), que hace un `insert` pelado
-- tras una guarda en memoria.
--
-- Con el índice, el segundo INSERT falla con 23505 y el código lo lee
-- como "ya existe", que es la verdad.
--
-- PARCIAL POR `status = 'open'` a propósito: un negocio cerrado
-- —ganado o perdido— ya no está en gestión, así que una conversación
-- que revive puede abrir uno nuevo. Ese es el comportamiento que pide
-- el spec `handoff-deal-creation`.
--
-- `conversation_id` es NULLABLE y los NULL son distintos entre sí en un
-- índice único de Postgres, así que los negocios creados a mano sin
-- conversación (desde el tablero) no se estorban entre ellos.
--
-- OJO, CAMBIO DE COMPORTAMIENTO PARA LA BANDEJA: crear un negocio
-- desde la ficha del contacto también queda sujeto a esto. Hoy la
-- bandeja permite dos negocios abiertos sobre el mismo hilo —alguien
-- que pregunta por dos carros distintos— y a partir de acá el segundo
-- lo rechaza la base con 23505. Es coherente con lo que espera el
-- embudo y está declarado en el design como riesgo; QA lo verifica
-- explícitamente (tarea 5.4).
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_deals_one_open_per_conversation
  ON deals (conversation_id)
  WHERE status = 'open' AND conversation_id IS NOT NULL;

COMMENT ON INDEX idx_deals_one_open_per_conversation IS
  'Un solo negocio abierto por conversación. Lo usa la creación automática del negocio en el traspaso de la IA para deduplicar sin carrera: el segundo INSERT falla con 23505 y se lee como "ya existe".';

-- ============================================================
-- ÍNDICE DE APOYO SOBRE `messages`
--
-- La RPC de abajo barre TODOS los mensajes de la cuenta —sin ventana de
-- tiempo, por decisión del Director— y los recorre por conversación en
-- orden cronológico para emparejar cada entrante con la respuesta del
-- asesor. Lo único que había era `idx_messages_conversation` (migración
-- 001), que es solo por `conversation_id`: sirve para agrupar, no para
-- recorrer ordenado.
--
-- El compuesto deja el prefijo `(conversation_id)` redundante en
-- `idx_messages_conversation`, pero ese NO se toca acá: quitarlo es una
-- decisión aparte y esta migración no puede permitirse tocar la carga
-- del hilo en la bandeja.
--
-- Escala de referencia (producción, 2026-09-21): 1.571 mensajes. La RPC
-- responde de sobra. El punto de revisión es cuando pase de un segundo;
-- la salida natural entonces es una tabla de agregados que el trigger de
-- la 531 mantenga al día, no recortar el período a espaldas del dueño.
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON messages (conversation_id, created_at);

-- ============================================================
-- RPC — RENDIMIENTO POR ASESOR
--
-- Devuelve la tabla del dashboard YA AGREGADA: una fila por asesor
-- vigente más una fila "Sin asignar". Se sale del patrón del resto de
-- `src/lib/dashboard/queries.ts`, que agrega en el navegador, y es
-- deliberado: el tiempo de respuesta obliga a recorrer todos los
-- mensajes emparejándolos, y sin ventana de tiempo eso no se puede
-- traer al cliente. Es exactamente el caso que el comentario de
-- `queries.ts:20` anticipaba como el punto de migrar a RPC.
--
-- CONTROL DE ACCESO ADENTRO, NO SOLO EN LA INTERFAZ. La cuenta y el rol
-- salen del perfil de `auth.uid()`; la función NO recibe `account_id`,
-- así que no hay forma de pedirle los datos de otra cuenta. Un `agent`
-- recibe cero filas: esconder la tabla en el dashboard no sirve de nada
-- si la RPC le contesta igual a quien la llame a mano.
--
-- `SECURITY DEFINER` porque el cálculo tiene que ver la cuenta entera:
-- la RLS de la 520 le esconde al `agent` lo no asignado, y con eso la
-- fila "Sin asignar" saldría en cero justo para quien necesita verla.
--
-- LO QUE MIDE CADA COLUMNA
--
--   * `open_conversations` — conversaciones abiertas que tiene
--     asignadas AHORA. Sin ventana: un lead abierto hace tres meses
--     sigue siendo trabajo en gestión y cuenta igual que uno de hoy.
--
--   * `open_conversations_without_deal` — de esas, cuántas no tienen
--     ningún negocio abierto. Son clientes conversando que nunca
--     entraron al embudo, y es lo que explica por qué "13 clientes en
--     gestión" puede ir al lado de un desglose de etapas que suma 10:
--     no son la misma cosa medida dos veces, son diez en el embudo y
--     tres fuera. Siempre <= `open_conversations`, porque se cuenta
--     sobre el mismo conjunto de filas.
--
--   * `deals_by_stage` — sus negocios ABIERTOS, agrupados por etapa.
--     Solo salen las etapas que tienen al menos uno, y la columna queda
--     en NULL cuando no tiene ninguno: "sin datos", y no "todas las
--     etapas en cero", que se leería como un resultado medido.
--
--   * `avg_first_response_seconds` — ver el bloque de muestras abajo.
--     NULL cuando no hay ninguna muestra. Nunca cero por ausencia.
--
-- QUIÉN SALE EN UNA FILA — Y QUE NO ES LO MISMO QUE QUIÉN PUEDE VER
-- LA TABLA
--
-- Son dos preguntas distintas y divergen a propósito:
--
--   * LEER la tabla es de `owner` y `admin` (la guarda de arriba).
--   * SALIR en una fila es de quien ATIENDE CLIENTES, que es otra cosa:
--       - todo miembro con rol `agent`, aunque esté en cero: un asesor
--         desocupado es un dato, no un hueco;
--       - todo otro miembro CON CARTERA, o sea con conversaciones
--         abiertas o negocios asignados. Sin cartera no aparece, para
--         que la tabla no se llene de filas en cero de gente que no
--         atiende.
--
-- El ajuste del 2026-09-21 salió del primer dato real: la regla
-- anterior listaba solo a los `agent` y por eso metía en "Sin asignar"
-- las 70 conversaciones de una administradora — la campaña de
-- disponibilidad a propietarios, 68 de ellas con la etiqueta
-- `propietario`. La tabla decía 178 huérfanas donde había 108. Eso es
-- gestión real de clientes; contarla como trabajo sin dueño era una
-- lectura falsa. Lo que se mide es quién atiende, no qué rol tiene.
--
-- LA FILA "SIN ASIGNAR"
--
-- No es `assigned_agent_id IS NULL`. Es todo lo que no tiene detrás a
-- un miembro VIGENTE de la cuenta, sin importar su rol: lo que no tiene
-- dueño Y lo que quedó a nombre de alguien que ya no es miembro. Si
-- nadie lo atiende, es trabajo sin dueño y el dueño de la cuenta tiene
-- que verlo. El historial del que se fue se conserva intacto en
-- `conversation_assignments`: lo que desaparece es su fila, no su
-- pasado.
--
-- EL INVARIANTE QUE AMARRA LAS DOS REGLAS: cada conversación abierta
-- cae en EXACTAMENTE UNA fila, y la suma de la columna cuadra con el
-- total de la cuenta. Por eso la fila no se concede por rol sino por
-- cartera: si a alguien se le contara la cartera y no se le diera fila
-- —o al revés—, la suma dejaría de cuadrar y nadie lo notaría.
--
-- EL PUENTE ENTRE LAS DOS IDENTIDADES
--
-- `conversations.assigned_agent_id` y `messages.sender_id` guardan el
-- id de `auth.users`; `deals.assigned_to` guarda `profiles.id`. No son
-- lo mismo, y cruzarlos directo no da error: da silencio, cero negocios
-- para todo el mundo. Por eso `deals` pasa por `profiles` antes de
-- agruparse.
-- ============================================================
-- El DROP va primero porque `CREATE OR REPLACE` NO puede cambiar el
-- tipo de retorno: las columnas de `RETURNS TABLE` son parte de la
-- firma, y añadir `account_role` falla con "cannot change return type of
-- existing function". Hoy la función no existe en el VPS, pero un stack
-- de desarrollo con la versión anterior aplicada sí la tiene, y una
-- migración que solo funciona la primera vez no es idempotente.
--
-- Perder los privilegios en el DROP no es problema: los GRANT se
-- vuelven a aplicar justo debajo del CREATE.
DROP FUNCTION IF EXISTS agent_performance_metrics();

CREATE OR REPLACE FUNCTION agent_performance_metrics()
RETURNS TABLE (
  agent_user_id              UUID,
  agent_profile_id           UUID,
  full_name                  TEXT,
  -- El rol con el que esta persona está en la cuenta. Va en la salida
  -- porque desde el ajuste del 2026-09-21 la tabla ya no lista solo
  -- asesores: una administradora con cartera sale junto a ellos, y sin
  -- decir por qué está ahí la interfaz miente por omisión. NULL en la
  -- fila "Sin asignar", que no es una persona.
  account_role               account_role_enum,
  is_unassigned              BOOLEAN,
  open_conversations         BIGINT,
  -- De esas conversaciones abiertas, cuántas NO tienen ningún negocio
  -- abierto: clientes conversando que nunca entraron al embudo.
  --
  -- Va como columna y no se deja restar en el cliente porque
  -- `open_deals` y `open_conversations` NO se agrupan por la misma
  -- clave: una por `deals.assigned_to` y la otra por
  -- `conversations.assigned_agent_id`. Un negocio asignado a Juan cuya
  -- conversación es de otro haría que la resta mintiera. Hoy no pasa
  -- —los negocios del traspaso nacen asignados al mismo asesor que
  -- recibe el hilo— pero un número del tablero no debería depender de
  -- que eso siga siendo cierto.
  open_conversations_without_deal BIGINT,
  open_deals                 BIGINT,
  deals_by_stage             JSONB,
  avg_first_response_seconds NUMERIC,
  response_samples           BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
-- Los nombres de `RETURNS TABLE` son variables de plpgsql, y varios
-- chocan con columnas reales: `full_name` y `account_role` están los
-- dos en `profiles`. Dentro de la consulta los alias van con otro
-- nombre y se mapean al final; así la ambigüedad no existe en vez de
-- resolverse por precedencia.
DECLARE
  v_account_id UUID;
  v_role       account_role_enum;
BEGIN
  SELECT p.account_id, p.account_role
    INTO v_account_id, v_role
  FROM profiles p
  WHERE p.user_id = auth.uid();

  -- Sin sesión, sin perfil, o con rol `agent` o `viewer`: cero filas.
  -- Medir el desempeño de los asesores es cosa de quien dirige, no del
  -- medido ni de un rol de supervisión de la cartera.
  IF v_account_id IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RETURN;
  END IF;

  RETURN QUERY
  -- TODOS los miembros de la cuenta, sin filtrar por rol: son ellos los
  -- que hacen que algo NO sea trabajo sin dueño.
  WITH miembros AS (
    SELECT p.id AS profile_id, p.user_id, p.full_name,
           p.account_role, p.created_at
    FROM profiles p
    WHERE p.account_id = v_account_id
  ),

  -- ---- Conversaciones abiertas, por dueño efectivo -----------------
  -- El LEFT JOIN es el que implementa la regla: si el asignado ya no es
  -- miembro de la cuenta, `m.user_id` sale NULL y la conversación cae
  -- en el grupo "Sin asignar".
  -- `sin_negocio` se resuelve acá, sobre la conversación, y no cruzando
  -- los dos conteos después: es la única forma de que el número sea del
  -- hilo y no del dueño del negocio. El `NOT EXISTS` cae justo en el
  -- índice único parcial de más arriba —`(conversation_id) WHERE status
  -- = 'open'`—, que es el que el planificador necesita para resolverlo
  -- como anti-join y no como un barrido por fila.
  conversaciones AS (
    SELECT m.user_id AS owner_user_id,
           NOT EXISTS (
             SELECT 1 FROM deals d
             WHERE d.conversation_id = c.id
               AND d.status = 'open'
           ) AS sin_negocio
    FROM conversations c
    LEFT JOIN miembros m ON m.user_id = c.assigned_agent_id
    WHERE c.account_id = v_account_id
      AND c.status = 'open'
  ),
  conv_agg AS (
    SELECT owner_user_id,
           count(*) AS n,
           count(*) FILTER (WHERE sin_negocio) AS n_sin_negocio
    FROM conversaciones GROUP BY 1
  ),

  -- ---- Negocios abiertos, por dueño efectivo -----------------------
  -- `deals.assigned_to` → `profiles.id` → `profiles.user_id`: el puente
  -- entre las dos identidades. Un negocio sin asignar, o asignado a
  -- quien ya no es asesor, cae en "Sin asignar" por la misma vía que la
  -- conversación.
  negocios AS (
    SELECT m.user_id AS owner_user_id, d.stage_id
    FROM deals d
    LEFT JOIN profiles pa ON pa.id = d.assigned_to
    LEFT JOIN miembros m  ON m.user_id = pa.user_id
    WHERE d.account_id = v_account_id
      AND d.status = 'open'
  ),
  deal_agg AS (
    SELECT owner_user_id, count(*) AS n FROM negocios GROUP BY 1
  ),
  deal_etapa_conteo AS (
    SELECT owner_user_id, stage_id, count(*) AS n FROM negocios GROUP BY 1, 2
  ),
  deal_etapa AS (
    SELECT dec.owner_user_id,
           jsonb_agg(
             jsonb_build_object(
               'stage_id',    s.id,
               'stage_name',  s.name,
               'color',       s.color,
               'pipeline_id', s.pipeline_id,
               'position',    s.position,
               'deals',       dec.n
             )
             ORDER BY s.position, s.name
           ) AS por_etapa
    FROM deal_etapa_conteo dec
    JOIN pipeline_stages s ON s.id = dec.stage_id
    GROUP BY dec.owner_user_id
  ),

  -- ---- Tiempo de primera respuesta ---------------------------------
  --
  -- Acá se separan DOS preguntas que antes iban juntas, y de ahí venía
  -- el defecto:
  --
  --   * ¿CONTESTÓ UN HUMANO? → `cierra_espera`. Basta
  --     `sender_type = 'agent'` y que no lo haya generado la IA. El
  --     cliente dejó de esperar, se sepa o no quién le escribió. Acá
  --     entran los salientes de la API pública v1 (llave de cuenta, sin
  --     persona identificada) y los 143 mensajes de asesor anteriores a
  --     este cambio, que tienen `sender_id` en NULL.
  --
  --   * ¿A QUIÉN SE LE APUNTA LA MUESTRA? → `atribuible`, que además
  --     exige `sender_id`. Sin autor no hay fila a la que sumarla, así
  --     que la espera se cierra pero no se mide. No se le inventa
  --     autoría a nadie.
  --
  -- Los mensajes del bot y de las automatizaciones no son ninguna de
  -- las dos cosas: van con `sender_type = 'bot'` y no tocan el cálculo.
  --
  -- Tampoco un saliente con `status = 'failed'`: nunca le llegó al
  -- cliente, así que no es una respuesta. No cierra la espera ni genera
  -- muestra; el cliente sigue esperando hasta el siguiente saliente que
  -- sí salga. (`status` es NOT NULL desde la 001, por eso basta `<>`.)
  --
  -- El emparejamiento se resuelve en SQL y no trayendo filas a memoria,
  -- que es lo que obliga la decisión de no acotar por fecha.
  mensajes AS (
    SELECT m.id,
           m.conversation_id,
           m.created_at,
           m.sender_id,
           -- CIERRA LA ESPERA: cualquier saliente humano, tenga autor o
           -- no. Que no sepamos QUIÉN contestó no significa que nadie
           -- haya contestado.
           (m.sender_type = 'agent'
            AND m.ai_generated = FALSE
            AND m.status <> 'failed') AS cierra_espera,
           -- ATRIBUIBLE: además sabemos a quién. Solo estas generan
           -- muestra, porque una muestra tiene que ir a la fila de
           -- alguien.
           (m.sender_type = 'agent'
            AND m.ai_generated = FALSE
            AND m.status <> 'failed'
            AND m.sender_id IS NOT NULL) AS atribuible,
           (m.sender_type = 'customer')  AS es_entrante
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.account_id = v_account_id
  ),
  -- `bloque` = cuántas respuestas humanas hubo ANTES de este mensaje.
  -- Con eso, una respuesta y todos los entrantes que la estaban
  -- esperando comparten número de bloque, y el bloque solo avanza
  -- cuando contesta una persona. Que el bot conteste NO cierra el
  -- bloque: por eso, si la IA responde en 16 segundos y el asesor tres
  -- horas después, lo que se mide son las tres horas.
  --
  -- CUENTA `cierra_espera` Y NO `atribuible`, Y ESA DISTINCIÓN ES TODO.
  -- Si el bloque solo avanzara con los salientes que tienen autor, un
  -- mensaje sin autor no cerraría la espera y el siguiente saliente CON
  -- autor heredaría el entrante más viejo sin contestar de toda la
  -- cadena — uno que el mensaje sin autor ya había respondido—. Medido:
  -- un asesor que tardó 120 segundos reales daba 2.937.720 segundos, o
  -- sea 34 días. Y no es un caso de laboratorio: los 143 salientes de
  -- asesor que hay hoy en producción tienen `sender_id` en NULL, así
  -- que al desplegar habría sido el caso NORMAL, no el raro. Sin
  -- ventana de tiempo esas muestras además no envejecen nunca.
  --
  -- La regla, dicha en una línea: no saber quién contestó no es no
  -- haber contestado.
  --
  -- El COALESCE es load-bearing: el marco `ROWS BETWEEN UNBOUNDED
  -- PRECEDING AND 1 PRECEDING` devuelve NULL en la primera fila de cada
  -- conversación, y un NULL ahí rompería el JOIN de abajo — o sea que
  -- se perdería la primera respuesta de cada hilo, en silencio.
  bloques AS (
    SELECT mensajes.*,
           COALESCE(
             SUM(CASE WHEN cierra_espera THEN 1 ELSE 0 END) OVER (
               PARTITION BY conversation_id
               ORDER BY created_at, id
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ), 0
           ) AS bloque
    FROM mensajes
  ),
  -- Desde cuándo esperaba el cliente en cada bloque: el PRIMER entrante
  -- sin contestar. El `min()` es lo que hace que una ráfaga de cinco
  -- mensajes seguidos deje UNA sola muestra y no cinco, y que la espera
  -- se cuente desde que el cliente escribió por primera vez — que es
  -- justamente lo que significa "primera respuesta".
  espera_desde AS (
    SELECT conversation_id, bloque, min(created_at) AS desde
    FROM bloques
    WHERE es_entrante
    GROUP BY 1, 2
  ),
  -- Una muestra por respuesta que efectivamente cerró una espera. Una
  -- respuesta sin entrante pendiente —el asesor escribe dos veces
  -- seguidas, o es él quien abre la conversación— no genera muestra: el
  -- JOIN no encuentra bloque y la deja fuera.
  muestras AS (
    SELECT b.sender_id AS autor,
           EXTRACT(EPOCH FROM (b.created_at - e.desde)) AS segundos
    FROM bloques b
    JOIN espera_desde e
      ON e.conversation_id = b.conversation_id
     AND e.bloque = b.bloque
    WHERE b.atribuible
  ),
  -- Las muestras de quien no se lleva fila no se descartan acá sino en
  -- el JOIN final: no hay dónde ponerlas, y la fila "Sin asignar" no
  -- mide tiempo por definición.
  respuesta AS (
    SELECT autor, avg(segundos) AS promedio, count(*) AS n
    FROM muestras
    GROUP BY 1
  ),

  -- ---- Quién se lleva una fila -------------------------------------
  -- Un `agent` siempre. Cualquier otro miembro, solo si tiene cartera.
  -- Eso deja fuera al owner y a los admins que no atienden, y deja
  -- dentro a la administradora que lleva la campaña de propietarios.
  --
  -- La condición se escribe sobre CUALQUIER rol y no sobre
  -- `IN ('owner','admin')` a propósito: es lo que mantiene el
  -- invariante. Si mañana alguien le asigna conversaciones a un
  -- `viewer`, esas conversaciones dejan de ser "sin asignar" —su dueño
  -- es miembro vigente— y tienen que tener una fila donde caer, o la
  -- suma dejaría de cuadrar sin que nadie lo note.
  con_fila AS (
    SELECT m.*,
           COALESCE(ca.n, 0)             AS n_conv,
           COALESCE(ca.n_sin_negocio, 0) AS n_conv_sin_negocio,
           COALESCE(da.n, 0)             AS n_deals
    FROM miembros m
    LEFT JOIN conv_agg ca ON ca.owner_user_id = m.user_id
    LEFT JOIN deal_agg da ON da.owner_user_id = m.user_id
    WHERE m.account_role = 'agent'
       OR COALESCE(ca.n, 0) > 0
       OR COALESCE(da.n, 0) > 0
  ),

  -- ---- La tabla ----------------------------------------------------
  filas AS (
    SELECT f.user_id      AS u_id,
           f.profile_id   AS p_id,
           f.full_name    AS nombre,
           f.account_role AS rol,
           FALSE          AS sin_asignar,
           f.n_conv,
           f.n_conv_sin_negocio,
           f.n_deals,
           de.por_etapa     AS etapas,
           r.promedio       AS prom,
           COALESCE(r.n, 0) AS n_muestras,
           -- Los asesores primero y el resto después: la tabla es de
           -- asesores, y quien sale por tener cartera es la excepción.
           (f.account_role <> 'agent') AS orden_rol,
           f.created_at AS orden
    FROM con_fila f
    LEFT JOIN deal_etapa de ON de.owner_user_id = f.user_id
    LEFT JOIN respuesta  r  ON r.autor          = f.user_id

    UNION ALL

    -- La fila "Sin asignar". Su tiempo de respuesta va en NULL por
    -- definición y no por falta de datos: no hay asesor a quien medir.
    SELECT NULL, NULL, NULL,
           -- Tipado explícito: en un UNION ALL, un NULL pelado se
           -- resolvería como `text` y la rama de arriba es un enum.
           NULL::account_role_enum,
           TRUE,
           COALESCE((SELECT n FROM conv_agg WHERE owner_user_id IS NULL), 0),
           COALESCE((SELECT n_sin_negocio FROM conv_agg WHERE owner_user_id IS NULL), 0),
           COALESCE((SELECT n FROM deal_agg WHERE owner_user_id IS NULL), 0),
           (SELECT por_etapa FROM deal_etapa WHERE owner_user_id IS NULL),
           NULL,
           0,
           TRUE,
           'infinity'::TIMESTAMPTZ
  )
  -- Primero los `agent`, después quien salga por cartera, y cada grupo
  -- por antigüedad en la cuenta —mismo criterio de desempate que usa el
  -- reparto, para que el orden sea explicable—. "Sin asignar" al final.
  SELECT f.u_id, f.p_id, f.nombre, f.rol, f.sin_asignar,
         f.n_conv, f.n_conv_sin_negocio, f.n_deals,
         f.etapas, f.prom, f.n_muestras
  FROM filas f
  ORDER BY f.sin_asignar, f.orden_rol, f.orden;
END;
$fn$;

ALTER FUNCTION agent_performance_metrics() OWNER TO postgres;

-- Privilegios explícitos, con REVOKE primero: una función nueva le da
-- EXECUTE a PUBLIC por defecto, y acá PUBLIC incluye a `anon`. Mismo
-- criterio que los GRANT de tabla de la 531.
REVOKE ALL ON FUNCTION agent_performance_metrics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION agent_performance_metrics() TO authenticated, service_role;

COMMENT ON FUNCTION agent_performance_metrics() IS
  'Tabla de rendimiento del dashboard, ya agregada: una fila por miembro con rol agent de la cuenta de auth.uid(), una por cualquier otro miembro con cartera asignada, y una fila "Sin asignar" con lo que no tiene detras a ningun miembro vigente. Sin ventana de tiempo. Devuelve cero filas para un rol distinto de owner/admin.';
