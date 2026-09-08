# flow-handoff-routing Specification

## Purpose
TBD - created by archiving change flow-handoff-assign-agent. Update Purpose after archive.
## Requirements
### Requirement: El nodo de derivación acepta un agente destino

El formulario del nodo `handoff` en el builder de Flows SHALL ofrecer un selector de agente que persista el `user_id` elegido en `assign_to` dentro del config del nodo. El selector SHALL listar a los miembros de la cuenta por nombre y SHALL permitir dejarlo sin elegir.

#### Scenario: El autor elige un agente

- **WHEN** el autor abre un nodo de derivación, elige un miembro de la cuenta y guarda el flujo
- **THEN** el config del nodo persiste `assign_to` con el `user_id` de ese miembro

#### Scenario: No se puede cargar la lista de miembros

- **WHEN** el listado de miembros de la cuenta no está disponible
- **THEN** el formulario ofrece un campo de texto para ingresar el id del agente a mano, y el flujo sigue siendo editable y guardable

#### Scenario: El agente configurado ya no pertenece a la cuenta

- **WHEN** el autor abre un nodo cuyo `assign_to` apunta a alguien que ya no es miembro
- **THEN** el selector conserva ese valor y lo muestra marcado como desconocido, sin descartarlo al guardar

#### Scenario: Nodo de derivación recién agregado

- **WHEN** el autor agrega un nodo de derivación al flujo
- **THEN** su config arranca con `note` y `assign_to` vacíos, y el flujo sigue siendo activable sin elegir agente

### Requirement: El flujo define un agente de derivación por defecto

Un flujo SHALL poder declarar un agente por defecto para sus derivaciones, persistido como `handoff_assign_to` dentro de `flows.fallback_policy`. El resolutor de la política de fallback SHALL normalizar el valor, tratando cualquier valor ausente, vacío o de tipo no textual como "sin default".

#### Scenario: El autor configura el agente por defecto

- **WHEN** el autor elige un agente por defecto en los ajustes del flujo y guarda
- **THEN** el valor se persiste en `flows.fallback_policy.handoff_assign_to` y sobrevive a recargas del editor

#### Scenario: Flujo anterior a este cambio

- **WHEN** el motor carga un flujo cuya `fallback_policy` no tiene `handoff_assign_to`
- **THEN** la política se resuelve sin default de derivación y el resto de sus campos conserva sus valores

### Requirement: Precedencia al resolver el agente de una derivación explícita

Al ejecutar un nodo `handoff`, el motor SHALL resolver el agente destino tomando primero el `assign_to` del nodo y, si está vacío, el `handoff_assign_to` del flujo. Con un agente resuelto, SHALL escribir `assigned_agent_id` en la conversación aunque ya tuviera otro asignado, porque el nodo es una decisión explícita del autor. Sin agente resuelto, SHALL limitarse a dejar la conversación en `pending`, como hasta ahora.

#### Scenario: El nodo tiene su propio agente

- **WHEN** un run llega a un nodo de derivación con `assign_to` configurado y el flujo además tiene un default distinto
- **THEN** la conversación queda asignada al agente del nodo

#### Scenario: El nodo hereda el default del flujo

- **WHEN** un run llega a un nodo de derivación sin `assign_to` y el flujo tiene `handoff_assign_to`
- **THEN** la conversación queda asignada al agente por defecto del flujo

#### Scenario: No hay ningún agente configurado

- **WHEN** un run llega a un nodo de derivación y ni el nodo ni el flujo declaran agente
- **THEN** la conversación pasa a `pending` sin asignado y el run termina como derivado

#### Scenario: La conversación ya tenía dueño

- **WHEN** un run llega a un nodo de derivación con agente configurado y la conversación ya está asignada a otra persona
- **THEN** la asignación del nodo reemplaza a la existente

### Requirement: La derivación por fallback agotado respeta al dueño actual

Cuando la política de fallback se agota y resuelve en derivación, el motor SHALL asignar la conversación al `handoff_assign_to` del flujo únicamente si la conversación no tiene ya un `assigned_agent_id`. En todos los casos SHALL dejar la conversación en `pending` y cerrar el run como derivado.

#### Scenario: Fallback agotado sobre una conversación sin dueño

- **WHEN** el cliente agota los reintentos de un flujo que declara agente por defecto y la conversación no está asignada
- **THEN** la conversación queda asignada a ese agente y en estado `pending`

#### Scenario: Fallback agotado sobre una conversación ya tomada

- **WHEN** el cliente agota los reintentos y un agente humano ya se había asignado la conversación
- **THEN** la asignación existente se conserva y la conversación solo pasa a `pending`

#### Scenario: Fallback agotado sin agente por defecto

- **WHEN** el cliente agota los reintentos de un flujo que no declara agente por defecto
- **THEN** la conversación pasa a `pending` sin asignado, como hasta ahora

### Requirement: Trazabilidad de la derivación

El evento `handoff` registrado en `flow_run_events` SHALL incluir el agente efectivamente asignado, o `null` cuando no se asignó a nadie.

#### Scenario: Revisar por qué una conversación no llegó a nadie

- **WHEN** alguien inspecciona los eventos de un run que terminó derivado sin asignación
- **THEN** el evento `handoff` muestra `assigned_to: null`, distinguible de un run que sí asignó

### Requirement: La derivación le entrega al agente lo que el cliente respondió

Al derivar, el sistema SHALL dejarle al agente que tome la conversación el contexto que el flujo recolectó, en una superficie que el agente vea mientras atiende, sin tener que abrir el visor de ejecuciones.

Hoy la nota de derivación solo se guarda dentro del evento de log de la ejecución (`src/lib/flows/engine.ts:536`), que es una herramienta de diagnóstico y no algo que un agente consulte al atender. El resultado es que todo lo que el flujo preguntó se pierde en el momento en que más se necesita.

#### Scenario: Agente toma una conversación derivada

- **WHEN** el flujo llega a un nodo de derivación con una nota configurada
- **THEN** el agente asignado ve esa nota junto al contacto mientras atiende la conversación

#### Scenario: Derivación sin nota

- **WHEN** el nodo de derivación no tiene nota configurada
- **THEN** la derivación ocurre igual y no se registra ninguna nota vacía

#### Scenario: La ejecución sigue siendo auditable

- **WHEN** se revisa el visor de ejecuciones de un flujo derivado
- **THEN** el evento de derivación sigue registrando la nota y el agente asignado, como hasta ahora

### Requirement: La nota de derivación resuelve las variables recolectadas

El texto de la nota de derivación SHALL resolver las variables capturadas durante la ejecución antes de entregarse, con las mismas reglas de interpolación que ya usan los nodos de envío de mensaje y de pregunta.

Hoy la nota se persiste cruda: un flujo cuya nota dice `Nuevo prospecto — {{vars.nombre}}` deja al agente esa llave literal en pantalla, no el nombre.

#### Scenario: Nota con variables

- **WHEN** la nota referencia una variable que la ejecución capturó
- **THEN** el agente lee el valor que respondió el cliente, no la llave entre llaves

#### Scenario: Variable nunca capturada

- **WHEN** la nota referencia una variable que esa ejecución no llegó a capturar
- **THEN** la nota se entrega igual, con esa referencia resuelta como vacío, y la derivación no falla

#### Scenario: Nota sin variables

- **WHEN** la nota es texto plano sin referencias
- **THEN** se entrega tal cual
