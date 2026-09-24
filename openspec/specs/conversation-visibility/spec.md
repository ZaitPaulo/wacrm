# conversation-visibility Specification

## Purpose
Quién ve qué en la bandeja, los contactos y el embudo según su rol, y cómo se aplica desde la base y no solo desde la interfaz.
## Requirements
### Requirement: Visibilidad de conversaciones por rol y asignación

Una conversación SHALL ser visible para un miembro de la cuenta si y solo si su rol es `owner`, `admin` o `viewer`, o si `conversations.assigned_agent_id` es igual al `auth.uid()` de quien consulta. La regla SHALL vivir en la política RLS de la tabla, no en la consulta de la bandeja, porque el listado se arma desde el cliente sin filtro propio.

#### Scenario: El asesor ve solo lo suyo

- **WHEN** un miembro con rol `agent` lista las conversaciones de su cuenta
- **THEN** recibe únicamente aquellas cuyo `assigned_agent_id` es su propio id de usuario

#### Scenario: Lo no asignado es invisible para el asesor

- **WHEN** existe una conversación de la cuenta con `assigned_agent_id` en NULL
- **THEN** un miembro con rol `agent` no la recibe en ninguna consulta, ni por la bandeja ni por acceso directo a su id

#### Scenario: El admin ve todo

- **WHEN** un miembro con rol `owner`, `admin` o `viewer` lista las conversaciones de su cuenta
- **THEN** recibe todas, asignadas y sin asignar, sin importar a quién estén asignadas

#### Scenario: La cuenta ajena sigue fuera

- **WHEN** un miembro con rol `owner` consulta una conversación de otra cuenta que le está asignada por error de datos
- **THEN** no la recibe: la pertenencia a la cuenta sigue siendo condición necesaria

### Requirement: Los mensajes heredan la visibilidad de su conversación

Los mensajes SHALL ser visibles únicamente cuando su conversación lo es. Ninguna consulta SHALL permitir leer el contenido, los adjuntos o las reacciones de un hilo que quien consulta no puede ver.

#### Scenario: Sin acceso al hilo, sin acceso a los mensajes

- **WHEN** un miembro con rol `agent` consulta los mensajes de una conversación que no tiene asignada
- **THEN** recibe cero filas, aunque conozca el id de la conversación

### Requirement: Visibilidad de contactos derivada de sus conversaciones

Un contacto SHALL ser visible para un miembro con rol `agent` únicamente cuando tiene al menos una conversación visible para él. Para `owner`, `admin` y `viewer` todos los contactos de la cuenta SHALL seguir siendo visibles.

#### Scenario: El contacto sigue a su conversación

- **WHEN** un miembro con rol `agent` abre el módulo de contactos
- **THEN** ve solo los contactos con al menos una conversación asignada a él

#### Scenario: El contacto sin conversación es del admin

- **WHEN** existe un contacto sin ninguna conversación asignada, sea porque nunca escribió o porque su conversación quedó sin asignar
- **THEN** ningún miembro con rol `agent` lo ve, ni siquiera quien lo haya creado

#### Scenario: Un canal asignado alcanza

- **WHEN** un contacto tiene conversación de WhatsApp asignada al asesor A y conversación de Instagram asignada al asesor B
- **THEN** ambos ven la ficha del contacto, y cada uno ve solo el hilo de su canal

### Requirement: Visibilidad de negocios derivada de su contacto

Un negocio SHALL ser visible únicamente cuando su contacto lo es. Un negocio sin contacto asociado SHALL seguir las mismas reglas que un contacto sin conversación asignada: solo lo ven `owner`, `admin` y `viewer`.

#### Scenario: El embudo del asesor muestra su cartera

- **WHEN** un miembro con rol `agent` abre un embudo
- **THEN** ve únicamente las tarjetas cuyos contactos le son visibles, y ninguna tarjeta queda con el contacto en blanco

### Requirement: Escritura limitada a lo visible

Un miembro SHALL poder modificar o borrar únicamente las conversaciones, contactos y negocios que puede ver. La restricción SHALL aplicar en la base, no solo en la interfaz, para que una llamada directa a la API con la sesión del asesor obtenga el mismo resultado.

#### Scenario: No se puede escribir lo que no se ve

- **WHEN** un miembro con rol `agent` intenta actualizar por API una conversación que no tiene asignada
- **THEN** la operación no afecta ninguna fila

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

### Requirement: Los eventos en vivo no filtran conversaciones ajenas

La bandeja SHALL descartar los eventos de tiempo real que refieran a conversaciones no visibles para quien mira, sin depender de que el servidor de realtime aplique RLS. La bandeja incorpora conversaciones a la lista directamente desde el payload del evento, así que la guarda del cliente es necesaria aunque la política de la base sea correcta.

#### Scenario: Llega un evento de una conversación ajena

- **WHEN** el canal de tiempo real entrega a un miembro con rol `agent` un evento de una conversación que no tiene asignada
- **THEN** la bandeja lo ignora y la conversación no aparece en la lista

#### Scenario: Le reasignan una conversación mientras mira

- **WHEN** un admin asigna a un miembro con rol `agent` una conversación que él no veía y llega el evento correspondiente
- **THEN** la conversación aparece en su bandeja con el contacto ya resuelto

### Requirement: Los procesos con service-role no quedan restringidos

Los caminos que corren con clave de servicio —webhooks de entrada, motor de automatizaciones, motor de flujos, auto-respuesta de IA y API pública v1— SHALL conservar el alcance de cuenta completa. La visibilidad por asignación SHALL aplicar únicamente a las sesiones de usuario.

#### Scenario: Un mensaje entrante llega a una conversación sin asignar

- **WHEN** el webhook procesa un mensaje de un contacto cuya conversación no tiene asesor
- **THEN** lo registra normalmente, sin que la visibilidad por asignación lo bloquee

