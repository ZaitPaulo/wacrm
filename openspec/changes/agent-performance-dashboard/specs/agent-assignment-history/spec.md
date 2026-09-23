## ADDED Requirements

### Requirement: Cada cambio de asignación queda registrado

El sistema SHALL registrar en un historial append-only cada cambio de `conversations.assigned_agent_id`, guardando la conversación, el asesor saliente, el asesor entrante y el instante del cambio.

El registro SHALL escribirse desde la base de datos mediante un trigger sobre `conversations`, no desde el código de aplicación, de modo que ningún camino de escritura pueda omitirlo: la transferencia de la IA, el motor de automatizaciones, la bandeja, la API v1 y una corrección manual por SQL quedan cubiertos por igual.

El historial SHALL ser inmutable: las filas se insertan y no se actualizan ni se borran al cambiar el estado de la conversación.

#### Scenario: La IA transfiere a un asesor

- **WHEN** la IA transfiere una conversación sin asignar al asesor Juan
- **THEN** se registra una fila con asesor saliente vacío, asesor entrante Juan y el instante del traspaso

#### Scenario: El asesor devuelve el hilo al bot

- **WHEN** Juan reactiva la IA en una conversación suya y el `assigned_agent_id` queda en NULL
- **THEN** se registra una fila con asesor saliente Juan y asesor entrante vacío, y la fila anterior que lo nombraba sigue intacta

#### Scenario: Reasignación entre asesores

- **WHEN** una conversación asignada a Juan pasa a Brayan
- **THEN** se registra una fila con asesor saliente Juan y asesor entrante Brayan

#### Scenario: Una actualización que no toca la asignación no registra nada

- **WHEN** se actualiza `last_message_at` o `unread_count` de una conversación sin cambiar su asesor
- **THEN** no se agrega ninguna fila al historial

#### Scenario: El historial sobrevive al estado actual

- **WHEN** una conversación pasó por Juan y hoy está sin asignar
- **THEN** el historial sigue mostrando que Juan la tuvo, y durante cuánto tiempo

### Requirement: El historial solo lo leen owner y admin

El sistema SHALL restringir la lectura del historial de asignaciones a los miembros con rol `owner` o `admin`. Un miembro con rol `agent` NO SHALL poder leerlo, ni siquiera las filas que lo nombran a él.

La tabla SHALL declarar sus `GRANT` explícitos además de su RLS, porque sin ellos una tabla nueva responde `permission denied` al cliente aunque la política esté bien escrita.

#### Scenario: El dueño consulta el historial

- **WHEN** un miembro con rol `owner` consulta el historial de asignaciones de su cuenta
- **THEN** obtiene todas las filas de la cuenta

#### Scenario: El asesor no accede al historial

- **WHEN** un miembro con rol `agent` consulta el historial
- **THEN** no obtiene ninguna fila

#### Scenario: El historial no cruza cuentas

- **WHEN** un `admin` de una cuenta consulta el historial
- **THEN** solo obtiene filas de conversaciones de su propia cuenta

### Requirement: El registro no puede tumbar la operación

Un fallo al escribir el historial NO SHALL impedir el cambio de asignación ni propagar un error al cliente: perder una fila de estadística es preferible a dejar una conversación sin asesor o a romper el webhook de entrada.

#### Scenario: Fallo escribiendo el historial

- **WHEN** la inserción en el historial falla durante una transferencia de la IA
- **THEN** la conversación queda igualmente asignada al asesor y el cliente recibe su aviso
