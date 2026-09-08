## Why

El auto-reply transfiere la conversación a un asesor apenas el modelo emite el sentinel `[[HANDOFF]]`, sin verificar nada. En producción eso está entregando conversaciones vacías: el 2026-09-07 dos clientes distintos (`2e433932` y `15481c44`) fueron transferidos con `ai_reply_count: 2`, justo después de decir su presupuesto, sin que el bot les hubiera mostrado un solo vehículo. El asesor recibe un hilo sin datos y el cliente queda esperando a una persona que no tenía por qué entrar todavía.

Se intentó corregir por prompt dos veces (reglas explícitas de "traspasar es el último recurso" y "el presupuesto no es motivo de traspaso") y el modelo siguió transfiriendo. La decisión de transferir no puede quedar solo en manos del modelo.

## What Changes

- El sentinel de handoff pasa a llevar los datos del cliente que el modelo recolectó: nombre, presupuesto, vehículo de interés y si requiere crédito. **BREAKING** para el formato del sentinel: `[[HANDOFF]]` a secas deja de ser una transferencia válida en modo auto-reply.
- El código valida esos datos antes de transferir. Si falta alguno, la transferencia se rechaza y el bot sigue atendiendo para completar lo que falta.
- Excepción por urgencia: si el motivo declarado es un reclamo o que el cliente pidió hablar con una persona, solo se exige el nombre. Si falta, el bot lo pide y transfiere en el turno siguiente aunque el resto siga incompleto.
- Un handoff urgente no puede quedarse atascado: al segundo intento se transfiere aunque el cliente no haya dado el nombre.
- Los datos recolectados se guardan y se muestran en la nota interna que recibe el asesor, en vez del resumen genérico actual.

## Capabilities

### New Capabilities

- `ai-handoff-readiness`: cuándo el auto-reply de IA puede transferir una conversación a un asesor humano — qué datos del cliente exige, cómo se declaran, qué pasa cuando faltan, y qué excepciones aplican por urgencia.

### Modified Capabilities

Ninguna. `ai-reply-gating` cubre cuándo responde el auto-reply, no cuándo transfiere; sus requisitos no cambian. `flow-handoff-routing` cubre la derivación desde flujos, que no se toca.

## Impact

- `src/lib/ai/defaults.ts`: formato del sentinel y las instrucciones de handoff del scaffold en modo `auto_reply`.
- `src/lib/ai/generate.ts`: `parseGeneration` pasa a extraer los campos declarados, no solo un booleano.
- `src/lib/ai/auto-reply.ts`: la condición `handoff || !text` se reemplaza por la evaluación del gate; camino nuevo para el handoff rechazado.
- `src/lib/ai/handoff.ts`: `buildHandoffSummary` incorpora los datos recolectados.
- Migración nueva en rango 500+: contador de intentos de handoff por conversación, para que la excepción por urgencia no entre en bucle.
- El `system_prompt` de producción de LoraMotors se ajusta para nombrar los motivos de derivación con los valores que espera el parser. El formato del sentinel lo enseña el scaffold del código, así que una cuenta con el prompt viejo sigue pudiendo transferir.
