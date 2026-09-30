# ai-reply-safety Specification

## Purpose
TBD - created by archiving change bot-fase-1-calidad-respuesta. Update Purpose after archive.
## Requirements
### Requirement: El texto de la IA no filtra sus instrucciones internas

Antes de enviarse al cliente, todo texto generado por el auto-reply SHALL pasar por un filtro de salida. El filtro marca como fuga un texto que cumpla cualquiera de estas condiciones:

- contiene el marcador de traspaso o una asignación de sus campos (`nombre=`, `presupuesto=`, `interes=`, `credito=`, `motivo=`, `ocupacion=`, `ingresos=`);
- menciona términos del mecanismo interno (`handoff`, `system prompt`, `sentinel`, `[[`);
- tiene una proporción alta de palabras en inglés frecuentes (the, you, if, is, and, only, once, while, missing…), propia de un razonamiento y no de una respuesta a un cliente en español.

El nombre de un vehículo, de una marca o una frase corta en inglés dentro de una respuesta en español (por ejemplo "GT Line" o "full equipo") MUST NOT contar como fuga.

#### Scenario: Se filtra el razonamiento del modelo

- **WHEN** el modelo devuelve "The handoff only goes through once nombre, presupuesto, interes and credito are all filled in…"
- **THEN** ese texto no se envía al cliente

#### Scenario: Una respuesta normal pasa

- **WHEN** el modelo devuelve "Tenemos un Kia Picanto GT Line 2025 automático en $68.000.000"
- **THEN** el texto se envía sin cambios

### Requirement: Una fuga se regenera una vez y nunca llega al cliente

Cuando el filtro detecta una fuga, el sistema SHALL volver a generar la respuesta una sola vez, con una instrucción adicional de responder solo al cliente, en español y sin explicar el razonamiento. Si la segunda respuesta pasa el filtro, se envía. Si vuelve a fallar, el sistema SHALL enviar un mensaje seguro y fijo que invite al cliente a continuar (por ejemplo, pedirle que cuente qué vehículo busca), y MUST registrar el incidente en el log con el id de la conversación. El texto filtrado MUST NOT enviarse en ningún caso.

#### Scenario: La regeneración sale limpia

- **WHEN** la primera respuesta es una fuga y la segunda es una respuesta normal
- **THEN** el cliente recibe solo la segunda respuesta
- **AND** se invocó al proveedor dos veces

#### Scenario: La fuga persiste

- **WHEN** las dos respuestas son fugas
- **THEN** el cliente recibe el mensaje seguro
- **AND** el log registra la fuga con el id de la conversación

#### Scenario: El texto que acompaña a un traspaso también se filtra

- **WHEN** el modelo pide traspaso y el texto que lo acompaña es una fuga
- **THEN** ese texto no se envía al cliente
- **AND** el traspaso sigue su curso con el aviso normal

### Requirement: Un fallo pasajero del proveedor se reintenta antes de traspasar

Cuando la generación falla por tiempo agotado, error de red, límite de uso o respuesta vacía, el auto-reply SHALL reintentar la generación una vez, tras una espera corta. Solo si el reintento también falla, la conversación SHALL seguir el camino actual de traspaso por fallo técnico. Un error de clave inválida (`invalid_key`) MUST NOT reintentarse, porque fallaría igual.

Antes de reintentar, el sistema SHALL volver a comprobar si el cliente escribió un mensaje más nuevo. Si lo hizo, abandona el reintento, porque ese mensaje tiene su propio dispatch.

#### Scenario: El reintento funciona

- **WHEN** la primera llamada al proveedor agota el tiempo y la segunda responde
- **THEN** el cliente recibe la respuesta
- **AND** la conversación no se traspasa

#### Scenario: El reintento también falla

- **WHEN** las dos llamadas al proveedor fallan por error de red
- **THEN** la conversación se traspasa con la nota de fallo técnico, como hasta ahora

#### Scenario: Clave inválida

- **WHEN** el proveedor responde que la clave es inválida
- **THEN** no se reintenta
- **AND** la conversación se traspasa con la nota de fallo técnico

#### Scenario: El cliente escribió mientras se esperaba el reintento

- **WHEN** la primera llamada falla y llega un mensaje nuevo del cliente antes del reintento
- **THEN** este dispatch termina sin responder ni traspasar

