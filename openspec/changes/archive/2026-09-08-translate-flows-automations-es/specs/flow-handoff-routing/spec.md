## ADDED Requirements

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
