## REMOVED Requirements

### Requirement: La transferencia elige al asesor con menos carga

**Reason**: El reparto por carga se reemplaza por la continuidad a nivel de contacto y el reparto por porcentajes que configura el dueño (P3).
**Migration**: Ver "La transferencia elige asesor por continuidad del contacto y luego por porcentajes" en esta capacidad y `weighted-auto-assignment`. La migración 539 siembra un reparto parejo entre los `agent` de cada cuenta.

### Requirement: El asesor configurado tiene precedencia

**Reason**: El "asesor fijo" (`ai_configs.handoff_agent_id`) queda subsumido por los porcentajes: un asesor fijo es 100 % a una persona.
**Migration**: La migración 539 convierte un `handoff_agent_id` que apunte a un `agent` en una configuración de 100 % a esa persona. El reparto deja de leer la columna.

## MODIFIED Requirements

### Requirement: Una asignación humana existente no se pisa

Cuando la conversación ya tiene un asesor vigente (miembro de la cuenta), el traspaso NO SHALL reasignarla. La conversación conserva su asesor, la IA se pausa, la nota del traspaso se guarda y el asesor SHALL recibir un aviso con la nota ("Tu cliente pidió un asesor"), porque sin cambio de asignación el aviso habitual no se dispara.

#### Scenario: Hilo ya tomado

- **WHEN** la IA transfiere una conversación que ya tiene asesor asignado
- **THEN** la conversación conserva su asesor actual

#### Scenario: El lead que vuelve pide asesor

- **WHEN** la IA, reactivada para un lead que volvió, transfiere su conversación asignada a Juan
- **THEN** la conversación sigue con Juan, Juan recibe un aviso con la nota del traspaso y el cliente recibe el mensaje de que Juan lo va a atender

## ADDED Requirements

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
