# ai-waiting-agent Specification

## Purpose
TBD - created by archiving change bot-fase-2-traspaso-sin-perdidas. Update Purpose after archive.
## Requirements
### Requirement: El traspaso deja la conversación esperando al asesor

Cuando el auto-reply traspasa una conversación a una persona, por decisión del modelo o por fallo técnico, el sistema SHALL marcar la conversación como en espera del asesor (`ai_waiting_agent_since = now()`). También SHALL reiniciar `ai_reply_count` a 0, para que el modo espera tenga su propio cupo. La pausa del bot (`ai_autoreply_disabled = true`) se mantiene como hasta ahora.

#### Scenario: Traspaso con datos completos

- **WHEN** el bot traspasa la conversación con los datos completos
- **THEN** la conversación queda con `ai_autoreply_disabled = true` y `ai_waiting_agent_since` con la hora del traspaso
- **AND** `ai_reply_count` vuelve a 0

### Requirement: En espera, el bot solo acompaña

Mientras la conversación esté en espera del asesor, un mensaje del cliente SHALL recibir respuesta del bot en modo espera. Las demás compuertas se conservan: agrupación de ráfagas, respuesta ya enviada por otro, tope por conversación y límite de la cuenta. El tope en modo espera SHALL ser el menor entre el tope configurado y 6 respuestas.

En modo espera, el bot:
- SHALL responder preguntas concretas sobre el inventario, precios, fotos, ubicación y horario, con los mismos datos y enlaces del bot normal;
- SHALL recordar, si el cliente pregunta por la atención o insiste ("¿hola?", "¿me van a escribir?"), el primer nombre del asesor asignado y cuándo le escribe, según el horario de atención;
- MUST NOT pedir datos de calificación (nombre, presupuesto, crédito, ocupación, ingresos) ni volver a pedir un traspaso;
- SHALL poder no responder nada a un mensaje que no lo necesita ("ok", "gracias", un emoji).

#### Scenario: El cliente pregunta un dato mientras espera

- **WHEN** una conversación en espera recibe "¿ese Aveo tiene aire?"
- **THEN** el bot responde con el dato del vehículo
- **AND** no pregunta el nombre ni el presupuesto

#### Scenario: El cliente insiste de noche

- **WHEN** una conversación en espera asignada a Juan recibe "¿hola? ¿me van a escribir?" a las 11 p. m. de un martes
- **THEN** el bot responde que Juan le escribe mañana desde las 8:00 a. m.

#### Scenario: Un agradecimiento

- **WHEN** una conversación en espera recibe "ok gracias"
- **THEN** el bot puede no enviar nada
- **AND** la conversación sigue en espera

#### Scenario: El modelo vuelve a pedir traspaso

- **WHEN** en modo espera el modelo devuelve el marcador de traspaso
- **THEN** el marcador se ignora: no se reasigna ni se vuelve a enviar el aviso de traspaso

#### Scenario: Se agota el cupo de espera

- **WHEN** el bot ya respondió 6 veces en modo espera
- **THEN** no responde más hasta que el asesor escriba o alguien reactive la IA

### Requirement: La espera termina cuando una persona toma el hilo

`ai_waiting_agent_since` SHALL volver a `NULL`, y con eso el bot se calla del todo en esa conversación, cuando:
- una persona envía un mensaje desde la bandeja (un saliente con `sender_id`);
- alguien usa "Tomar el control" o "Reactivar IA" en la conversación.

Los envíos sin persona detrás (IA, automatizaciones, flujos, difusiones, API v1) MUST NOT terminar la espera.

#### Scenario: El asesor escribe

- **WHEN** Juan envía su primer mensaje desde la bandeja en una conversación en espera
- **THEN** `ai_waiting_agent_since` queda en `NULL`
- **AND** el siguiente mensaje del cliente no recibe respuesta del bot

#### Scenario: Una automatización envía un mensaje

- **WHEN** una automatización envía un mensaje en una conversación en espera
- **THEN** la conversación sigue en espera

### Requirement: El asesor ve que el bot está acompañando

El banner de IA de la conversación SHALL indicar, cuando la conversación está en espera, que el bot responde preguntas simples hasta que el asesor escriba.

#### Scenario: Conversación en espera abierta en la bandeja

- **WHEN** el asesor abre una conversación en espera
- **THEN** el banner dice que el bot está acompañando al cliente hasta que el asesor escriba

