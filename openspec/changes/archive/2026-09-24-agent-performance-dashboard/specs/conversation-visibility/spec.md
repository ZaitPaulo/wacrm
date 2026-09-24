## MODIFIED Requirements

### Requirement: Reasignación permitida, liberación reservada al admin

Un miembro con rol `agent` SHALL poder cambiar el `assigned_agent_id` de una conversación visible a otro miembro de la misma cuenta, y NO SHALL poder dejarlo en NULL, salvo cuando esa misma operación devuelve la conversación al bot. Los roles `owner` y `admin` SHALL poder asignar y desasignar sin restricción.

Devolver el hilo al bot no es soltarlo: el cliente no queda sin nadie, queda con la IA, que lo atiende y lo vuelve a transferir si hace falta. La excepción SHALL ser estrecha y SHALL mirar la transición —que esa operación sea la que reactiva la IA en el hilo, es decir, que `ai_autoreply_disabled` fuera verdadero antes de ella— y no el estado final, para que una operación que solo borre el asesor en una conversación donde la IA ya estaba activa siga rechazándose.

La regla SHALL aplicarse en el código de los endpoints que cambian la asignación (`PATCH /api/conversations/[id]/assignee` y `POST /api/ai/autoreply/[id]`), antes de escribir, y NO como excepción en la base de datos. Esos endpoints escriben con el cliente de service-role cuando quien actúa es un `agent` que se queda sin la conversación —la política de SELECT de `conversations` rechazaría la fila resultante—, y con service-role ni la RLS ni el trigger `enforce_agent_keeps_assignment` de la migración 520 comprueban nada. El trigger de la 520 SHALL quedar como está, sin excepción de devolución al bot: sigue protegiendo cualquier escritura hecha con la sesión del usuario.

#### Scenario: El asesor pasa la conversación a un compañero

- **WHEN** un miembro con rol `agent` asigna una conversación suya a otro miembro de la cuenta
- **THEN** el cambio se aplica y la conversación desaparece de su bandeja

#### Scenario: El asesor devuelve la conversación al bot

- **WHEN** un miembro con rol `agent` reactiva la IA en una conversación suya, lo que deja el `assigned_agent_id` en NULL
- **THEN** el cambio se aplica, la IA vuelve a atender el hilo y la conversación desaparece de su bandeja

#### Scenario: El asesor no puede soltar la conversación

- **WHEN** un miembro con rol `agent` intenta poner en NULL el `assigned_agent_id` de una conversación suya sin reactivar la IA
- **THEN** la operación se rechaza con un error y la asignación queda intacta

#### Scenario: El asesor no puede soltar una conversación que ya tenía IA activa

- **WHEN** un miembro con rol `agent` pide reactivar la IA (`POST /api/ai/autoreply/[id]` con `paused: false`) en una conversación suya donde la IA ya estaba activa
- **THEN** la operación se rechaza con un error que la interfaz muestra traducido, y la asignación queda intacta

#### Scenario: El admin sí puede dejarla sin asignar

- **WHEN** un miembro con rol `owner` o `admin` pone en NULL el `assigned_agent_id` de cualquier conversación
- **THEN** el cambio se aplica y la conversación deja de ser visible para todos los asesores
