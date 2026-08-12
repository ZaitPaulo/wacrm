## ADDED Requirements

### Requirement: El cliente recibe una sola respuesta automática por evento entrante

Ante un mismo mensaje entrante, el sistema SHALL enviarle al cliente como máximo una respuesta automática, sin importar cuántos motores hayan reaccionado a ese evento.

Esta garantía SHALL sostenerse sobre el contenido configurado, no sobre un cambio en el despacho del webhook. El despacho actual es correcto y deliberado: los disparadores *de contenido* (`new_message_received`, `keyword_match`, `interactive_reply`) se suprimen cuando un flujo consume el mensaje, y los disparadores *de relación* (`new_contact_created`, `first_inbound_message`) siguen disparando, porque hablan de **quién** escribe y no de **qué** escribió.

#### Scenario: Contacto nuevo con flujo y automatización en el mismo disparador

- **WHEN** un contacto escribe por primera vez y existen a la vez un flujo activo y una automatización activa que disparan con el primer mensaje entrante
- **THEN** el cliente recibe únicamente el mensaje del flujo

#### Scenario: Los efectos silenciosos sí ocurren

- **WHEN** se da la situación anterior
- **THEN** la automatización igualmente ejecuta sus pasos que no envían mensajes, como etiquetar el contacto

#### Scenario: Sin flujo activo

- **WHEN** un contacto escribe por primera vez y no hay ningún flujo activo para ese disparador
- **THEN** la automatización sí le envía su mensaje de bienvenida

### Requirement: En el primer contacto el flujo conversa y la automatización actúa

Cuando un flujo activo y una automatización activa comparten un disparador de relación, el flujo SHALL ser el único que le hable al cliente, y la automatización SHALL limitarse a efectos que el cliente no percibe: etiquetar, registrar negocios, actualizar campos del contacto o notificar por webhook.

#### Scenario: Reparto de responsabilidades en el primer contacto

- **WHEN** se revisa la configuración entregada con este cambio
- **THEN** el flujo de calificación es el que saluda y pregunta
- **AND** la automatización del primer contacto solo etiqueta, sin enviar mensajes

### Requirement: El builder advierte del conflicto antes de activar

Al activar una automatización que envía mensajes con un disparador de relación, el sistema SHALL advertir cuando exista un flujo activo que use ese mismo disparador, e SHALL identificar el flujo en conflicto por su nombre.

La advertencia SHALL ser una advertencia y no un error: el operador puede tener una razón para querer ambos, y el sistema no le SHALL impedir activarla.

#### Scenario: Conflicto detectado al activar

- **WHEN** el operador activa una automatización con un paso de envío de mensaje cuyo disparador coincide con el de un flujo activo
- **THEN** el builder advierte que el cliente recibirá dos mensajes y nombra el flujo en conflicto

#### Scenario: La advertencia no bloquea

- **WHEN** el operador decide continuar pese a la advertencia
- **THEN** la automatización se activa

#### Scenario: Automatización silenciosa

- **WHEN** la automatización que se activa no tiene ningún paso que envíe mensajes al cliente
- **THEN** no se emite advertencia alguna, aunque comparta disparador con un flujo activo

#### Scenario: El flujo en conflicto está en borrador

- **WHEN** el flujo que comparte disparador no está activo
- **THEN** no se emite advertencia, porque un flujo en borrador no responde

### Requirement: Ninguna ejecución queda activa sobre un flujo que ya no responde

El sistema SHALL NOT dejar ejecuciones en estado activo cuando su flujo deja de estar activo. Una ejecución viva sobre un flujo que ya no atiende es un cliente esperando una respuesta que nunca va a llegar.

#### Scenario: Flujo pasa a borrador con ejecuciones vivas

- **WHEN** un flujo activo vuelve a borrador o se archiva
- **THEN** sus ejecuciones en curso se cierran, quedando registradas con el motivo del cierre

#### Scenario: Ejecuciones huérfanas ya existentes

- **WHEN** se aplica este cambio
- **THEN** las ejecuciones que hoy están activas sobre flujos que no están activos quedan cerradas
