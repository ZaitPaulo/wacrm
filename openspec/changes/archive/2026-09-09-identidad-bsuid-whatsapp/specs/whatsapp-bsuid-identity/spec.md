## ADDED Requirements

### Requirement: Un mensaje sin teléfono se recibe igual

Cuando el webhook de WhatsApp entrega un mensaje sin teléfono del remitente, el sistema SHALL usar el identificador de negocio (BSUID) que Meta informa como identidad de esa persona en el canal, y guardar el mensaje como cualquier otro.

Perder a quien escribe por primera vez es lo más caro que puede hacer este sistema. Y son exactamente esas personas las afectadas: Meta omite el teléfono cuando quien escribe adoptó un nombre de usuario y no ha interactuado con el negocio recientemente.

#### Scenario: Primer mensaje de alguien con nombre de usuario

- **WHEN** llega un mensaje cuyo remitente no trae teléfono y sí trae un identificador de negocio
- **THEN** se crea el contacto con ese identificador como su identidad de WhatsApp
- **AND** el contacto queda sin teléfono
- **AND** el mensaje aparece en la bandeja igual que cualquier otro

#### Scenario: La persona vuelve a escribir

- **WHEN** esa misma persona escribe otra vez y sigue sin traer teléfono
- **THEN** el mensaje entra en la conversación que ya existía
- **AND** no se crea un contacto nuevo

### Requirement: Un contacto sin teléfono se puede reconocer

Para un contacto identificado por BSUID, el sistema SHALL conservar y mostrar el nombre de usuario que informa la plataforma.

Un identificador como `CO.4481978948757066` no le dice nada a nadie. Sin el nombre de usuario, el asesor tiene delante una ficha que no puede distinguir de otra, y no hay teléfono con el que buscarla.

#### Scenario: La ficha del contacto

- **WHEN** un asesor abre un contacto que llegó sin teléfono
- **THEN** ve su nombre de usuario
- **AND** la ausencia de teléfono se distingue de un teléfono vacío por error

### Requirement: A un contacto sin teléfono se le puede responder

El sistema SHALL poder enviarle mensajes a un contacto identificado por BSUID, por los mismos caminos que a cualquier otro: respuesta del asesor, respuesta automática de IA, flujos y automatizaciones.

Recibir sin poder responder no es media solución: es cambiar una pérdida silenciosa por una conversación muerta, que además el asesor descubre recién cuando intenta contestar.

#### Scenario: El asesor responde desde la bandeja

- **WHEN** un asesor escribe en la conversación de un contacto sin teléfono
- **THEN** el mensaje llega a esa persona
- **AND** queda guardado en el hilo como cualquier otro envío

#### Scenario: El bot responde solo

- **WHEN** un contacto sin teléfono escribe y la cuenta tiene la respuesta automática activa
- **THEN** el bot le responde

#### Scenario: El envío falla

- **WHEN** el envío a un contacto sin teléfono es rechazado por la plataforma
- **THEN** el error queda visible con el mismo detalle que para cualquier otro envío

### Requirement: La misma persona no se duplica al cambiar de identificación

El sistema SHALL registrar el identificador de negocio de un contacto de WhatsApp aunque su teléfono sí venga en el mensaje, y SHALL resolver al mismo contacto cuando esa persona escriba después sin teléfono.

La plataforma informa ese identificador en todos los mensajes entrantes, tenga la persona nombre de usuario o no. Registrarlo solo cuando falta el teléfono dejaría el problema para después: el día que un cliente conocido active la privacidad, aparecería como una persona nueva, con su historial partido en dos fichas.

#### Scenario: Un cliente conocido activa la privacidad del número

- **WHEN** un contacto que venía escribiendo con su teléfono escribe después sin él, con el mismo identificador de negocio
- **THEN** el mensaje entra en su conversación de siempre
- **AND** no se crea un contacto nuevo

#### Scenario: Un contacto sin teléfono empieza a traerlo

- **WHEN** un contacto que se creó sin teléfono escribe después trayendo su número, con el mismo identificador de negocio
- **THEN** el mensaje entra en su conversación de siempre
- **AND** el contacto queda con su teléfono registrado

#### Scenario: Dos personas distintas siguen siendo dos

- **WHEN** escriben dos personas con identificadores de negocio distintos
- **THEN** son dos contactos

### Requirement: Un identificador que no es un teléfono no se trata como teléfono

El sistema SHALL abstenerse de aplicarle a un identificador de negocio las reglas propias de los números: normalización a dígitos, comparación por los últimos dígitos y reintento por variantes de prefijo troncal.

Esas reglas existen porque las personas escriben su teléfono de muchas formas. Un identificador opaco lo emite la plataforma y llega siempre igual; tratarlo como número puede llegar a hacer coincidir a dos personas distintas por sus dígitos.

#### Scenario: Sin reintento por variantes

- **WHEN** un envío a un contacto identificado por BSUID es rechazado
- **THEN** no se reintenta con variantes del identificador

#### Scenario: Sin coincidencia difusa

- **WHEN** entra un mensaje con un identificador de negocio
- **THEN** la búsqueda del contacto es por coincidencia exacta de ese identificador
