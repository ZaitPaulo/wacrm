## MODIFIED Requirements

### Requirement: En espera, el bot solo acompaña

Mientras la conversación esté en espera del asesor, un mensaje del cliente SHALL recibir respuesta del bot en modo espera **solo si llega fuera del horario de atención de la cuenta**. Dentro del horario de atención (franjas de `accounts.business_hours`, festivos colombianos excluidos), y con el presupuesto en horario encendido para la cuenta, el bot MUST NOT responder en modo espera ni retomar la conversación: el cliente espera al asesor. Sin horario configurado, o con el presupuesto en horario apagado, el comportamiento es el de siempre en todo momento.

Las demás compuertas se conservan: agrupación de ráfagas, respuesta ya enviada por otro, tope por conversación y límite de la cuenta. El tope en modo espera SHALL ser el menor entre el tope configurado y 6 respuestas.

En modo espera, el bot:
- SHALL responder preguntas concretas sobre el inventario, precios, fotos, ubicación y horario, con los mismos datos y enlaces del bot normal;
- SHALL recordar, si el cliente pregunta por la atención o insiste ("¿hola?", "¿me van a escribir?"), el primer nombre del asesor asignado y cuándo le escribe, según el horario de atención;
- MUST NOT pedir datos de calificación (nombre, presupuesto, crédito, ocupación, ingresos) ni volver a pedir un traspaso;
- SHALL poder no responder nada a un mensaje que no lo necesita ("ok", "gracias", un emoji).

#### Scenario: El cliente pregunta un dato mientras espera

- **WHEN** una conversación en espera recibe "¿ese Aveo tiene aire?" fuera del horario de atención
- **THEN** el bot responde con el dato del vehículo
- **AND** no pregunta el nombre ni el presupuesto

#### Scenario: El cliente pregunta en horario laboral mientras espera

- **WHEN** una conversación en espera recibe "¿ese Aveo tiene aire?" un martes a las 10:00, con el presupuesto en horario encendido
- **THEN** el bot no responde ni llama al proveedor
- **AND** la conversación sigue en espera y los avisos de plazo al asesor siguen corriendo

#### Scenario: Espera iniciada en horario, el cliente escribe de noche

- **WHEN** una conversación traspasada a las 16:00 recibe un mensaje a las 21:00 del mismo día
- **THEN** el bot responde en modo espera

#### Scenario: Festivo

- **WHEN** una conversación en espera recibe un mensaje a las 10:00 de un lunes festivo
- **THEN** el bot responde en modo espera, porque el festivo está fuera del horario de atención

#### Scenario: El cliente insiste de noche

- **WHEN** una conversación en espera asignada a Juan recibe "¿hola? ¿me van a escribir?" a las 11 p. m. de un martes
- **THEN** el bot responde que Juan le escribe mañana desde las 8:00 a. m.

#### Scenario: Un agradecimiento

- **WHEN** una conversación en espera recibe "ok gracias" fuera del horario de atención
- **THEN** el bot puede no enviar nada
- **AND** la conversación sigue en espera

#### Scenario: El modelo vuelve a pedir traspaso

- **WHEN** en modo espera el modelo devuelve el marcador de traspaso
- **THEN** el marcador se ignora: no se reasigna ni se vuelve a enviar el aviso de traspaso

#### Scenario: Se agota el cupo de espera

- **WHEN** el bot ya respondió 6 veces en modo espera
- **THEN** no responde más hasta que el asesor escriba o alguien reactive la IA

#### Scenario: Presupuesto en horario apagado

- **WHEN** la cuenta tiene el presupuesto en horario apagado y una conversación en espera recibe un mensaje en horario laboral
- **THEN** el bot responde en modo espera, como antes de este cambio
