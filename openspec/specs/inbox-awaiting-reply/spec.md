# inbox-awaiting-reply Specification

## Purpose
TBD - created by archiving change chats-por-responder. Update Purpose after archive.
## Requirements
### Requirement: La espera empieza con el mensaje del cliente
El sistema SHALL marcar una conversación como "Por responder" cuando se guarde un mensaje con `sender_type = 'customer'`, registrando en `awaiting_reply_since` la hora de ese mensaje. Si la conversación ya estaba pendiente, SHALL conservar la hora existente (la espera más antigua).

#### Scenario: Primer mensaje del cliente sin espera previa
- **WHEN** llega un mensaje del cliente a una conversación con `awaiting_reply_since` nulo
- **THEN** `awaiting_reply_since` queda con la hora de ese mensaje

#### Scenario: Varios mensajes seguidos del cliente
- **WHEN** el cliente envía un segundo mensaje y la conversación ya estaba pendiente desde las 10:00
- **THEN** `awaiting_reply_since` sigue en las 10:00

### Requirement: Solo la respuesta de un asesor termina la espera
El sistema SHALL limpiar `awaiting_reply_since` únicamente cuando se guarde un mensaje con `sender_type = 'agent'` y `sender_id` no nulo (enviado por un asesor humano desde el CRM). Los mensajes con `sender_type = 'bot'` (bot de IA, automatizaciones, flujos, recordatorios de citas) y los de `sender_type = 'agent'` sin `sender_id` (API v1) MUST NOT modificarla.

#### Scenario: Responde un asesor
- **WHEN** un asesor envía un mensaje desde la bandeja en una conversación pendiente
- **THEN** `awaiting_reply_since` queda nulo

#### Scenario: Responde el bot
- **WHEN** el bot de IA responde en una conversación pendiente
- **THEN** `awaiting_reply_since` no cambia y el chat sigue "Por responder"

#### Scenario: Mensaje automático o por API
- **WHEN** se guarda un recordatorio de cita, un mensaje de automatización/flujo o un mensaje de la API v1
- **THEN** `awaiting_reply_since` no cambia

### Requirement: Leer no es atender
Abrir una conversación o poner en 0 su `unread_count` MUST NOT modificar `awaiting_reply_since`.

#### Scenario: El asesor abre el chat sin contestar
- **WHEN** un asesor abre una conversación pendiente y la cierra sin enviar nada
- **THEN** el contador de no leídos queda en 0 y la conversación sigue "Por responder"

### Requirement: Marcar como atendido
El sistema SHALL ofrecer en el hilo de una conversación pendiente la acción "Marcar como atendido", que limpia `awaiting_reply_since` sin enviar mensaje. La acción MUST NOT mostrarse cuando la conversación no está pendiente.

#### Scenario: El cliente solo agradeció
- **WHEN** el asesor pulsa "Marcar como atendido" en una conversación pendiente
- **THEN** `awaiting_reply_since` queda nulo y el chat sale del filtro "Por responder"

#### Scenario: El cliente vuelve a escribir después
- **WHEN** una conversación marcada como atendida recibe un nuevo mensaje del cliente
- **THEN** vuelve a quedar "Por responder" desde la hora de ese mensaje

### Requirement: Indicador de espera en la bandeja
Cada conversación pendiente SHALL mostrar en la lista de la bandeja una etiqueta "Esperando · hace X" (X = tiempo transcurrido desde `awaiting_reply_since`), con color según la antigüedad: verde si es menor a 15 minutos, ámbar si es menor a 1 hora y rojo desde 1 hora. Las conversaciones no pendientes MUST NOT mostrar la etiqueta.

#### Scenario: Espera de 40 minutos
- **WHEN** una conversación lleva 40 minutos pendiente
- **THEN** la lista muestra "Esperando · hace 40 minutos" en ámbar

#### Scenario: Conversación atendida
- **WHEN** el último mensaje humano lo envió el asesor
- **THEN** la lista no muestra la etiqueta de espera

### Requirement: Filtro "Por responder"
La bandeja SHALL ofrecer el filtro "Por responder", que muestra solo las conversaciones con `awaiting_reply_since` no nulo, ordenadas de la espera más antigua a la más reciente, y que se combina con el filtro de asesor y los demás filtros de contacto. La opción SHALL mostrar cuántas conversaciones pendientes hay dentro del alcance del filtro de asesor activo.

#### Scenario: Mis pendientes
- **WHEN** el asesor selecciona "Por responder" y en el filtro de asesor se elige a sí mismo
- **THEN** ve solo sus conversaciones pendientes, la que más lleva esperando primero

#### Scenario: Se responde un chat con el filtro activo
- **WHEN** con el filtro "Por responder" activo, un asesor responde una de las conversaciones
- **THEN** esa conversación sale de la lista y el contador baja en uno sin recargar la página

### Requirement: Estado inicial de las conversaciones existentes
Al desplegar, el sistema SHALL calcular `awaiting_reply_since` para las conversaciones con actividad en los últimos 7 días: quedan pendientes las que tienen un mensaje del cliente posterior al último mensaje `agent`, con la hora del primer mensaje del cliente posterior a esa respuesta. Las conversaciones sin actividad en ese periodo SHALL quedar no pendientes.

#### Scenario: Chat de ayer sin respuesta
- **WHEN** se aplica la migración y un cliente escribió ayer sin que ningún asesor contestara después
- **THEN** la conversación queda pendiente desde la hora de ese mensaje

#### Scenario: Chat viejo
- **WHEN** se aplica la migración y la última actividad de la conversación fue hace un mes
- **THEN** la conversación no queda pendiente

