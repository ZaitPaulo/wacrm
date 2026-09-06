## ADDED Requirements

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
