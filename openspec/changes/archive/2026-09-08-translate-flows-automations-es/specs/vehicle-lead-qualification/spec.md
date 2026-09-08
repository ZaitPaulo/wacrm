## ADDED Requirements

### Requirement: El guion de primer contacto es de compraventa de vehículos y está en español

El guion que atiende a quien escribe por primera vez SHALL estar redactado en español latinoamericano neutro y SHALL preguntar únicamente por asuntos propios de la compraventa de vehículos.

El guion SHALL NOT pedir correo laboral ni nombre de empresa: quien escribe por un auto es una persona, no una cuenta corporativa.

Todo texto que se le envíe al cliente SHALL respetar los límites de la API de WhatsApp que ya valida `src/lib/flows/validate.ts`: máximo 3 botones por mensaje, título de botón ≤20 caracteres, ≤10 filas de lista en total y título de fila ≤24 caracteres.

#### Scenario: Cliente nuevo escribe por primera vez

- **WHEN** un contacto sin mensajes previos envía su primer mensaje
- **THEN** recibe un saludo en español que lo invita a elegir entre comprar, vender o permutar, y otra consulta

#### Scenario: El guion no pide datos corporativos

- **WHEN** se recorre cualquier rama del guion de principio a fin
- **THEN** en ningún nodo se solicita correo laboral ni nombre de empresa

#### Scenario: Los mensajes respetan los límites de WhatsApp

- **WHEN** se valida el flujo para activarlo
- **THEN** la validación no reporta ningún error

### Requirement: Las respuestas enumerables se capturan con opciones tocables

Cuando el conjunto de respuestas posibles es acotado y conocido de antemano, el guion SHALL usar botones o listas en lugar de texto libre. El texto libre SHALL reservarse para datos que solo el cliente puede redactar, como la marca y modelo del vehículo que busca.

Esta regla existe por evidencia de campo: de las cinco ejecuciones del guion anterior, tres capturaron ruido en campos de texto libre porque el cliente no entendía la pregunta.

#### Scenario: Rango de presupuesto

- **WHEN** el guion pregunta por el presupuesto
- **THEN** el cliente elige entre rangos predefinidos tocando una opción
- **AND** lo que queda guardado es el rango elegido, no lo que el cliente haya podido escribir

#### Scenario: Forma de pago

- **WHEN** el guion pregunta cómo piensa pagar
- **THEN** el cliente elige entre contado, financiado o entregando un vehículo en parte de pago

#### Scenario: Vehículo de interés

- **WHEN** el guion pregunta qué vehículo busca
- **THEN** acepta texto libre, porque marca, modelo y año no forman un conjunto acotado

### Requirement: Los importes se expresan en la moneda de la cuenta y cubren el inventario

Todo importe que el guion le muestre al cliente SHALL estar expresado en la moneda declarada en `accounts.default_currency`.

Los rangos de presupuesto ofrecidos SHALL derivarse del inventario real de la cuenta, de modo que cada rango tenga stock disponible que ofrecer. Un rango sin unidades es una opción que le hace perder el tiempo al cliente y no produce ninguna venta.

Los negocios que el sistema cree de forma automática SHALL quedar denominados en esa misma moneda.

#### Scenario: Rangos en la moneda de la cuenta

- **WHEN** el cliente recibe la lista de rangos de presupuesto
- **THEN** los importes están expresados en la moneda configurada en la cuenta

#### Scenario: Cada rango tiene stock

- **WHEN** se contrastan los rangos ofrecidos contra el inventario disponible
- **THEN** cada rango, salvo el de presupuesto sin definir, corresponde a al menos un vehículo disponible

#### Scenario: Moneda del negocio creado

- **WHEN** se crea automáticamente un negocio por un prospecto calificado
- **THEN** su moneda es la declarada en la cuenta

### Requirement: La rama de compra recolecta vehículo, presupuesto y forma de pago

Quien declara intención de comprar SHALL recorrer, antes de la derivación, las preguntas de vehículo de interés, rango de presupuesto y forma de pago.

Cuando la forma de pago elegida sea entregar un vehículo en parte de pago, el guion SHALL además preguntar por el vehículo que el cliente entregaría.

#### Scenario: Compra al contado

- **WHEN** el cliente elige comprar y responde vehículo, presupuesto y pago al contado
- **THEN** el guion deriva a un agente sin preguntar por un vehículo en parte de pago

#### Scenario: Compra con vehículo en parte de pago

- **WHEN** el cliente elige entregar un vehículo en parte de pago
- **THEN** el guion pregunta qué vehículo entregaría antes de derivar

### Requirement: La rama de venta recolecta el vehículo que el cliente ofrece

Quien declara que quiere vender o permutar su vehículo SHALL ser consultado por los datos del vehículo que ofrece antes de la derivación.

#### Scenario: Cliente quiere vender

- **WHEN** el cliente elige la opción de vender o permutar
- **THEN** el guion le pregunta por el vehículo que ofrece y luego deriva a un agente

### Requirement: El prospecto que completa el guion queda etiquetado

Un contacto que recorre el guion hasta la derivación SHALL quedar marcado con una etiqueta que lo distinga de quien solo saludó, de modo que la etiqueta pueda disparar el registro del negocio.

#### Scenario: Prospecto calificado

- **WHEN** el cliente responde todas las preguntas de su rama y el guion llega a la derivación
- **THEN** el contacto queda con la etiqueta de prospecto calificado

#### Scenario: Cliente abandona a mitad del guion

- **WHEN** el cliente deja de responder antes de terminar su rama
- **THEN** no se le aplica la etiqueta de calificado

### Requirement: El negocio se registra al calificar, no al saludar

El sistema SHALL crear el negocio en el embudo cuando el contacto queda calificado, y SHALL NOT crearlo por el solo hecho de que alguien escriba por primera vez.

El negocio SHALL crearse sin valor monetario asignado. El presupuesto que el cliente declaró es un rango, no un precio, y el valor definitivo lo fija el agente cuando toma la conversación.

#### Scenario: Alguien solo saluda

- **WHEN** un contacto envía un primer mensaje y no responde ninguna pregunta del guion
- **THEN** no se crea ningún negocio

#### Scenario: Prospecto calificado

- **WHEN** el contacto recibe la etiqueta de prospecto calificado
- **THEN** se crea un negocio en el embudo de compraventa, en la primera etapa, sin valor asignado

#### Scenario: El valor no se inventa

- **WHEN** se crea un negocio de forma automática
- **THEN** su valor es cero y no una cifra fija arbitraria

### Requirement: Las etapas del embudo están en español y son del rubro

Las etapas del embudo de compraventa SHALL estar nombradas en español y con vocabulario del negocio automotor.

El cambio SHALL limitarse a renombrar: el sistema SHALL NOT reordenar, agregar ni eliminar etapas, porque los negocios existentes ya apuntan a ellas.

#### Scenario: Etapas renombradas

- **WHEN** un operador abre el embudo de compraventa
- **THEN** las etapas se muestran en español

#### Scenario: Los negocios existentes conservan su etapa

- **WHEN** se aplica el renombrado
- **THEN** cada negocio sigue en la misma etapa en la que estaba, con el mismo orden relativo

### Requirement: Las plantillas semilla son del rubro y en español

La galería de plantillas de flujos y de automatizaciones SHALL ofrecer guiones de compraventa de vehículos redactados en español, en lugar de los guiones genéricos de software por suscripción heredados del proyecto original.

Las palabras clave de las plantillas que disparan por coincidencia SHALL estar en español, porque una palabra clave en inglés nunca coincide con lo que escribe un cliente hispanohablante.

#### Scenario: Operador clona una plantilla

- **WHEN** un operador crea un flujo desde la galería de plantillas
- **THEN** el flujo resultante tiene todos sus textos al cliente en español

#### Scenario: Palabras clave en español

- **WHEN** se inspecciona una plantilla que dispara por palabra clave
- **THEN** sus palabras clave están en español
