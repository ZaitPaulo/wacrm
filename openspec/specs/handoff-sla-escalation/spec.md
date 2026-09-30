# handoff-sla-escalation Specification

## Purpose
TBD - created by archiving change bot-fase-2-traspaso-sin-perdidas. Update Purpose after archive.
## Requirements
### Requirement: El tiempo de espera se cuenta en horario de atención

El tiempo que un traspaso lleva sin atender SHALL medirse desde el traspaso (`ai_waiting_agent_since`) o, si ocurrió fuera del horario de atención de la cuenta, desde la siguiente apertura, respetando festivos. Si la cuenta no tiene configurado el horario, el tiempo SHALL contarse de corrido desde el traspaso. Cada plazo se evalúa como tiempo transcurrido desde ese inicio, siempre que el momento de la evaluación esté dentro del horario. Fuera del horario no se envía nada: lo vencido sale en la primera pasada dentro del horario.

#### Scenario: Traspaso de noche

- **WHEN** una conversación se traspasa un martes a las 11:00 p. m. con horario de 8:00 a 18:00
- **THEN** el plazo de 15 minutos vence el miércoles a las 8:15 a. m.

#### Scenario: Traspaso en horario

- **WHEN** una conversación se traspasa un martes a las 10:00 a. m.
- **THEN** el plazo de 15 minutos vence a las 10:15 a. m.

### Requirement: Recordatorio al asesor

Cuando un traspaso sigue en espera (el asesor no ha escrito) y vence el plazo de recordatorio (`assignment_settings.handoff_remind_after_minutes`, 15 por defecto), el sistema SHALL crear una notificación de tipo `handoff_reminder` para el asesor asignado, con el nombre del cliente y el tiempo que lleva esperando. Esa notificación dispara el push como cualquier otra. El recordatorio SHALL enviarse una sola vez por traspaso (`handoff_reminded_at`).

#### Scenario: Juan no ha escrito en 15 minutos

- **WHEN** una conversación asignada a Juan lleva 15 minutos de horario en espera
- **THEN** Juan recibe una notificación "Cliente esperando" con el nombre del cliente
- **AND** no la recibe de nuevo en la siguiente pasada

#### Scenario: Sin asesor asignado

- **WHEN** la conversación en espera quedó en la cola compartida, sin asesor
- **THEN** no hay recordatorio individual
- **AND** el aviso a los administradores sigue su plazo

### Requirement: Aviso a los administradores

Cuando un traspaso sigue en espera y vence el plazo de escalamiento (`assignment_settings.handoff_escalate_after_minutes`, 45 por defecto), el sistema SHALL crear una notificación de tipo `handoff_unattended` para cada miembro de la cuenta con rol `owner` o `admin`, excepto para el propio asesor asignado. La notificación lleva el nombre del cliente, el del asesor y el tiempo de espera. SHALL enviarse una sola vez por traspaso (`handoff_escalated_at`). El sistema MUST NOT reasignar la conversación.

#### Scenario: 45 minutos sin respuesta

- **WHEN** una conversación asignada a Juan lleva 45 minutos de horario en espera
- **THEN** cada owner y admin de la cuenta recibe "Juan no ha atendido a <cliente>"
- **AND** la conversación sigue asignada a Juan

### Requirement: Los plazos se configuran y se pueden apagar

Los dos plazos SHALL configurarse en Ajustes → Asignación, en minutos. Un plazo vacío (`NULL`) SHALL apagar su regla. El de escalamiento MUST ser mayor que el de recordatorio cuando ambos están activos.

#### Scenario: Recordatorio apagado

- **WHEN** `handoff_remind_after_minutes` es `NULL`
- **THEN** no se envían recordatorios
- **AND** el aviso a administradores sigue funcionando

#### Scenario: Plazos inconsistentes

- **WHEN** un administrador guarda 45 de recordatorio y 15 de escalamiento
- **THEN** los ajustes no se guardan y se muestra el error

### Requirement: Un traspaso atendido no avisa

Cuando el asesor escribe o toma el control antes del plazo, `ai_waiting_agent_since` vuelve a `NULL` y el job MUST NOT enviar recordatorios ni avisos de ese traspaso. Un traspaso nuevo en la misma conversación SHALL reiniciar `handoff_reminded_at` y `handoff_escalated_at`.

#### Scenario: El asesor contestó a los 10 minutos

- **WHEN** Juan escribe a los 10 minutos del traspaso
- **THEN** no se envía recordatorio ni aviso

