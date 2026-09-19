# ai-ad-lead-context Specification

## Purpose
TBD - created by archiving change bot-prospectos-de-anuncios. Update Purpose after archive.
## Requirements
### Requirement: El origen publicitario del mensaje se guarda

Cuando un mensaje entrante de WhatsApp trae el objeto `referral` de Meta, el sistema SHALL guardarlo junto al mensaje: tipo de origen, id del origen, URL, titular, texto, tipo de medio y `ctwa_clid`.

Un `referral` incompleto o con campos inesperados NO SHALL impedir que el mensaje se guarde.

#### Scenario: Mensaje desde un anuncio con clic a WhatsApp

- **WHEN** llega un mensaje con `referral.source_type = "ad"`, titular y texto
- **THEN** el mensaje queda guardado con ese origen
- **AND** el resto del procesamiento del mensaje ocurre igual que para cualquier otro

#### Scenario: Mensaje sin referral

- **WHEN** llega un mensaje sin `referral`
- **THEN** el mensaje se guarda sin origen publicitario

#### Scenario: Referral con campos faltantes

- **WHEN** llega un mensaje cuyo `referral` solo trae `source_type` y `source_id`
- **THEN** el mensaje se guarda con esos dos campos y los demás vacíos

### Requirement: La IA conoce el anuncio del que viene el prospecto

Cuando el primer mensaje de la conversación, o cualquier mensaje reciente del cliente, trae origen publicitario, el sistema SHALL decirle al modelo que el cliente llegó desde un anuncio e incluir el titular y el texto del anuncio.

El prompt SHALL indicar que un mensaje genérico como "¿Puedo obtener más información sobre esto?" se refiere a ese anuncio, y que el modelo lo responde presentando lo que ofrece LoraMotors según el anuncio y preguntando qué busca el cliente.

#### Scenario: Prospecto de anuncio pide más información

- **WHEN** un cliente llega desde un anuncio general del concesionario con el texto "Hola. ¿Puedo obtener más información sobre esto?"
- **THEN** el modelo recibe el titular y el texto del anuncio en su contexto
- **AND** la respuesta saluda, da la bienvenida a LoraMotors y responde sobre lo que anuncia el anuncio

#### Scenario: Conversación sin anuncio

- **WHEN** ningún mensaje de la conversación trae origen publicitario
- **THEN** el prompt no incluye ninguna sección de anuncio

### Requirement: Las automatizaciones pueden distinguir un mensaje de anuncio

El motor de automatizaciones SHALL ofrecer una condición que evalúa si el mensaje que disparó la automatización trae origen publicitario. La condición SHALL poder usarse en ramas sí/no igual que las condiciones existentes, y SHALL tener una etiqueta en español en el editor.

#### Scenario: Bienvenida que cede el turno a la IA

- **WHEN** la automatización de bienvenida tiene como raíz la condición "viene de un anuncio" con la rama sí vacía, y llega un primer mensaje desde un anuncio
- **THEN** la automatización no envía ningún mensaje
- **AND** el auto-reply de IA responde ese mensaje, porque nadie más respondió

#### Scenario: Primer mensaje orgánico

- **WHEN** llega un primer mensaje sin origen publicitario a esa misma automatización
- **THEN** la automatización sigue por la rama no y envía su bienvenida

### Requirement: El asesor ve que el prospecto vino de un anuncio

Cuando una conversación con origen publicitario se transfiere a un asesor, la nota interna del traspaso SHALL indicar que el cliente llegó desde un anuncio y el titular del anuncio. La vista de la conversación SHALL mostrar ese origen en el mensaje que lo trae.

#### Scenario: Traspaso de un prospecto de anuncio

- **WHEN** se transfiere una conversación cuyo primer mensaje vino de un anuncio
- **THEN** la nota interna incluye "Origen: anuncio" y el titular del anuncio

#### Scenario: Mensaje de anuncio en la bandeja

- **WHEN** un asesor abre una conversación cuyo primer mensaje vino de un anuncio
- **THEN** ese mensaje muestra una marca de origen con el titular del anuncio

