# ai-reply-gating Specification

## Purpose
TBD - created by archiving change gate-ai-auto-reply. Update Purpose after archive.
## Requirements
### Requirement: Exactamente una respuesta por mensaje entrante

El sistema SHALL garantizar que un mensaje entrante del cliente reciba exactamente una respuesta: de una automatización, de un flow, de un agente humano o del auto-reply de IA. El auto-reply de IA SHALL responder si, y solo si, nadie más respondió.

La decisión SHALL basarse en si el cliente **recibió** un mensaje, no en si algún componente estaba configurado para enviarlo.

#### Scenario: Ninguna otra respuesta salió

- **WHEN** llega un mensaje del cliente y ningún otro componente le envía un mensaje
- **THEN** el auto-reply de IA genera y envía una respuesta

#### Scenario: Una automatización ya respondió

- **WHEN** una automatización envía un mensaje al cliente en respuesta a ese entrante
- **THEN** el auto-reply de IA no genera ninguna respuesta
- **AND** no se invoca al proveedor de IA

#### Scenario: Un agente humano respondió primero

- **WHEN** un agente humano envía un mensaje al cliente antes de que el auto-reply genere
- **THEN** el auto-reply de IA no genera ninguna respuesta

### Requirement: Las automatizaciones que no responden no bloquean a la IA

El sistema SHALL permitir que una automatización se ejecute completa —etiquetar, crear deals, actualizar campos, llamar webhooks— sin impedir que el auto-reply de IA responda, siempre que esa automatización no haya enviado un mensaje al cliente.

La sola existencia de una automatización activa con trigger `keyword_match` o `new_message_received` NO SHALL impedir que la IA responda.

#### Scenario: Automatización que solo etiqueta

- **WHEN** una automatización activa con trigger `keyword_match` coincide con el mensaje y ejecuta únicamente acciones que no envían mensajes
- **THEN** la automatización se ejecuta completa
- **AND** el auto-reply de IA responde al cliente

#### Scenario: Automatización activa cuya palabra clave no coincide

- **WHEN** existe una automatización activa con trigger `keyword_match` y el mensaje entrante no contiene ninguna de sus palabras clave
- **THEN** el auto-reply de IA responde al cliente

#### Scenario: El envío de la automatización falló

- **WHEN** una automatización intenta enviar un mensaje y este queda registrado con estado `failed`
- **THEN** el auto-reply de IA responde al cliente, porque el mensaje nunca le llegó

### Requirement: Agrupación de ráfagas de mensajes

El sistema SHALL esperar una ventana de tiempo configurable antes de generar una respuesta, de modo que varios mensajes consecutivos del mismo cliente produzcan una sola respuesta que considere todos ellos.

La ventana SHALL configurarse mediante `AI_REPLY_DEBOUNCE_MS`, con valor por defecto de 8000 milisegundos. Un valor de 0 SHALL desactivar la espera.

#### Scenario: Tres mensajes dentro de la ventana

- **WHEN** el cliente envía tres mensajes separados por menos que la ventana de agrupación
- **THEN** el cliente recibe una sola respuesta
- **AND** se invoca al proveedor de IA exactamente una vez
- **AND** la respuesta tiene en cuenta el contenido de los tres mensajes

#### Scenario: Mensajes separados por más que la ventana

- **WHEN** el cliente envía dos mensajes separados por más que la ventana de agrupación
- **THEN** cada mensaje recibe su propia respuesta

#### Scenario: Mensajes con la misma marca de tiempo

- **WHEN** dos mensajes del cliente llegan con idéntica marca de tiempo, por la precisión de segundos de WhatsApp
- **THEN** exactamente uno de los dos dispara la respuesta, de forma determinista

### Requirement: No gastar presupuesto del proveedor sin responder

El sistema SHALL realizar todas las verificaciones que pueden cancelar una respuesta **antes** de invocar al proveedor de IA, de modo que un dispatch que no va a responder no consuma tokens de la clave del titular de la cuenta.

Se exceptúa el traspaso a humano (`handoff`): determinar que el modelo no puede ayudar exige haberlo invocado.

#### Scenario: Cancelación por mensaje más nuevo

- **WHEN** un dispatch se cancela porque llegó un mensaje más nuevo del cliente
- **THEN** no se invoca al proveedor de IA
- **AND** no se registra consumo en `ai_usage_log`

#### Scenario: Cupo de la conversación agotado

- **WHEN** la conversación alcanzó su límite de respuestas automáticas
- **THEN** no se invoca al proveedor de IA

#### Scenario: Traspaso a humano

- **WHEN** el modelo responde solicitando traspaso a un humano
- **THEN** el consumo de tokens se registra igualmente, porque la llamada al proveedor ocurrió

### Requirement: Las compuertas existentes se conservan

El sistema SHALL mantener sin cambios las condiciones que ya impedían responder: configuración de IA ausente o inactiva, auto-reply deshabilitado en la cuenta, conversación asignada a un agente humano, auto-reply deshabilitado en la conversación tras un traspaso previo, y límite de respuestas por conversación.

Estas comprobaciones SHALL evaluarse **antes** de la ventana de espera, para no mantener ocupada la invocación del webhook en casos que igualmente no responderían.

#### Scenario: Conversación asignada a un humano

- **WHEN** llega un mensaje en una conversación asignada a un agente humano
- **THEN** el auto-reply de IA no responde
- **AND** no se espera la ventana de agrupación

#### Scenario: Auto-reply deshabilitado tras un traspaso

- **WHEN** llega un mensaje en una conversación donde un traspaso previo deshabilitó el auto-reply
- **THEN** el auto-reply de IA no responde

