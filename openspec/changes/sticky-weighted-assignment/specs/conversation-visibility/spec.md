## MODIFIED Requirements

### Requirement: Reasignación permitida, liberación reservada al admin

Solo los roles `owner` y `admin` SHALL poder cambiar el `assigned_agent_id` de una conversación, ya sea a otro miembro o a NULL. Un miembro con rol `agent` NO SHALL poder reasignar ni soltar ninguna conversación, tampoco las suyas: el asesor de un contacto es pegajoso (ver `sticky-contact-assignment`).

"Reactivar IA" ya no cambia la asignación, así que devolverle el hilo al bot deja de ser una forma de soltarlo y no necesita excepción. "Tomar el control" solo asigna a quien lo pulsa cuando la conversación no tenía asesor; nunca reemplaza a uno existente.

Los endpoints que tocan la asignación (`PATCH /api/conversations/[id]/assignee` y `POST /api/ai/autoreply/[id]`) SHALL escribir con la sesión del usuario, sin service-role. El trigger `enforce_agent_keeps_assignment` de la migración 520 SHALL quedar como está.

#### Scenario: El asesor no puede pasar la conversación a un compañero

- **WHEN** un miembro con rol `agent` intenta asignar una conversación suya a otro miembro de la cuenta
- **THEN** la operación se rechaza con 403 y la asignación queda intacta

#### Scenario: El asesor devuelve la conversación al bot sin soltarla

- **WHEN** un miembro con rol `agent` reactiva la IA en una conversación suya
- **THEN** la IA vuelve a atender el hilo y la conversación sigue asignada a él

#### Scenario: El asesor no puede soltar la conversación

- **WHEN** un miembro con rol `agent` intenta poner en NULL el `assigned_agent_id` de una conversación suya
- **THEN** la operación se rechaza con 403 y la asignación queda intacta

#### Scenario: Tomar el control no reemplaza al asesor

- **WHEN** un `admin` pulsa "Tomar el control" en una conversación asignada a Juan
- **THEN** la IA se pausa y la conversación sigue asignada a Juan

#### Scenario: El admin sí puede reasignar y dejarla sin asignar

- **WHEN** un miembro con rol `owner` o `admin` cambia o pone en NULL el `assigned_agent_id` de cualquier conversación
- **THEN** el cambio se aplica

### Requirement: La interfaz no ofrece lo que la base va a negar

La interfaz SHALL ocultar al rol `agent` las acciones que el sistema rechazaría: el desplegable de asignación del encabezado del hilo (el `agent` ve el nombre del asesor como texto, sin control), el alta de contactos y la importación de contactos. Estas guardas SHALL ser cosméticas; la frontera real SHALL seguir siendo la RLS y las comprobaciones de los endpoints.

#### Scenario: El asesor no ve el control de asignación

- **WHEN** un miembro con rol `agent` abre una conversación suya
- **THEN** ve su nombre como asesor, sin desplegable para reasignar ni opción de soltar

#### Scenario: El admin conserva el desplegable

- **WHEN** un miembro con rol `admin` abre una conversación
- **THEN** ve el desplegable con los miembros y la opción de dejarla sin asignar

#### Scenario: El asesor no da de alta contactos

- **WHEN** un miembro con rol `agent` abre el módulo de contactos
- **THEN** no se le ofrecen el alta manual ni la importación, porque el contacto resultante no le sería visible
