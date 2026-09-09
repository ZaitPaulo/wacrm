# inbound-message-durability Specification

## Purpose
Un mensaje entrante no se pierde cuando el procesamiento falla: se guarda antes de confirmarle a la plataforma, y lo que falla se traduce en un reintento de ella en vez de un 200 mentiroso.
## Requirements

### Requirement: Un mensaje entrante se guarda antes de confirmarle a la plataforma

El sistema SHALL persistir el contacto, la conversación y el mensaje entrante **antes** de responderle a la plataforma que lo entregó.

La confirmación es una promesa: la plataforma la interpreta como "este mensaje ya es tuyo" y deja de reintentarlo. Confirmar antes de guardar convierte cualquier fallo posterior en una pérdida definitiva y silenciosa, porque no queda ni la fila ni nadie que vuelva a intentar.

#### Scenario: Recepción normal

- **WHEN** llega un mensaje entrante y la persistencia se completa
- **THEN** el sistema responde `200`
- **AND** el mensaje ya está guardado en el momento en que esa respuesta sale

#### Scenario: La base no responde

- **WHEN** llega un mensaje entrante y la persistencia falla porque no se puede alcanzar la base
- **THEN** el sistema responde con un código distinto de `200`
- **AND** no se pierde el mensaje: la plataforma lo vuelve a entregar según su propia política de reintentos

### Requirement: Un reintento de la plataforma no duplica nada

Cuando la plataforma reentrega un mensaje que ya fue guardado, el sistema SHALL reconocerlo como repetición y responder `200` sin crear una segunda fila, sin volver a contar no leídos y sin volver a disparar flujos, automatizaciones, respuesta de IA ni webhooks públicos.

Sin esta garantía, responder no-200 ante un fallo sería peor que perder el mensaje: cada reintento dejaría un duplicado en la bandeja y volvería a hablarle al cliente.

#### Scenario: La misma entrega llega dos veces

- **WHEN** la plataforma entrega dos veces un mensaje con el mismo identificador de plataforma
- **THEN** queda una sola fila de mensaje
- **AND** la segunda entrega recibe `200`

#### Scenario: Reintento después de un fallo de persistencia

- **WHEN** una entrega falla al guardar, responde no-200, y la plataforma la reintenta
- **THEN** el mensaje queda guardado una sola vez
- **AND** el cliente recibe como máximo una respuesta automática por ese mensaje

### Requirement: Un fallo en la difusión no vuelve a pedir el mensaje

Una vez guardado el mensaje, el sistema SHALL responder `200` aunque falle cualquier trabajo posterior: flujos, automatizaciones, respuesta de IA, webhooks públicos o el evento de conversación creada.

Ese trabajo es lento, habla con servicios de terceros y ya no puede costar el mensaje. Pedirle a la plataforma que reentregue por un fallo de difusión traería de vuelta el mensaje ya guardado, que se reconocería como repetición y no volvería a intentar la difusión: el reintento no arregla nada y sí retrasa la confirmación.

#### Scenario: El proveedor de IA no responde

- **WHEN** el mensaje se guarda correctamente pero la respuesta automática de IA falla
- **THEN** el sistema responde `200`
- **AND** el mensaje sigue visible en la bandeja para que lo atienda una persona

#### Scenario: Un webhook público del cliente está caído

- **WHEN** el mensaje se guarda correctamente pero la entrega a un webhook suscrito falla
- **THEN** el sistema responde `200`

### Requirement: La verificación de medios no decide la respuesta

Cuando un mensaje entrante trae una imagen, un video, un audio o un documento, el sistema SHALL guardar el mensaje aunque la verificación del medio contra la plataforma no se pueda completar.

Verificar un medio es una llamada de red a un tercero. Si esa llamada fuera lo que decide la respuesta, un problema de red del lado de la plataforma haría que el mensaje se reentregue en vez de quedar guardado — y el texto que lo acompaña, que muchas veces es lo que el asesor necesita leer, se perdería con él.

#### Scenario: Foto con pie de foto y verificación fallida

- **WHEN** llega un mensaje con una imagen y su pie de foto, y la verificación del medio contra la plataforma falla
- **THEN** el mensaje queda guardado con su texto
- **AND** el sistema responde `200`

### Requirement: Una entrega que no se puede atribuir a una cuenta se descarta

Cuando el número que recibe el mensaje no corresponde a ninguna configuración conocida, el sistema SHALL responder `200` y registrarlo, sin pedir reintento.

Es un fallo permanente, no transitorio: reintentarlo daría el mismo resultado en cada intento hasta que la plataforma se rinda, y solo llenaría el panel de entregas fallidas con ruido que esconde los fallos que sí importan.

#### Scenario: Número no registrado

- **WHEN** llega una entrega cuyo identificador de número no coincide con ninguna configuración
- **THEN** el sistema responde `200`
- **AND** queda registrado en el log con el identificador que llegó

#### Scenario: Firma inválida

- **WHEN** llega una petición cuya firma no valida
- **THEN** el sistema la rechaza sin procesarla
- **AND** no se guarda ningún mensaje
