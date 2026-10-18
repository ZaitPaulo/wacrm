## MODIFIED Requirements

### Requirement: Los mensajes heredan la visibilidad de su conversación

Las consultas directas a los mensajes SHALL devolver filas únicamente cuando su conversación es visible para quien consulta. Esto cubre la bandeja, el hilo y cualquier lectura de la tabla con la sesión del usuario. La única excepción SHALL ser la lectura en solo lectura desde la hoja de vida del contacto (ver `contact-timeline`): una función de la base que verifica la pertenencia a la cuenta y no habilita ninguna escritura. Ninguna otra vía SHALL permitir leer el contenido, los adjuntos o las reacciones de un hilo no visible.

#### Scenario: Sin acceso al hilo, sin acceso a los mensajes
- **WHEN** un miembro con rol `agent` consulta directamente la tabla de mensajes de una conversación que no tiene asignada
- **THEN** recibe cero filas, aunque conozca el id de la conversación

#### Scenario: Lectura desde la hoja de vida
- **WHEN** un miembro con rol `agent` abre desde la hoja de vida el hilo de una conversación asignada a otro asesor
- **THEN** ve sus mensajes en solo lectura, y la conversación no aparece en su bandeja

#### Scenario: Otra cuenta, ni por la hoja de vida
- **WHEN** un miembro pide por la función de la hoja de vida los mensajes de una conversación de otra cuenta
- **THEN** recibe cero filas

### Requirement: Visibilidad de contactos derivada de sus conversaciones

Los contactos son del negocio. Todo contacto de la cuenta y lo que cuelga de él (etiquetas, campos personalizados, notas, documentos, canales y vínculos de identidad) SHALL ser visible para cualquier miembro de la cuenta, sin importar su rol ni a quién estén asignadas sus conversaciones.

La asignación SHALL seguir determinando lo que el miembro con rol `agent` *atiende*: un contacto se considera "suyo" cuando tiene al menos una conversación asignada a él. Esa relación (`contact_visible`) SHALL seguir gobernando la escritura sobre el contacto, la visibilidad de los negocios en el embudo y el agendamiento de citas.

#### Scenario: El asesor ve todos los contactos del negocio
- **WHEN** un miembro con rol `agent` abre el módulo de contactos
- **THEN** ve todos los contactos de la cuenta, cada uno con el asesor que lo atiende

#### Scenario: El contacto sin conversación también se ve
- **WHEN** existe un contacto sin ninguna conversación asignada
- **THEN** cualquier miembro de la cuenta lo ve y puede abrir su ficha

#### Scenario: Ver no es atender
- **WHEN** un miembro con rol `agent` abre la ficha de un contacto cuya conversación está asignada a otro asesor
- **THEN** ve todos sus datos, notas y documentos, pero no puede editar sus datos y la conversación no aparece en su bandeja

#### Scenario: Un canal asignado alcanza para atender
- **WHEN** un contacto tiene conversación de WhatsApp asignada al asesor A y conversación de Instagram asignada al asesor B
- **THEN** ambos pueden editar la ficha del contacto, y cada uno ve en su bandeja solo el hilo de su canal

#### Scenario: La cuenta ajena sigue fuera
- **WHEN** un miembro consulta un contacto de otra cuenta
- **THEN** no lo recibe

### Requirement: Visibilidad de negocios derivada de su contacto

En el embudo y en cualquier consulta directa a los negocios, un negocio SHALL ser visible para un miembro con rol `agent` únicamente cuando el contacto del negocio tiene al menos una conversación asignada a él. Un negocio sin contacto asociado SHALL ser visible solo para `owner`, `admin` y `viewer`. Los negocios de cualquier contacto SHALL poder leerse desde su hoja de vida (ver `contact-timeline`), sin que eso los agregue al embudo del asesor.

#### Scenario: El embudo del asesor muestra su cartera
- **WHEN** un miembro con rol `agent` abre un embudo
- **THEN** ve únicamente las tarjetas de los contactos que atiende, y ninguna tarjeta queda con el contacto en blanco

#### Scenario: El negocio ajeno se ve en la hoja de vida, no en el embudo
- **WHEN** un `agent` abre la hoja de vida de un contacto con un negocio de otro asesor
- **THEN** ve el negocio y su etapa en la hoja de vida, y ese negocio no aparece en su embudo

### Requirement: Escritura limitada a lo visible

Un miembro SHALL poder modificar o borrar únicamente las conversaciones, contactos y negocios que atiende según la asignación, o todos si su rol es `owner` o `admin`. Ver un contacto por ser del negocio NO SHALL habilitar su escritura. Las excepciones SHALL ser agregar notas y registrar interacciones: cualquier miembro con rol `agent` o superior SHALL poder hacerlo sobre cualquier contacto de su cuenta. La restricción SHALL aplicarse en la base, no solo en la interfaz, para que una llamada directa a la API con la sesión del asesor obtenga el mismo resultado.

#### Scenario: No se puede escribir lo que no se atiende
- **WHEN** un miembro con rol `agent` intenta actualizar por API una conversación o un contacto que no tiene asignado
- **THEN** la operación no afecta ninguna fila

#### Scenario: Nota sobre el cliente de un compañero
- **WHEN** un `agent` agrega una nota a un contacto asignado a otro asesor
- **THEN** la nota se guarda a su nombre y todo el equipo la ve

#### Scenario: Un viewer no escribe notas
- **WHEN** un miembro con rol `viewer` intenta agregar una nota a un contacto
- **THEN** la operación es rechazada
