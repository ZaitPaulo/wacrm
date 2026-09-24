# ai-handoff-assignment Specification

## Purpose
A qué asesor va a parar una conversación cuando la IA la transfiere: reparto por carga, aviso al cliente con nombre y notificación al asesor con el contexto.
## Requirements
### Requirement: Una asignación humana existente no se pisa

Cuando la conversación ya tiene un asesor vigente (miembro de la cuenta), el traspaso NO SHALL reasignarla. La conversación conserva su asesor, la IA se pausa, la nota del traspaso se guarda y el asesor SHALL recibir un aviso con la nota ("Tu cliente pidió un asesor"), porque sin cambio de asignación el aviso habitual no se dispara.

#### Scenario: Hilo ya tomado

- **WHEN** la IA transfiere una conversación que ya tiene asesor asignado
- **THEN** la conversación conserva su asesor actual

#### Scenario: El lead que vuelve pide asesor

- **WHEN** la IA, reactivada para un lead que volvió, transfiere su conversación asignada a Juan
- **THEN** la conversación sigue con Juan, Juan recibe un aviso con la nota del traspaso y el cliente recibe el mensaje de que Juan lo va a atender

### Requirement: El cliente sabe quién lo va a atender

El aviso que recibe el cliente al transferirse la conversación SHALL nombrar al asesor asignado, usando su primer nombre.

Cuando no haya asesor asignable, el aviso SHALL conservar la forma anónima, sin prometer un nombre que no existe.

#### Scenario: Con asesor asignado

- **WHEN** la conversación se asigna a un asesor llamado "Juan Marino Arias Medina"
- **THEN** el cliente recibe un aviso que menciona a "Juan"

#### Scenario: Sin asesor disponible

- **WHEN** la cuenta no tiene ningún miembro con rol `agent`
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

### Requirement: La nota del traspaso sobrevive a la reactivación

Cuando un miembro devuelve una conversación al bot, el sistema SHALL conservar la nota del traspaso anterior (`ai_handoff_summary`). Esa nota lleva el motivo y los datos de calificación, y es lo que permite que quien retome el hilo más adelante no empiece de cero.

Un traspaso posterior SHALL reemplazar la nota por la suya, de modo que siempre refleje el último traspaso y no se acumule.

#### Scenario: Reactivar conserva el contexto

- **WHEN** un asesor reactiva la IA en una conversación que traía nota de traspaso
- **THEN** la nota sigue disponible en la conversación

#### Scenario: Un traspaso nuevo reemplaza la nota

- **WHEN** el bot vuelve a transferir una conversación que ya tenía nota
- **THEN** la nota pasa a ser la del traspaso nuevo

### Requirement: La transferencia elige asesor por continuidad del contacto y luego por porcentajes

Cuando la IA transfiere una conversación sin asesor vigente, el sistema SHALL usar la asignación automática unificada (`weighted-auto-assignment`) con origen `ai_handoff`: primero el asesor de continuidad **del contacto** (el último asesor nombrado en el historial de cualquiera de sus conversaciones, si sigue siendo `agent`), y si no hay, el reparto por porcentajes.

La asignación, la pausa de la IA, la nota del traspaso y el negocio SHALL escribirse en una sola transacción.

#### Scenario: La conversación vuelve a quien ya la atendió

- **WHEN** una conversación que tuvo asignada a Juan se devuelve al bot y este la vuelve a transferir
- **THEN** se asigna a Juan

#### Scenario: El contacto ya lo atendió otro asesor por otro canal

- **WHEN** la IA transfiere la conversación de Instagram de un contacto cuya conversación de WhatsApp atendió Brayan
- **THEN** se asigna a Brayan

#### Scenario: Lead nuevo

- **WHEN** la IA transfiere una conversación de un contacto sin historial
- **THEN** se asigna por porcentajes

#### Scenario: La cuenta no tiene ningún agent

- **WHEN** la cuenta solo tiene miembros con rol `admin` y `owner`
- **THEN** la conversación queda en la cola compartida con la IA pausada

