## MODIFIED Requirements

### Requirement: Precedencia al resolver el agente de una derivación explícita

Al ejecutar un nodo `handoff`, el motor SHALL resolver el agente preferido tomando primero el `assign_to` del nodo y, si está vacío, el `handoff_assign_to` del flujo, y SHALL asignar con la asignación automática unificada (origen `flow`): un asesor vigente de la conversación se conserva, el asesor de continuidad del contacto va antes que el preferido, y el preferido va antes que nada más. Sin agente preferido, el flujo NO SHALL repartir por porcentajes: la conversación queda en `pending` con el asesor que tenga (o el de continuidad), como hasta ahora.

El nodo ya NO SHALL reemplazar a un asesor vigente: el asesor de un contacto solo lo cambia un `owner`/`admin` a mano.

#### Scenario: El nodo tiene su propio agente

- **WHEN** un run llega a un nodo de derivación con `assign_to` configurado, el flujo además tiene un default distinto, y la conversación no tiene asesor ni historial
- **THEN** la conversación queda asignada al agente del nodo

#### Scenario: El nodo hereda el default del flujo

- **WHEN** un run llega a un nodo de derivación sin `assign_to`, el flujo tiene `handoff_assign_to` y la conversación no tiene asesor ni historial
- **THEN** la conversación queda asignada al agente por defecto del flujo

#### Scenario: No hay ningún agente configurado

- **WHEN** un run llega a un nodo de derivación y ni el nodo ni el flujo declaran agente, y el contacto no tiene asesor de continuidad
- **THEN** la conversación pasa a `pending` sin asignado y el run termina como derivado

#### Scenario: La conversación ya tenía dueño

- **WHEN** un run llega a un nodo de derivación con agente configurado y la conversación ya está asignada a otro miembro vigente
- **THEN** la asignación existente se conserva y la conversación pasa a `pending`

### Requirement: La derivación por fallback agotado respeta al dueño actual

Cuando la política de fallback se agota y resuelve en derivación, el motor SHALL asignar con la asignación automática unificada (origen `flow`, preferido = `handoff_assign_to` del flujo, sin reparto por porcentajes), lo que conserva un asesor vigente. En todos los casos SHALL dejar la conversación en `pending` y cerrar el run como derivado.

#### Scenario: Fallback agotado sobre una conversación sin dueño

- **WHEN** el cliente agota los reintentos de un flujo que declara agente por defecto y la conversación no está asignada ni el contacto tiene historial
- **THEN** la conversación queda asignada a ese agente y en estado `pending`

#### Scenario: Fallback agotado sobre una conversación ya tomada

- **WHEN** el cliente agota los reintentos y un agente humano ya se había asignado la conversación
- **THEN** la asignación existente se conserva y la conversación solo pasa a `pending`

#### Scenario: Fallback agotado sin agente por defecto

- **WHEN** el cliente agota los reintentos de un flujo que no declara agente por defecto y el contacto no tiene asesor de continuidad
- **THEN** la conversación pasa a `pending` sin asignado, como hasta ahora
