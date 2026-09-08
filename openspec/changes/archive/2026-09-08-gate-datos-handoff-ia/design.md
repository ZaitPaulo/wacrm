## Context

`dispatchInboundToAiReply` transfiere con `if (handoff || !text)`, donde `handoff` es `raw.includes(HANDOFF_SENTINEL)` (`generate.ts:73`). El sentinel es una cadena fija sin carga útil, así que el código no tiene forma de saber qué sabe el bot del cliente en el momento de transferir: acepta la decisión del modelo tal cual.

El scaffold de `buildSystemPrompt` en modo `auto_reply` refuerza el sesgo: le dice al modelo *"Prefer handing off over guessing"*. Sumado a un `system_prompt` de negocio que lista "precio" entre los motivos de derivación, el resultado observado es transferir en cuanto el cliente menciona plata.

Dos intentos de corregirlo solo con el `system_prompt` fallaron (conversaciones `2e433932` y `15481c44`, ambas el 2026-09-07, ambas con `ai_reply_count: 2`). El gate tiene que estar en código.

Restricción del repo: no hay Server Actions; la lógica server-only vive en `src/lib/**` y se invoca desde el webhook. Migraciones secuenciales `NNN_nombre.sql` en rango 500+, idempotentes.

## Goals / Non-Goals

**Goals:**

- Que ninguna transferencia salga sin los cuatro datos, salvo la excepción por urgencia.
- Que un handoff rechazado siga sonando natural: el bot pregunta lo que falta, no suelta un formulario.
- Que el asesor reciba los datos ya recolectados en la nota interna.
- Que la decisión sea auditable: el motivo y los campos quedan registrados.

**Non-Goals:**

- Extraer los datos del cliente con NLP propio o con una segunda llamada de "extracción estructurada". El modelo ya los tiene en su contexto; se los pedimos en el mismo turno.
- Persistir presupuesto / vehículo de interés como columnas de `contacts`. Eso es un modelo de datos de prospecto y es otro cambio.
- Tocar la derivación desde flujos (`flow-handoff-routing`).
- Cambiar el modo `draft`: el sentinel solo existe en `auto_reply`.

## Decisions

### Sentinel con campos `clave=valor`, no JSON

`[[HANDOFF nombre=Carlos | presupuesto=30000000 | interes=Kia Sportage 2019 | credito=si | motivo=credito]]`

Un campo que el modelo no obtuvo se declara con `?` (`presupuesto=?`), nunca se omite ni se inventa.

Se descartó JSON: los modelos tienden a envolverlo en cercas de código y un solo carácter mal puesto rompe el `JSON.parse`, lo que en un gate fail-safe se traduce en urgencias atascadas. El formato plano se parsea con una expresión regular tolerante a espacios, orden y campos de más.

El parser vive en `parseGeneration`, que pasa de devolver `handoff: boolean` a devolver `handoff: HandoffRequest | null`.

### El scaffold enseña el formato, no el prompt del negocio

Las instrucciones del sentinel se emiten desde `buildSystemPrompt` en modo `auto_reply`, que es código nuestro y viaja con el despliegue. Así ninguna cuenta queda sin poder transferir por tener un `system_prompt` viejo — importante porque el prompt de LoraMotors se edita a mano desde Ajustes.

El `system_prompt` del negocio solo aporta la lista de motivos propios del concesionario.

### Handoff rechazado: se reusa el texto del turno; si no hay, se regenera

El modelo casi siempre emite el sentinel acompañado de texto. Cuando lo hay, ese texto se envía tal cual y el turno sigue como una respuesta normal.

Cuando el sentinel viene solo, hay una segunda generación con una instrucción inyectada al final del system prompt: no puedes transferir todavía, te faltan estos campos, pídeselos al cliente en tu tono normal.

Se descartó un mensaje fijo ("Para ayudarte mejor, ¿cuál es tu presupuesto?"): un texto idéntico en cada conversación es exactamente el patrón de bot que este bot está tratando de no tener. El costo es una llamada extra ocasional a Gemini Flash, despreciable frente a una transferencia mal hecha.

### Contador en `conversations`, no inferido del historial

Migración nueva con `ai_handoff_attempts int not null default 0`. Se incrementa en cada handoff rechazado y habilita el escape al segundo intento urgente.

Se descartó contar mensajes del bot: no distingue un turno normal de un intento de transferencia. El endpoint que reactiva el auto-reply (`api/ai/autoreply/[conversationId]/route.ts:83`, que ya limpia `ai_handoff_summary`) también resetea el contador.

### `!text` sin sentinel sigue transfiriendo

La condición actual `handoff || !text` mezcla dos cosas: la decisión del modelo y el camino de fallo. El gate aplica solo a la primera. Una generación que vuelve vacía sigue transfiriendo sin exigir datos, porque la alternativa es el silencio — el fallo del 2026-08-26 documentado en `auto-reply.ts:340`, donde dos clientes se quedaron esperando. Ante la duda, que entre un humano.

## Risks / Trade-offs

- **El modelo emite el sentinel mal formado** → se interpreta como transferencia incompleta, así que nunca transfiere de más; el contador de urgencia evita que un reclamo quede atrapado por un error de formato.
- **El modelo inventa datos para pasar el gate** → el formato exige `?` explícito para lo desconocido y el prompt lo refuerza; además la nota interna muestra los valores, de modo que un dato inventado es visible para el asesor en vez de silencioso.
- **Una llamada extra a Gemini** cuando el sentinel viene sin texto → solo en ese caso, y sobre Flash.
- **Clientes que de verdad necesitan un humano esperan más turnos** → mitigado por la excepción de urgencia con un solo dato y el escape al segundo intento; es el trade-off aceptado del cambio.
- **El gate no puede verificar que los datos sean ciertos**, solo que estén declarados. Es un gate contra transferencias vacías, no un validador de veracidad.

## Migration Plan

1. Migración `5NN_ai_handoff_attempts.sql`, idempotente, con la columna en `conversations`.
2. Desplegar el código. El scaffold nuevo enseña el formato desde el primer turno; las conversaciones en curso no necesitan nada.
3. Ajustar el `system_prompt` de LoraMotors para nombrar los motivos con los valores que espera el parser.
4. Rollback: revertir el despliegue. La columna puede quedarse — sin el código que la lee es inerte.

## Open Questions

- ¿El asesor debería poder forzar una transferencia desde la bandeja aunque falten datos? Hoy puede asignarse la conversación a mano, que cubre el caso; queda fuera de este cambio.
- ¿Conviene que `presupuesto` se normalice a número para reportería futura? Por ahora se guarda como lo declaró el modelo.
