## Why

Cuando la IA transfiere una conversación pasan tres cosas mediocres a la vez:

1. **Todo cae en la misma persona.** `handoff_agent_id` es un único asesor configurado a mano. En producción apunta a una sola admin, que acumula las 3 conversaciones asignadas de la cuenta mientras los tres miembros con rol `agent` no reciben ninguna.
2. **El cliente recibe un aviso anónimo**: "Te asignamos un asesor comercial. Se comunicará contigo muy pronto. 🙌". No sabe quién le va a escribir, y el mensaje suena a ticket, no a un negocio donde alguien lo va a atender.
3. **El asesor recibe una notificación vacía de contenido.** El trigger `notify_conversation_assigned` escribe "Someone assigned you a conversation with X" — y como la IA asigna con el service role, `auth.uid()` es NULL y queda literalmente "Someone". El asesor abre el hilo sin saber qué quiere el cliente, pese a que el bot ya recolectó nombre, presupuesto, vehículo de interés y si requiere crédito.

## What Changes

- La transferencia elige asesor por **carga real**: el miembro con menos conversaciones abiertas asignadas. Empate resuelto por antigüedad en la cuenta, lo que hace la elección determinista y repartida.
- Son candidatos los miembros con rol `agent` o `admin`. El `owner` queda fuera: es la cuenta del dueño del CRM, no un puesto de atención.
- `handoff_agent_id` mantiene la precedencia cuando está configurado — una elección explícita del admin no se pisa. El reparto entra cuando ese campo está vacío. **Como parte del despliegue hay que vaciarlo** para que el reparto empiece a actuar.
- El aviso al cliente pasa a nombrar a quien lo va a atender: "Uno de nuestros asesores se pondrá en contacto contigo, su nombre es Juan". Cuando no hay asesor elegible, se conserva el texto anónimo actual.
- La notificación al asesor lleva el resumen de lo que busca el cliente: motivo, nombre, presupuesto, vehículo y crédito, con los faltantes marcados.
- El resumen interno (`ai_handoff_summary`) pasa a estar íntegramente en español; hoy mezcla inglés y español porque nació como nota técnica y ahora es lo que lee un asesor colombiano.

## Capabilities

### New Capabilities

- `ai-handoff-assignment`: a quién se le asigna una conversación transferida por la IA, qué se le dice al cliente sobre esa persona, y qué información recibe el asesor al recibirla.

### Modified Capabilities

Ninguna. `ai-handoff-readiness` decide **cuándo** procede una transferencia y no cambia; esta capacidad se ocupa de **a quién** va y qué llega con ella.

## Impact

- `src/lib/ai/auto-reply.ts`: `handOffToHuman` resuelve el destinatario en vez de usar solo `config.handoffAgentId`.
- Módulo nuevo para elegir asesor por carga, consultando `profiles` y `conversations`.
- `src/lib/handoff/notify-customer.ts` y el catálogo `messages/*.json`: el aviso admite el nombre del asesor.
- `src/lib/ai/handoff.ts`: `buildHandoffSummary` en español.
- Migración en rango 500+: redefine `notify_conversation_assigned` para usar `ai_handoff_summary` como cuerpo cuando la asignación la hizo la IA.
- Despliegue: vaciar `ai_configs.handoff_agent_id` en producción para habilitar el reparto.
