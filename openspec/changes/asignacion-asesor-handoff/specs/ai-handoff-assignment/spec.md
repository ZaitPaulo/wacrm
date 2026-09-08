## ADDED Requirements

### Requirement: La transferencia elige al asesor con menos carga

Cuando la IA transfiere una conversación y la cuenta no tiene un asesor de derivación configurado, el sistema SHALL asignarla al miembro con menos conversaciones abiertas asignadas en ese momento.

Son candidatos los miembros de la cuenta con rol `agent` o `admin`. El `owner` NO SHALL ser candidato.

Los empates SHALL resolverse por antigüedad en la cuenta, de modo que la elección sea determinista y reproducible.

#### Scenario: Reparto con cargas distintas

- **WHEN** la IA transfiere y un asesor tiene 3 conversaciones abiertas y otro tiene 1
- **THEN** la conversación se asigna al que tiene 1

#### Scenario: Empate entre asesores

- **WHEN** dos asesores tienen la misma cantidad de conversaciones abiertas
- **THEN** se asigna al que lleva más tiempo en la cuenta

#### Scenario: El owner no atiende

- **WHEN** el owner de la cuenta tiene 0 conversaciones abiertas y todos los asesores tienen 2
- **THEN** la conversación se asigna a un asesor, no al owner

#### Scenario: Solo se cuentan las conversaciones abiertas

- **WHEN** un asesor tiene 10 conversaciones cerradas y 0 abiertas, y otro tiene 2 abiertas
- **THEN** la conversación se asigna al primero

### Requirement: El asesor configurado tiene precedencia

Cuando la cuenta tiene `handoff_agent_id` configurado, el sistema SHALL asignar la conversación a ese asesor sin consultar la carga. Una elección explícita del administrador no se sustituye por el reparto automático.

#### Scenario: Asesor fijo configurado

- **WHEN** la cuenta tiene un asesor de derivación configurado y la IA transfiere
- **THEN** la conversación se asigna a ese asesor, aunque sea el más cargado

#### Scenario: Sin asesor configurado

- **WHEN** la cuenta no tiene asesor de derivación configurado
- **THEN** el sistema elige por carga

### Requirement: Una asignación humana existente no se pisa

Cuando la conversación ya tiene un asesor asignado, el sistema NO SHALL reasignarla, ni por reparto ni por asesor configurado.

#### Scenario: Hilo ya tomado

- **WHEN** la IA transfiere una conversación que ya tiene asesor asignado
- **THEN** la conversación conserva su asesor actual

### Requirement: El cliente sabe quién lo va a atender

El aviso que recibe el cliente al transferirse la conversación SHALL nombrar al asesor asignado, usando su primer nombre.

Cuando no haya asesor asignable, el aviso SHALL conservar la forma anónima, sin prometer un nombre que no existe.

#### Scenario: Con asesor asignado

- **WHEN** la conversación se asigna a un asesor llamado "Juan Marino Arias Medina"
- **THEN** el cliente recibe un aviso que menciona a "Juan"

#### Scenario: Sin asesor disponible

- **WHEN** la cuenta no tiene ningún miembro con rol `agent` ni `admin`
- **THEN** la conversación queda en la cola compartida
- **AND** el cliente recibe el aviso sin nombre

### Requirement: El asesor recibe el resumen de lo que busca el cliente

La notificación que recibe el asesor al asignársele una conversación transferida por la IA SHALL incluir el resumen que dejó el bot: motivo de la transferencia, nombre, presupuesto, vehículo de interés y si requiere crédito.

Los datos que el bot no obtuvo SHALL aparecer marcados como faltantes.

La notificación de una asignación hecha por una persona SHALL conservar su texto actual.

#### Scenario: Asignación por transferencia de IA

- **WHEN** la IA transfiere una conversación con nombre, presupuesto, vehículo y crédito recolectados
- **THEN** la notificación del asesor incluye esos cuatro datos y el motivo

#### Scenario: Transferencia urgente con datos incompletos

- **WHEN** la IA transfiere por reclamo, con solo el nombre
- **THEN** la notificación muestra el presupuesto y el vehículo marcados como faltantes

#### Scenario: Asignación hecha por una persona

- **WHEN** un agente asigna manualmente una conversación a otro
- **THEN** la notificación mantiene el texto de asignación entre personas, sin resumen de IA

### Requirement: El resumen interno se lee en español

El resumen que el bot deja en la conversación SHALL estar redactado íntegramente en español, por ser lo que lee el asesor que recibe el hilo.

#### Scenario: Resumen tras una transferencia

- **WHEN** el bot transfiere una conversación después de 2 respuestas
- **THEN** el resumen no contiene texto en inglés
