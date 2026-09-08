# vehicle-lead-attribution Specification

## Purpose
TBD - created by archiving change add-vehicle-sales-dashboard. Update Purpose after archive.
## Requirements
### Requirement: El CTA de la vitrina lleva un código de referencia del vehículo

El enlace de WhatsApp que genera la vitrina pública SHALL incluir, en el texto prellenado, un código corto que identifique al vehículo consultado. El código SHALL ser estable para un mismo vehículo, legible por una persona y suficientemente distintivo como para no confundirse con texto libre del mensaje.

El mensaje SHALL seguir leyéndose de forma natural para el cliente: el código se agrega al texto existente, no lo reemplaza.

#### Scenario: Un visitante pulsa el botón de WhatsApp en una ficha

- **WHEN** un visitante abre la ficha de un vehículo y pulsa el botón de WhatsApp
- **THEN** WhatsApp se abre con un mensaje prellenado que menciona marca, modelo y año, e incluye el código de referencia de ese vehículo

#### Scenario: Dos vehículos distintos generan códigos distintos

- **WHEN** se generan los enlaces de dos vehículos diferentes de la misma cuenta
- **THEN** cada enlace lleva un código distinto

#### Scenario: El botón general de contacto

- **WHEN** un visitante pulsa el botón de WhatsApp de la cabecera o el pie de la vitrina, que no corresponde a ningún vehículo
- **THEN** el enlace se abre sin código de referencia

### Requirement: El mensaje entrante se atribuye al vehículo consultado

Al recibir un mensaje entrante de WhatsApp, el sistema SHALL buscar un código de referencia en su texto y, si lo encuentra y corresponde a un vehículo de la cuenta, SHALL registrar una consulta que vincule ese vehículo con el contacto y la conversación.

El reconocimiento SHALL ser tolerante: SHALL ignorar diferencias de mayúsculas y espacios alrededor del código.

#### Scenario: Llega el mensaje prellenado sin modificar

- **WHEN** llega un mensaje entrante cuyo texto contiene un código de referencia válido de la cuenta
- **THEN** se registra una consulta que vincula ese vehículo con el contacto y la conversación del mensaje

#### Scenario: El cliente edita el mensaje pero conserva el código

- **WHEN** llega un mensaje con texto modificado por el cliente que aún contiene el código
- **THEN** la consulta se registra igual

#### Scenario: El cliente borra el código antes de enviar

- **WHEN** llega un mensaje sin ningún código de referencia
- **THEN** el mensaje se procesa con normalidad y no se registra ninguna consulta, sin inventar una correlación por cercanía temporal

#### Scenario: El código no corresponde a ningún vehículo

- **WHEN** llega un mensaje con un código que no coincide con ningún vehículo de la cuenta
- **THEN** el mensaje se procesa con normalidad y no se registra ninguna consulta

#### Scenario: El mismo cliente pregunta por un segundo vehículo

- **WHEN** un contacto que ya consultó un vehículo envía después un mensaje con el código de otro
- **THEN** se registran ambas consultas de forma independiente

### Requirement: La atribución nunca interrumpe la recepción de mensajes

El registro de la consulta SHALL ser best-effort: cualquier fallo al identificar el vehículo o al persistir la consulta SHALL registrarse como advertencia y NO SHALL impedir que el mensaje entrante se guarde ni que las automatizaciones y respuestas se ejecuten.

#### Scenario: Falla el registro de la consulta

- **WHEN** ocurre un error al persistir la atribución de un mensaje entrante
- **THEN** el mensaje queda guardado y la conversación sigue su curso normal, dejando el fallo registrado en el log

### Requirement: El CTA de pedir fotos también lleva el código de referencia

Cuando la vitrina ofrezca a un visitante pedir las fotos de un vehículo que aún no las tiene, el enlace de WhatsApp que genere SHALL incluir el código de referencia de ese vehículo, con el mismo formato que el CTA de consulta y el de prueba de manejo.

Este CTA existe justamente donde no hay foto, que es donde el cliente más pregunta y donde no hay imagen que sirva de contexto en la conversación: sin el código, esas consultas llegarían sin poder atribuirse a ningún vehículo.

El mensaje SHALL leerse de forma natural —una petición de fotos sobre un vehículo concreto— y el código SHALL ir al final, igual que en los demás CTA.

#### Scenario: Un visitante pide las fotos desde la grilla

- **WHEN** un visitante pulsa la acción de pedir fotos en la tarjeta de un vehículo sin imágenes
- **THEN** WhatsApp se abre con un mensaje que pide las fotos de ese vehículo por marca, modelo y año, e incluye su código de referencia

#### Scenario: Un visitante pide las fotos desde la ficha

- **WHEN** un visitante abre la ficha de un vehículo sin imágenes y pulsa la acción principal
- **THEN** el mensaje prellenado pide las fotos de ese vehículo e incluye su código de referencia

#### Scenario: La consulta de fotos se atribuye al recibirse

- **WHEN** llega el mensaje de petición de fotos con su código de referencia intacto
- **THEN** se registra una consulta que vincula ese vehículo con el contacto y la conversación, igual que cualquier otra consulta con código

#### Scenario: El vehículo sin fotos tampoco tiene código

- **WHEN** un vehículo sin imágenes tampoco tiene código de referencia asignado
- **THEN** el enlace se genera igual, con el mensaje de petición de fotos y sin código, sin bloquear la acción
