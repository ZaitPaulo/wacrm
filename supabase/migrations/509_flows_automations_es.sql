-- ============================================================
-- 509_flows_automations_es.sql
--
-- Pone en español y hace coherentes los flujos y automatizaciones ya
-- cargados, para el CRM de compraventa de vehículos.
--
-- REGLA GENERAL: un texto se reescribe SOLO si todavía coincide,
-- carácter por carácter, con el inglés de la plantilla original. Si
-- difiere, el operador lo editó y la fila queda intacta. Esa regla es
-- también lo que hace segura la re-ejecución: en la segunda corrida ya
-- nada coincide con el inglés y no se toca nada.
--
-- Tres capas, deliberadamente separadas:
--
--   A. Limpieza de semilla — traducciones bajo la regla general.
--   B. Correcciones autorizadas — cambios sobre configuración que el
--      operador hizo a mano, y que pidió corregir de forma explícita.
--      NO caen bajo la regla general; van marcadas una por una.
--   C. Aditivo — nada se pisa: se agrega.
--
-- No borra filas ni cambia identificadores. Idempotente.
-- ============================================================

-- ============================================================
-- C1. `flow_runs.status` admite 'cancelled'
--
-- Necesario ANTES que nada: el motor ya escribe ese estado al
-- desactivar un flujo, y el CHECK actual lo rechaza. Se distingue de
-- 'timed_out' a propósito — decir "el cliente se quedó callado" de una
-- ejecución que cortó el propio operador es información falsa.
-- ============================================================
DO $$
BEGIN
  ALTER TABLE flow_runs DROP CONSTRAINT IF EXISTS flow_runs_status_check;
  ALTER TABLE flow_runs ADD CONSTRAINT flow_runs_status_check CHECK (status IN (
    'active',
    'completed',
    'handed_off',
    'timed_out',
    'paused_by_agent',
    'failed',
    'cancelled'
  ));
END $$;

-- ============================================================
-- C2. Etiqueta de calificación
--
-- Se crea por cuenta que ya tenga un embudo, sin tocar las etiquetas
-- existentes ("Prospecto" se conserva).
-- ============================================================
INSERT INTO tags (account_id, user_id, name, color)
SELECT DISTINCT p.account_id, p.user_id, 'Calificado', '#16a34a'
FROM pipelines p
WHERE NOT EXISTS (
  SELECT 1 FROM tags t
  WHERE t.account_id = p.account_id AND lower(t.name) = 'calificado'
);

-- ============================================================
-- A1. Etapas del embudo en español
--
-- Solo renombra. `id` y `position` quedan idénticos, así que ningún
-- negocio se mueve de etapa ni cambia de orden.
-- ============================================================
UPDATE pipeline_stages SET name = 'Prospecto nuevo'    WHERE name = 'New Lead';
UPDATE pipeline_stages SET name = 'Calificado'         WHERE name = 'Qualified';
UPDATE pipeline_stages SET name = 'Cotización enviada' WHERE name = 'Proposal Sent';
UPDATE pipeline_stages SET name = 'Negociación'        WHERE name = 'Negotiation';
UPDATE pipeline_stages SET name = 'Vendido'            WHERE name = 'Won';

-- ============================================================
-- A2. Automatizaciones: nombre, descripción y palabras clave
-- ============================================================
UPDATE automations
SET name = 'Mensaje de bienvenida'
WHERE name = 'Welcome Message';

UPDATE automations
SET description = 'Responde al primer mensaje de un contacto nuevo y lo etiqueta.'
WHERE description = 'Auto-reply to first-time contacts with a greeting.';

UPDATE automations
SET name = 'Consulta de precio'
WHERE name = 'Lead Qualifier';

UPDATE automations
SET description = 'Reacciona a quien pregunta por precio o financiación y asigna la conversación.'
WHERE description = 'Ask qualification questions to filter inbound leads.';

-- Palabras clave en español. Las inglesas ("pricing", "quote", "buy")
-- no coincidían nunca con lo que escribe un cliente hispanohablante:
-- esta automatización no se disparó una sola vez.
UPDATE automations
SET trigger_config = jsonb_build_object(
      'keywords', jsonb_build_array('precio', 'cuanto', 'cotizacion', 'financiacion', 'cuota'),
      'match_type', COALESCE(trigger_config->>'match_type', 'contains')
    )
WHERE trigger_type = 'keyword_match'
  AND trigger_config->'keywords' = '["pricing", "quote", "buy"]'::jsonb;

-- ============================================================
-- A3. Textos de los pasos que todavía son la semilla en inglés
-- ============================================================
UPDATE automation_steps
SET step_config = jsonb_set(
      step_config,
      '{text}',
      to_jsonb('¡Hola! 👋 Gracias por escribirnos. En un momento te atiende un asesor.'::text)
    )
WHERE step_type = 'send_message'
  AND step_config->>'text' = 'Hi! 👋 Thanks for reaching out. We''ll get back to you shortly.';

UPDATE automation_steps
SET step_config = jsonb_set(
      step_config,
      '{text}',
      to_jsonb('¡Con gusto te ayudamos! ¿Qué vehículo te interesa? Dime marca, modelo y año, o el código del aviso.'::text)
    )
WHERE step_type = 'send_message'
  AND step_config->>'text' = 'Great — happy to help with pricing! Quick question: roughly how many seats are you looking for?';

-- ============================================================
-- B1. AUTORIZADO — quitar la espera previa a la asignación
--
-- Viene de la semilla original (10 minutos), pero no es una traducción:
-- es un cambio de comportamiento. Asignar diez minutos después llega
-- tarde, cuando alguien ya tomó la conversación a mano.
-- ============================================================
DELETE FROM automation_steps s
WHERE s.step_type = 'wait'
  AND s.step_config = '{"unit": "minutes", "amount": 10}'::jsonb
  AND EXISTS (
    SELECT 1 FROM automations a
    WHERE a.id = s.automation_id
      AND a.trigger_type = 'keyword_match'
  );

-- Cerrar el hueco de posiciones que deja el DELETE, para que el árbol
-- de pasos se siga leyendo en orden.
WITH renumbered AS (
  SELECT id, ROW_NUMBER() OVER (
           PARTITION BY automation_id, parent_step_id, branch
           ORDER BY position
         ) - 1 AS new_position
  FROM automation_steps
)
UPDATE automation_steps s
SET position = r.new_position
FROM renumbered r
WHERE s.id = r.id AND s.position <> r.new_position;

-- ============================================================
-- B2. AUTORIZADO — la asignación vuelve a ser por turnos
--
-- El operador la había fijado a un agente concreto. Con round_robin la
-- conversación se reparte, que es lo que evita que todo caiga en una
-- sola persona.
-- ============================================================
UPDATE automation_steps
SET step_config = jsonb_build_object('mode', 'round_robin')
WHERE step_type = 'assign_conversation'
  AND step_config->>'mode' = 'specific';

-- ============================================================
-- B3. AUTORIZADO — el negocio deja de crearse con cada saludo
--
-- Este paso NO venía de la plantilla: lo agregó el operador. Creaba un
-- negocio de valor fijo 20.000 con cada primer mensaje entrante, antes
-- de saber siquiera qué vehículo buscaba la persona. Se retira de la
-- automatización de bienvenida; el registro del negocio pasa a la
-- plantilla `deal_on_qualified`, disparada por la etiqueta de
-- calificación, que es cuando hay algo que valga un negocio.
--
-- Se retira solo si sigue teniendo el valor fijo delator: si el
-- operador ya lo ajustó, es una decisión suya y se respeta.
-- ============================================================
DELETE FROM automation_steps s
WHERE s.step_type = 'create_deal'
  AND (s.step_config->>'value')::numeric = 20000
  AND EXISTS (
    SELECT 1 FROM automations a
    WHERE a.id = s.automation_id
      AND a.trigger_type = 'first_inbound_message'
  );

-- ============================================================
-- C3. Ejecuciones huérfanas
--
-- Una ejecución viva sobre un flujo que ya no está activo es un cliente
-- esperando una respuesta que no va a llegar — y, por el índice único
-- parcial `idx_one_active_run_per_contact`, ese contacto queda además
-- bloqueado para entrar a cualquier otro flujo.
-- ============================================================
UPDATE flow_runs r
SET status = 'cancelled',
    ended_at = COALESCE(r.ended_at, NOW()),
    end_reason = 'flow_deactivated'
FROM flows f
WHERE r.flow_id = f.id
  AND r.status = 'active'
  AND f.status <> 'active';

-- ============================================================
-- A4. Traducir el flujo existente, SIN rehacer su grafo
--
-- El flujo "Lead capture" no se reemplaza. El operador le agregó un
-- nodo propio ("Transfiriendo a un agente de servicio") y reenrutó
-- `ask_company` para pasar por él: rehacerlo borraría ese trabajo.
--
-- Se traduce nodo por nodo, y solo donde el texto sigue siendo el
-- inglés de la plantilla. El guion nuevo de compraventa entra como un
-- flujo aparte (C4), para que el operador compare y decida.
-- ============================================================
UPDATE flows
SET name = 'Captura de prospecto (heredado)'
WHERE name = 'Lead capture';

UPDATE flows
SET description = 'Guion heredado del CRM original. Reemplazado por «Calificación de prospecto».'
WHERE description = 'Greet first-time inbounds, capture name + email + company, then hand off to sales with the answers in the note.';

UPDATE flow_nodes
SET config = jsonb_set(config, '{text}',
      to_jsonb('¡Bienvenido! 👋 Te hago un par de preguntas rápidas para pasarte con la persona indicada.'::text))
WHERE config->>'text' = 'Welcome! 👋 I''ll ask a few quick questions so we can get you to the right person.';

UPDATE flow_nodes
SET config = jsonb_set(config, '{prompt_text}', to_jsonb('¿Cuál es tu nombre?'::text))
WHERE config->>'prompt_text' = 'What''s your name?';

UPDATE flow_nodes
SET config = jsonb_set(config, '{prompt_text}',
      to_jsonb('¡Gracias {{vars.name}}! ¿Cuál es tu correo?'::text))
WHERE config->>'prompt_text' = 'Thanks {{vars.name}}! What''s your work email?';

UPDATE flow_nodes
SET config = jsonb_set(config, '{prompt_text}',
      to_jsonb('Ya casi — ¿cómo se llama tu empresa?'::text))
WHERE config->>'prompt_text' = 'Almost done — what''s your company name?';

UPDATE flow_nodes
SET config = jsonb_set(config, '{note}',
      to_jsonb('Prospecto nuevo — nombre={{vars.name}}, correo={{vars.email}}, empresa={{vars.company}}.'::text))
WHERE config->>'note' = 'New lead — name={{vars.name}}, email={{vars.email}}, company={{vars.company}}.';

-- ============================================================
-- C4. El guion de calificación de compraventa, como flujo nuevo
--
-- En BORRADOR a propósito: activarlo es decisión del operador después
-- de revisar el guion y elegir la etiqueta de los nodos `set_tag`.
--
-- Se crea una sola vez por cuenta (guardado por nombre).
-- ============================================================
DO $$
DECLARE
  v_account UUID;
  v_user    UUID;
  v_flow    UUID;
  v_tag     UUID;
BEGIN
  FOR v_account, v_user IN
    SELECT DISTINCT f.account_id, f.user_id FROM flows f
  LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM flows
      WHERE account_id = v_account AND name = 'Calificación de prospecto'
    );

    SELECT id INTO v_tag FROM tags
    WHERE account_id = v_account AND lower(name) = 'calificado'
    LIMIT 1;

    INSERT INTO flows (
      account_id, user_id, name, description, status,
      trigger_type, trigger_config, entry_node_id, fallback_policy
    ) VALUES (
      v_account, v_user,
      'Calificación de prospecto',
      'Pregunta vehículo de interés, presupuesto y forma de pago, y deriva al asesor con el resumen. Ajusta los rangos de presupuesto a tu inventario.',
      'draft',
      'first_inbound_message', '{}'::jsonb, 'start',
      -- `handoff_assign_to` NO es opcional en la práctica: sin él la
      -- derivación no asigna a nadie, el aviso "te asignamos un asesor"
      -- se vuelve mentira y —peor— la compuerta del asistente de IA
      -- (`if assigned_agent_id return`) no se activa, así que la IA toma
      -- el mensaje siguiente y repite el mismo aviso. También cubre la
      -- derivación por reintentos agotados, que no pasa por ningún nodo.
      jsonb_build_object(
        'on_unknown_reply', 'reprompt',
        'max_reprompts', 2,
        'on_timeout_hours', 24,
        'on_exhaust', 'handoff',
        'handoff_assign_to', v_user::text
      )
    )
    RETURNING id INTO v_flow;

    INSERT INTO flow_nodes (flow_id, node_key, node_type, config, position_x, position_y) VALUES
      (v_flow, 'start', 'start',
       '{"next_node_key": "saludo"}'::jsonb, 0, 0),

      (v_flow, 'saludo', 'send_buttons', jsonb_build_object(
         'text', '¡Hola! 👋 Gracias por escribirnos. ¿Con qué te ayudamos hoy?',
         'footer_text', 'Toca una opción para continuar.',
         'buttons', jsonb_build_array(
           jsonb_build_object('reply_id','comprar','title','Quiero comprar','next_node_key','compra_vehiculo'),
           jsonb_build_object('reply_id','vender','title','Vendo mi auto','next_node_key','venta_vehiculo'),
           jsonb_build_object('reply_id','otro','title','Otra consulta','next_node_key','otro_handoff')
         )), 0, 170),

      (v_flow, 'compra_vehiculo', 'collect_input', jsonb_build_object(
         'prompt_text', '¿Qué vehículo te interesa? Dime marca, modelo y año, o el código del aviso.',
         'var_key', 'vehiculo_interes',
         'next_node_key', 'compra_presupuesto'), -260, 340),

      -- Rangos derivados del inventario real, en COP. Cada uno tiene
      -- stock que ofrecer; revísalos cuando el stock se corra.
      (v_flow, 'compra_presupuesto', 'send_list', jsonb_build_object(
         'text', '¿En qué rango de presupuesto te mueves?',
         'button_label', 'Ver rangos',
         'sections', jsonb_build_array(jsonb_build_object(
           'title', 'Presupuesto',
           'rows', jsonb_build_array(
             jsonb_build_object('reply_id','presup_1','title','Hasta $60 millones','next_node_key','compra_pago'),
             jsonb_build_object('reply_id','presup_2','title','$60 a $90 millones','next_node_key','compra_pago'),
             jsonb_build_object('reply_id','presup_3','title','$90 a $130 millones','next_node_key','compra_pago'),
             jsonb_build_object('reply_id','presup_4','title','Más de $130 millones','next_node_key','compra_pago'),
             jsonb_build_object('reply_id','presup_0','title','Aún no lo defino','next_node_key','compra_pago')
           )))), -260, 510),

      (v_flow, 'compra_pago', 'send_buttons', jsonb_build_object(
         'text', '¿Cómo piensas pagarlo?',
         'buttons', jsonb_build_array(
           jsonb_build_object('reply_id','contado','title','De contado','next_node_key','compra_calificado'),
           jsonb_build_object('reply_id','credito','title','Con financiación','next_node_key','compra_calificado'),
           jsonb_build_object('reply_id','permuta','title','Entrego mi auto','next_node_key','permuta_vehiculo')
         )), -260, 680),

      (v_flow, 'permuta_vehiculo', 'collect_input', jsonb_build_object(
         'prompt_text', '¿Qué vehículo entregarías? Marca, modelo, año y kilometraje aproximado.',
         'var_key', 'vehiculo_permuta',
         'next_node_key', 'compra_calificado'), -260, 850),

      (v_flow, 'compra_calificado', 'set_tag', jsonb_build_object(
         'mode', 'add',
         'tag_id', COALESCE(v_tag::text, ''),
         'next_node_key', 'compra_handoff'), -260, 1020),

      (v_flow, 'compra_handoff', 'handoff', jsonb_build_object(
         'assign_to', v_user::text,
         'note', 'COMPRA · Busca: {{vars.vehiculo_interes}} · Presupuesto: {{vars.compra_presupuesto}} · Pago: {{vars.compra_pago}} · Entrega en parte de pago: {{vars.vehiculo_permuta}}'), -260, 1190),

      (v_flow, 'venta_vehiculo', 'collect_input', jsonb_build_object(
         'prompt_text', 'Cuéntame qué vehículo vendes: marca, modelo, año y kilometraje.',
         'var_key', 'vehiculo_ofrecido',
         'next_node_key', 'venta_calificado'), 260, 340),

      (v_flow, 'venta_calificado', 'set_tag', jsonb_build_object(
         'mode', 'add',
         'tag_id', COALESCE(v_tag::text, ''),
         'next_node_key', 'venta_handoff'), 260, 510),

      (v_flow, 'venta_handoff', 'handoff', jsonb_build_object(
         'assign_to', v_user::text,
         'note', 'VENTA · Ofrece: {{vars.vehiculo_ofrecido}} · Coordinar valoración.'), 260, 680),

      (v_flow, 'otro_handoff', 'handoff', jsonb_build_object(
         'assign_to', v_user::text,
         'note', 'Consulta general. No entró a la calificación.'), 640, 340);
  END LOOP;
END $$;

-- ============================================================
-- C5. Automatización que registra el negocio al calificar
--
-- Reemplaza al `create_deal` que se retiró en B3. Queda INACTIVA y con
-- la etapa sin elegir: el operador decide en qué etapa entra el
-- prospecto. Sin valor asignado — el presupuesto que declara el cliente
-- es un rango, no un precio.
-- ============================================================
DO $$
DECLARE
  v_account  UUID;
  v_user     UUID;
  v_auto     UUID;
  v_tag      UUID;
  v_pipeline UUID;
  v_stage    UUID;
BEGIN
  FOR v_account, v_user IN
    SELECT DISTINCT a.account_id, a.user_id FROM automations a
  LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM automations
      WHERE account_id = v_account AND name = 'Registrar negocio al calificar'
    );

    SELECT id INTO v_tag FROM tags
    WHERE account_id = v_account AND lower(name) = 'calificado' LIMIT 1;

    SELECT id INTO v_pipeline FROM pipelines
    WHERE account_id = v_account ORDER BY created_at LIMIT 1;

    SELECT id INTO v_stage FROM pipeline_stages
    WHERE pipeline_id = v_pipeline ORDER BY position LIMIT 1;

    INSERT INTO automations (
      account_id, user_id, name, description,
      trigger_type, trigger_config, is_active
    ) VALUES (
      v_account, v_user,
      'Registrar negocio al calificar',
      'Crea el negocio en el embudo cuando el prospecto queda calificado, sin valor asignado.',
      'tag_added',
      jsonb_build_object('tag_id', COALESCE(v_tag::text, '')),
      false
    )
    RETURNING id INTO v_auto;

    INSERT INTO automation_steps (automation_id, step_type, step_config, position)
    VALUES (v_auto, 'create_deal', jsonb_build_object(
      'pipeline_id', COALESCE(v_pipeline::text, ''),
      'stage_id', COALESCE(v_stage::text, ''),
      'title', 'Prospecto calificado',
      'value', 0
    ), 0);
  END LOOP;
END $$;

-- ============================================================
-- C6. Reparación para instalaciones que aplicaron la versión previa
--
-- La primera versión de C4 creaba el flujo SIN agente de derivación y
-- con dos nodos de despedida que hoy sobran. El síntoma en producción:
-- el cliente tocaba una opción, el bot le decía "te asignamos un
-- asesor" y no asignaba a nadie; como la conversación quedaba sin
-- dueño, la compuerta del asistente de IA no se activaba, la IA tomaba
-- el mensaje siguiente y repetía el mismo aviso.
--
-- Idempotente: en un flujo ya correcto no cambia nada.
-- ============================================================
DO $$
DECLARE
  v_flow  UUID;
  v_user  UUID;
BEGIN
  FOR v_flow, v_user IN
    SELECT id, user_id FROM flows WHERE name = 'Calificación de prospecto'
  LOOP
    -- Agente por defecto del flujo.
    UPDATE flows
    SET fallback_policy = fallback_policy || jsonb_build_object('handoff_assign_to', v_user::text)
    WHERE id = v_flow
      AND COALESCE(fallback_policy->>'handoff_assign_to', '') = '';

    -- Destino en cada nodo de derivación que no lo tenga.
    UPDATE flow_nodes
    SET config = config || jsonb_build_object('assign_to', v_user::text)
    WHERE flow_id = v_flow
      AND node_type = 'handoff'
      AND COALESCE(config->>'assign_to', '') = '';

    -- Los nodos de despedida sobran: la derivación ya avisa al cliente,
    -- así que dejarlos produce dos mensajes seguidos diciendo lo mismo.
    -- Primero se reenruta la etiqueta directo a la derivación, y solo
    -- después se borra el nodo, para no dejar el grafo apuntando al
    -- vacío en ningún momento.
    UPDATE flow_nodes
    SET config = jsonb_set(config, '{next_node_key}', to_jsonb('compra_handoff'::text))
    WHERE flow_id = v_flow AND node_key = 'compra_calificado'
      AND config->>'next_node_key' = 'compra_cierre';

    UPDATE flow_nodes
    SET config = jsonb_set(config, '{next_node_key}', to_jsonb('venta_handoff'::text))
    WHERE flow_id = v_flow AND node_key = 'venta_calificado'
      AND config->>'next_node_key' = 'venta_cierre';

    DELETE FROM flow_nodes
    WHERE flow_id = v_flow AND node_key IN ('compra_cierre', 'venta_cierre');
  END LOOP;
END $$;
