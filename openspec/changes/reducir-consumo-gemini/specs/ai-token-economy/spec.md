## ADDED Requirements

### Requirement: El prompt empieza por un prefijo estable

`buildSystemPrompt` SHALL armar el prompt en dos tramos. El prefijo estable contiene, en este orden: las instrucciones fijas, el protocolo de traspaso del auto-reply, el prompt de la cuenta, el inventario y la regla de crédito. Para una misma cuenta, modo e inventario, el prefijo MUST ser idéntico carácter por carácter sin importar el estado de la conversación (espera, anuncio, fotos, extractos, presupuesto en horario). Todo lo que depende de la conversación SHALL ir después del prefijo.

Reordenar MUST NOT cambiar el contenido de ninguna regla: cada bloque de texto que existe hoy sigue presente, con la misma redacción.

#### Scenario: Conversación en espera y conversación normal

- **WHEN** se arma el prompt de una conversación en espera y el de una conversación normal de la misma cuenta
- **THEN** ambos empiezan con el mismo prefijo estable
- **AND** en la conversación en espera la instrucción de espera, que prevalece sobre el protocolo de traspaso, va después del prefijo

#### Scenario: Conversación que viene de un anuncio

- **WHEN** se arma el prompt de un cliente que llegó de un anuncio
- **THEN** el bloque del anuncio va después del prefijo estable

#### Scenario: Ninguna regla se pierde

- **WHEN** se compara el conjunto de bloques del prompt antes y después del cambio, para el mismo estado de conversación
- **THEN** los bloques son los mismos, solo cambia su orden

### Requirement: Se registran los tokens servidos desde el caché

Cuando el proveedor informe tokens de entrada servidos desde su caché (`usage.prompt_tokens_details.cached_tokens` en la superficie compatible con OpenAI), el sistema SHALL guardarlos en `ai_usage_log.cached_tokens`. Sin ese dato, la columna queda en 0.

#### Scenario: Gemini informa tokens cacheados

- **WHEN** la respuesta trae `prompt_tokens: 18000` y `cached_tokens: 12000`
- **THEN** la fila de `ai_usage_log` guarda `prompt_tokens = 18000` y `cached_tokens = 12000`

#### Scenario: Proveedor sin el dato

- **WHEN** la respuesta no trae `prompt_tokens_details`
- **THEN** la fila guarda `cached_tokens = 0`

### Requirement: Razonamiento bajo para Gemini

Las llamadas a Gemini SHALL enviar `reasoning_effort: "low"`. El valor SHALL poder cambiarse por la variable de entorno `AI_REASONING_EFFORT`, que acepta `low`, `medium`, `high` o `none` (`none` = no enviar el parámetro). Los demás proveedores no cambian.

#### Scenario: Llamada a Gemini por defecto

- **WHEN** el bot llama a Gemini sin la variable definida
- **THEN** el cuerpo de la petición lleva `reasoning_effort: "low"`

#### Scenario: Volver al comportamiento anterior

- **WHEN** `AI_REASONING_EFFORT=none`
- **THEN** la petición no lleva `reasoning_effort`

### Requirement: El inventario del modelo lleva referencias, no URLs

Cada línea del inventario que ve el modelo SHALL identificar el vehículo por su referencia pública en lugar de su URL completa, y el prompt SHALL indicar que, al nombrar un vehículo, escriba su marcador de enlace con esa referencia. Antes de enviar, el sistema SHALL reemplazar cada marcador por la URL de la ficha de ese vehículo. Un marcador con una referencia que no está en el inventario SHALL eliminarse sin dejar texto roto.

La regla vigente "Ningún vehículo nombrado sale sin su enlace" se conserva: el respaldo que agrega enlaces a vehículos nombrados sin enlace sigue funcionando sobre el texto ya expandido.

#### Scenario: El modelo nombra un vehículo

- **WHEN** el modelo escribe "El Mazda 3 2019 está en $62M: [[FOTOS 123]]"
- **THEN** el cliente recibe el texto con la URL completa de la ficha 123 en lugar del marcador

#### Scenario: Referencia inexistente

- **WHEN** el modelo escribe un marcador con una referencia que no está en el inventario
- **THEN** el marcador se quita y el texto se envía sin él

#### Scenario: Vehículo sin marcador

- **WHEN** el modelo nombra un vehículo del inventario sin escribir su marcador
- **THEN** el respaldo de enlaces agrega la URL, como hoy

#### Scenario: Ningún marcador llega al cliente

- **WHEN** se envía cualquier respuesta del bot
- **THEN** el texto no contiene `[[FOTOS`

### Requirement: Historial de 12 mensajes

El historial de la conversación enviado al modelo SHALL ser, por defecto, de los últimos 12 mensajes con texto. La variable `AI_CONTEXT_MESSAGE_LIMIT` sigue pudiendo cambiarlo.

#### Scenario: Conversación larga

- **WHEN** una conversación tiene 40 mensajes con texto y la variable no está definida
- **THEN** el modelo recibe los 12 más recientes
