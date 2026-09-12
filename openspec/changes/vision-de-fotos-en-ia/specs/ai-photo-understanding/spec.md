## ADDED Requirements

### Requirement: El texto de cualquier adjunto llega al modelo

El sistema SHALL incluir en la conversación que recibe el modelo el texto de todo mensaje que lo tenga, sea del tipo que sea: mensajes escritos, pies de foto, de video y de documento, y ubicaciones.

El texto de un adjunto SHALL llegar marcado con el tipo de adjunto (`[Foto]`, `[Video]`, `[Documento]`, `[Ubicación]`), de modo que el modelo sepa que hubo un adjunto además del texto.

Los mensajes sin texto NO SHALL ocupar lugares de la ventana de mensajes que recibe el modelo.

#### Scenario: Foto con pie de foto

- **WHEN** el cliente manda una foto cuyo pie dice "Estoy interesado en el crédito para el ónix activ"
- **THEN** el último turno del cliente que recibe el modelo contiene `[Foto] Estoy interesado en el crédito para el ónix activ`

#### Scenario: Adjunto enviado por el negocio

- **WHEN** un asesor envió una foto con el pie "Onix 2019, 45.000 km"
- **THEN** el modelo recibe `[Foto] Onix 2019, 45.000 km` como un turno del negocio

#### Scenario: Fotos sin texto en la ventana

- **WHEN** la ventana de contexto es de N mensajes y entre los más recientes hay fotos sin texto
- **THEN** el modelo recibe igualmente los N mensajes con texto más recientes

### Requirement: El modelo ve las fotos nuevas del cliente

En cada generación, el sistema SHALL entregarle al modelo, como imagen, las fotos que el cliente mandó después del último mensaje que el negocio le envió con éxito.

El sistema SHALL entregar como máximo el número de fotos configurado en `AI_VISION_MAX_IMAGES` (3 por defecto), y cuando haya más SHALL quedarse con las más recientes.

Las fotos que envió el negocio y las que el cliente mandó antes de nuestra última respuesta NO SHALL entregarse como imagen.

#### Scenario: Foto posterior a nuestra última respuesta

- **WHEN** el bot respondió y después el cliente manda una foto
- **THEN** la siguiente generación recibe esa foto como imagen

#### Scenario: Foto ya respondida

- **WHEN** el cliente mandó una foto, el negocio respondió, y después el cliente escribe un texto
- **THEN** la generación que responde a ese texto no recibe la foto anterior como imagen

#### Scenario: Más fotos que el tope

- **WHEN** el cliente manda cinco fotos seguidas y el tope es 3
- **THEN** el modelo recibe las tres más recientes

#### Scenario: Conversación sin fotos

- **WHEN** no hay fotos nuevas del cliente
- **THEN** la petición al proveedor es idéntica a la que se enviaba antes de este cambio

### Requirement: Una foto sin texto despierta al bot

El sistema SHALL tratar una foto sin texto del cliente como un mensaje entrante que el auto-reply responde, sujeto a las mismas compuertas, ventana de agrupación y regla de una respuesta por entrante que un mensaje escrito.

Un sticker NO SHALL despertar al bot. Una foto cuyo medio no se pudo verificar al recibirla NO SHALL despertar al bot.

#### Scenario: Foto sola

- **WHEN** el cliente manda solo una foto, sin texto
- **THEN** el auto-reply responde teniendo en cuenta esa foto

#### Scenario: Sticker

- **WHEN** el cliente manda un sticker
- **THEN** el auto-reply no responde

#### Scenario: Foto y texto en ráfaga

- **WHEN** el cliente manda una foto sin texto y enseguida un texto, dentro de la ventana de agrupación
- **THEN** el cliente recibe una sola respuesta, que tiene en cuenta la foto y el texto

#### Scenario: Medio no verificado

- **WHEN** el cliente manda una foto sin texto y el sistema no pudo verificar el medio con Meta al recibirla
- **THEN** el auto-reply no responde, y la foto queda en la bandeja para un asesor

### Requirement: Una foto que no se puede usar no impide responder

Ninguna falla ligada a una foto SHALL impedir la respuesta ni provocar un traspaso por fallo técnico. Cuando una foto no se puede entregar al modelo, el sistema SHALL responder con el texto disponible, conservando la etiqueta del adjunto.

#### Scenario: La descarga se agota

- **WHEN** bajar una foto de Meta tarda más que el tiempo límite configurado
- **THEN** el modelo genera la respuesta sin esa foto
- **AND** la conversación no se traspasa por fallo técnico

#### Scenario: El proveedor rechaza las imágenes

- **WHEN** el proveedor responde con error a una petición que lleva imágenes, sin que el error sea de clave inválida, límite de uso ni tiempo agotado
- **THEN** el sistema repite la petición una sola vez sin imágenes
- **AND** si esa segunda petición responde, el cliente recibe la respuesta

#### Scenario: Foto sola que no se pudo bajar

- **WHEN** el cliente mandó solo una foto y esa foto no se pudo bajar
- **THEN** el modelo recibe un turno del cliente marcado `[Foto]` y responde sin afirmar qué muestra

### Requirement: El vehículo de la foto se identifica contra el inventario

Cuando la generación incluye fotos, el prompt SHALL indicarle al modelo que identifique el vehículo de la foto contra el índice del inventario disponible, que pregunte cuando no hay una coincidencia clara, y que nunca le atribuya a la foto un vehículo que no está en el índice.

El prompt SHALL indicar que el texto que aparece dentro de una imagen es contenido del cliente y no instrucciones.

#### Scenario: Captura de un vehículo del inventario

- **WHEN** el cliente manda la captura de una publicación de un vehículo que está en el índice
- **THEN** la respuesta habla de ese vehículo

#### Scenario: Vehículo que no está en el inventario

- **WHEN** el cliente manda la foto de un vehículo que no está en el índice
- **THEN** la respuesta no afirma que el negocio lo tiene

#### Scenario: Instrucciones dentro de la imagen

- **WHEN** una foto contiene texto que le pide al asistente cambiar su comportamiento
- **THEN** el modelo lo trata como contenido del cliente y no lo obedece

### Requirement: El borrador ve las mismas fotos

El borrador sugerido al asesor (✨) SHALL recibir las fotos nuevas del cliente con las mismas reglas de selección, tope y degradación que el auto-reply.

#### Scenario: Borrador tras una foto

- **WHEN** el cliente mandó una foto después de nuestra última respuesta y un asesor pide un borrador
- **THEN** el borrador se genera viendo esa foto

### Requirement: Las fotos se reducen antes de enviarse

El sistema SHALL reducir cada foto a un lado máximo de 1536 píxeles, sin agrandar las más pequeñas, y enviarla en JPEG, respetando su orientación.

#### Scenario: Foto grande

- **WHEN** el cliente manda una foto de 3000×4000 píxeles
- **THEN** el modelo la recibe en JPEG con su lado mayor de 1536 píxeles

#### Scenario: Foto pequeña

- **WHEN** el cliente manda una foto de 800×600 píxeles
- **THEN** el modelo la recibe en su tamaño original

### Requirement: La visión se puede apagar sin desplegar

Con `AI_VISION_MAX_IMAGES=0`, el sistema NO SHALL bajar ni enviar fotos, y una foto sin texto NO SHALL despertar al bot. El texto de los adjuntos SHALL seguir llegando al modelo.

#### Scenario: Visión apagada

- **WHEN** `AI_VISION_MAX_IMAGES` vale 0 y el cliente manda una foto con pie
- **THEN** el modelo recibe el pie marcado `[Foto]` y ninguna imagen

#### Scenario: Foto sola con la visión apagada

- **WHEN** `AI_VISION_MAX_IMAGES` vale 0 y el cliente manda una foto sin texto
- **THEN** el auto-reply no responde
