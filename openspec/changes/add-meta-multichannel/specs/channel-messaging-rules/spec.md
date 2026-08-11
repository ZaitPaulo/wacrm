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

### Requirement: La ventana se evalúa según el canal de la conversación

La verificación de la ventana SHALL usar las reglas del canal al que pertenece la conversación, no un criterio único.

#### Scenario: Dos canales con ventanas distintas

- **WHEN** un contacto tiene conversaciones abiertas en dos canales con reglas diferentes
- **THEN** cada una se evalúa con las reglas de su propio canal

#### Scenario: El asistente con IA evalúa antes de responder

- **WHEN** el asistente con IA va a responder una conversación
- **THEN** consulta la ventana del canal de esa conversación antes de generar el envío

### Requirement: Lo que solo existe en un canal no se ofrece en los demás

Las funciones propias de un canal —como las plantillas aprobadas de WhatsApp— SHALL ofrecerse únicamente en conversaciones de ese canal.

#### Scenario: Conversación de un canal sin plantillas

- **WHEN** un asesor abre una conversación de un canal que no admite plantillas
- **THEN** esa opción no se le ofrece

#### Scenario: Difusiones

- **WHEN** se prepara una difusión
- **THEN** solo puede dirigirse a canales habilitados para envío masivo, y los contactos sin identidad en ese canal quedan excluidos con su motivo visible
