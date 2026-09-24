## ADDED Requirements

### Requirement: Mensaje entrante notifica al asesor asignado
El sistema SHALL crear una notificación de tipo `new_message` para el asesor asignado cada vez que se guarda un mensaje de cliente (`messages.sender_type = 'customer'`) en una conversación con `assigned_agent_id` no nulo. La notificación SHALL llevar la cuenta, la conversación, el contacto, un título con el nombre del contacto y como cuerpo un extracto del mensaje (o una etiqueta del tipo de adjunto si no trae texto). Los mensajes de asesor o de bot, y los de conversaciones sin asesor, NO SHALL generar notificación. Un fallo al crearla NO SHALL impedir guardar el mensaje.

#### Scenario: Cliente escribe en una conversación asignada
- **WHEN** se inserta un mensaje con `sender_type = 'customer'` en una conversación asignada a Angélica
- **THEN** existe una notificación `new_message` para Angélica con esa conversación y el texto del mensaje como cuerpo

#### Scenario: Conversación atendida por el bot
- **WHEN** se inserta un mensaje de cliente en una conversación con `assigned_agent_id` nulo
- **THEN** no se crea ninguna notificación

#### Scenario: Mensaje saliente
- **WHEN** se inserta un mensaje con `sender_type` `agent` o `bot`
- **THEN** no se crea ninguna notificación

#### Scenario: Adjunto sin texto
- **WHEN** el cliente manda una foto sin pie de foto a una conversación asignada
- **THEN** el cuerpo de la notificación es "Foto"

### Requirement: Una sola notificación de mensaje sin leer por conversación
Mientras exista una notificación `new_message` sin leer para el mismo asesor y la misma conversación, un mensaje nuevo SHALL actualizar esa fila (título, cuerpo y `created_at`) en vez de insertar otra. Una vez leída, el siguiente mensaje SHALL crear una fila nueva.

#### Scenario: Ráfaga de mensajes
- **WHEN** el cliente manda tres mensajes seguidos y el asesor no ha leído el aviso
- **THEN** hay una sola notificación `new_message` sin leer para esa conversación, con el cuerpo del último mensaje

#### Scenario: Mensaje después de leer
- **WHEN** el asesor marcó leída la notificación y el cliente vuelve a escribir
- **THEN** se crea una notificación `new_message` nueva sin leer

### Requirement: Envío de push independiente del camino que originó el aviso
Toda notificación nueva sin leer, y toda notificación `new_message` refrescada, SHALL solicitar el envío del push sin que el código que asignó la conversación o guardó el mensaje lo pida. La solicitud SHALL hacerse desde la base de datos de forma asíncrona y después del commit, de modo que un fallo del envío NO SHALL afectar a la transacción que creó la notificación. La latencia objetivo entre la notificación y el envío al servicio de push SHALL ser menor a 5 segundos.

#### Scenario: Asignación por SQL directo
- **WHEN** alguien ejecuta `UPDATE conversations SET assigned_agent_id = …` desde SQL
- **THEN** el trigger existente crea la notificación y se solicita el push a la ruta interna de despacho

#### Scenario: Envío sin configurar
- **WHEN** la URL o el secreto de despacho no están configurados en Vault
- **THEN** la notificación se crea igual y no se lanza ningún error

### Requirement: Despacho idempotente y protegido
La ruta interna de despacho SHALL exigir un secreto compartido comparado en tiempo constante y responder 401 si no coincide y 503 si no está configurado. Cada versión de una notificación (su `id` y su `created_at`) SHALL enviarse como mucho una vez aunque el despacho llegue repetido o coincida con el barrido. SHALL enviar solo a las suscripciones del destinatario de la notificación.

#### Scenario: Despacho repetido
- **WHEN** la ruta recibe dos veces el mismo `notification_id` sin que la notificación haya cambiado
- **THEN** el push se envía una sola vez

#### Scenario: Secreto inválido
- **WHEN** la ruta recibe una petición sin el secreto correcto
- **THEN** responde 401 y no envía nada

### Requirement: Barrido de avisos pendientes
Una ruta de cron protegida con `AUTOMATION_CRON_SECRET` SHALL reclamar y enviar las notificaciones sin leer cuya versión no tenga envío registrado, con antigüedad entre 20 segundos y 15 minutos, para cubrir los despachos perdidos (app reiniciándose, fallo de red interna). Las notificaciones más viejas de 15 minutos NO SHALL enviarse.

#### Scenario: App caída durante el despacho
- **WHEN** la ruta de despacho no respondió y la notificación tiene 1 minuto sin envío registrado
- **THEN** el siguiente barrido la envía una vez

### Requirement: Limpieza de suscripciones muertas
Cuando el servicio de push responda 404 o 410 para una suscripción, el sistema SHALL borrarla. Otros errores SHALL registrarse sin borrar la suscripción.

#### Scenario: Suscripción expirada
- **WHEN** el envío a un endpoint devuelve 410 Gone
- **THEN** la fila de `push_subscriptions` de ese endpoint deja de existir

### Requirement: Contenido del aviso
El push SHALL llevar título, cuerpo, `tag` igual a `conversation-<id>` para las notificaciones con conversación, `renotify` activo, y la URL `/inbox?c=<id>` de la conversación (o `/notifications` si no tiene). El servicio de push SHALL recibir un `Topic` derivado de la conversación, urgencia alta y un TTL acotado, de modo que los avisos no entregados de la misma conversación se reemplacen en vez de acumularse.

#### Scenario: Aviso de asignación
- **WHEN** se despacha una notificación `conversation_assigned` de la conversación C
- **THEN** el payload trae `tag = "conversation-C"`, `renotify = true` y `url = "/inbox?c=C"`
