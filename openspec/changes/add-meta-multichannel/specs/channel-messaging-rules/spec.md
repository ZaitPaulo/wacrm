## ADDED Requirements

### Requirement: Cada canal declara su ventana de respuesta en un solo lugar

Las reglas de mensajería de cada canal —cuánto dura la ventana para responder libremente y qué se permite fuera de ella— SHALL estar declaradas en un único lugar del sistema, y NO SHALL estar repartidas por el código de envío.

Los plazos y condiciones concretos los fija el proveedor de mensajería y cambian con el tiempo: SHALL tomarse de su documentación vigente al implementar, y poder actualizarse tocando un solo punto.

#### Scenario: El proveedor cambia el plazo de un canal

- **WHEN** cambia la duración de la ventana de un canal
- **THEN** se actualiza en un único lugar y todos los caminos de envío quedan alineados

#### Scenario: Se agrega un canal nuevo

- **WHEN** se incorpora un canal
- **THEN** declara sus propias reglas sin modificar las de los canales existentes

### Requirement: Fuera de la ventana se impide el envío antes de intentarlo

Cuando una respuesta caiga fuera de la ventana permitida del canal, el sistema SHALL impedirla antes de enviarla y SHALL explicar el motivo. NO SHALL intentar el envío para descubrirlo por el rechazo del proveedor.

Cuando el canal ofrezca una alternativa permitida fuera de la ventana, el sistema SHALL indicarla.

#### Scenario: Respuesta dentro de la ventana

- **WHEN** un asesor responde dentro de la ventana del canal
- **THEN** el mensaje se envía con normalidad

#### Scenario: Respuesta fuera de la ventana

- **WHEN** un asesor intenta responder fuera de la ventana
- **THEN** el sistema lo impide, explica que la ventana se cerró e indica la alternativa disponible en ese canal, si la hay

#### Scenario: Automatización fuera de la ventana

- **WHEN** una automatización, un flujo o el asistente con IA intentan responder fuera de la ventana
- **THEN** el envío no se realiza y queda registrado el motivo, sin acumular reintentos contra el proveedor

### Requirement: La ventana se evalúa según el canal de la conversación y quién responde

La verificación de la ventana SHALL usar las reglas del canal al que pertenece la conversación, y SHALL considerar además si quien responde es una persona o un envío automático. No es un criterio único ni depende solo del canal.

En los canales donde el proveedor permite responder más allá de la ventana ordinaria únicamente mediante atención humana, esa extensión SHALL estar disponible para las respuestas de una persona y NUNCA para las de una automatización, un flujo o el asistente con IA.

#### Scenario: Dos canales con ventanas distintas

- **WHEN** un contacto tiene conversaciones abiertas en dos canales con reglas diferentes
- **THEN** cada una se evalúa con las reglas de su propio canal

#### Scenario: Un asesor responde pasada la ventana ordinaria

- **WHEN** una persona responde en un canal que admite la extensión por atención humana, dentro de ese plazo mayor
- **THEN** el mensaje se envía, marcado como atención humana ante el proveedor

#### Scenario: El asistente con IA en ese mismo momento

- **WHEN** el asistente con IA intenta responder esa misma conversación, pasada la ventana ordinaria
- **THEN** el envío se impide, aunque un asesor sí podría responderla

#### Scenario: El asistente con IA evalúa antes de responder

- **WHEN** el asistente con IA va a responder una conversación
- **THEN** consulta la ventana del canal de esa conversación antes de generar el envío

#### Scenario: La extensión no la elige quien redacta el mensaje

- **WHEN** cualquier camino de envío construye una respuesta
- **THEN** la marca de atención humana la decide la puerta de salida a partir de quién envía, y no puede pedirse como parámetro

### Requirement: Lo que solo existe en un canal no se ofrece en los demás

Las funciones propias de un canal —como las plantillas aprobadas de WhatsApp— SHALL ofrecerse únicamente en conversaciones de ese canal.

#### Scenario: Conversación de un canal sin plantillas

- **WHEN** un asesor abre una conversación de un canal que no admite plantillas
- **THEN** esa opción no se le ofrece

#### Scenario: Difusiones

- **WHEN** se prepara una difusión
- **THEN** solo puede dirigirse a canales habilitados para envío masivo, y los contactos sin identidad en ese canal quedan excluidos con su motivo visible
