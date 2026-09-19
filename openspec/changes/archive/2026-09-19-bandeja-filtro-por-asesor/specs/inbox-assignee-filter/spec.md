## ADDED Requirements

### Requirement: La bandeja se puede filtrar por asesor

Para los usuarios con permiso de ver todas las conversaciones, la bandeja SHALL ofrecer un filtro por asesor con las opciones: todos, sin asignar, y cada integrante de la cuenta. Cada opción SHALL mostrar cuántas conversaciones de las cargadas le corresponden. El filtro SHALL combinarse con los demás (estado, etiquetas, canal, empresa, búsqueda).

#### Scenario: El dueño filtra por un asesor

- **WHEN** el dueño elige a Brayan en el filtro de asesor
- **THEN** la lista muestra solo las conversaciones con `assigned_agent_id` de Brayan

#### Scenario: Conversaciones sin asesor

- **WHEN** el dueño elige "Sin asignar"
- **THEN** la lista muestra solo las conversaciones sin asesor asignado

#### Scenario: Un asesor no ve el filtro

- **WHEN** un usuario con rol `agent` abre la bandeja
- **THEN** no aparece el filtro de asesor

### Requirement: Cada fila dice quién la atiende

Para los usuarios con permiso de ver todas las conversaciones, cada fila de la lista SHALL mostrar el nombre del asesor asignado, o "Sin asignar" cuando no lo hay. Al reasignar una conversación, la fila SHALL reflejar el cambio sin recargar la página.

#### Scenario: Conversación asignada

- **WHEN** una conversación está asignada a Robinson Orozco
- **THEN** su fila muestra "Robinson Orozco"

#### Scenario: Reasignación en vivo

- **WHEN** el dueño reasigna la conversación abierta a otro asesor
- **THEN** la fila muestra el nuevo nombre sin recargar

### Requirement: La tabla de contactos dice quién atiende a cada contacto

Para los usuarios con permiso de ver todas las conversaciones, la tabla de Contactos SHALL tener una columna "Asesor". Como la asignación vive en la conversación y un contacto puede tener una por canal, la columna SHALL mostrar los asesores de sus conversaciones sin repetir, primero el de la más reciente; "Sin asignar" si tiene conversaciones pero ninguna con asesor; y un guion si no tiene conversaciones.

#### Scenario: Contacto atendido

- **WHEN** el dueño abre Contactos y un contacto tiene su conversación asignada a Caro
- **THEN** la columna Asesor de ese contacto dice "Caro"

#### Scenario: Contacto sin asesor

- **WHEN** un contacto tiene conversación pero sin asesor
- **THEN** la columna dice "Sin asignar"

#### Scenario: Contacto que nunca escribió

- **WHEN** un contacto no tiene conversaciones
- **THEN** la columna muestra un guion

#### Scenario: Un asesor no ve la columna

- **WHEN** un usuario con rol `agent` abre Contactos
- **THEN** la tabla no tiene columna Asesor
