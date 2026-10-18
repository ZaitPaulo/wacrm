## Why

Lora Motors reporta que, con el volumen actual de chats, los asesores no saben a quién ya atendieron y a quién le deben respuesta. La bandeja solo ofrece "No leídos", y ese contador vuelve a 0 en cuanto alguien abre el chat (`message-thread.tsx`), aunque nadie conteste: leer no es atender. Ya se midió que el 32 % de los traspasos quedan sin atender (rendimiento del bot, sept. 2026); el cuello de botella es el asesor, y hoy no tiene cómo ver su pendiente.

## What Changes

- Nuevo estado por conversación **"Por responder"**: la columna `conversations.awaiting_reply_since` guarda desde cuándo el cliente espera respuesta de un asesor. La mantiene la base de datos con un trigger sobre `messages`:
  - mensaje del cliente → se fija con la hora de ese mensaje, solo si no estaba ya pendiente (conserva la espera más antigua);
  - mensaje de un **asesor humano** (`sender_type = 'agent'` con `sender_id` no nulo) → se limpia;
  - mensajes del bot, automatizaciones, flujos, recordatorios de citas y la API v1 (sin asesor detrás) **no** la limpian;
  - abrir o leer el chat no la toca.
- Backfill en la migración para las conversaciones con actividad en los últimos 7 días.
- Bandeja:
  - etiqueta "Esperando · hace X" en cada chat pendiente, con color por antigüedad (verde < 15 min, ámbar < 1 h, rojo ≥ 1 h);
  - filtro "Por responder", combinable con el filtro de asesor ("mis pendientes"), ordenado de la espera más larga a la más corta;
  - contador de chats por responder en el filtro.
- Botón **"Marcar como atendido"** en el hilo, para cerrar la espera sin contestar (p. ej. el cliente solo dijo "gracias 👍").

## Capabilities

### New Capabilities
- `inbox-awaiting-reply`: estado "Por responder" de cada conversación (cuándo empieza y termina la espera, qué remitentes cuentan), su visualización en la bandeja (etiqueta, filtro, orden y contador) y el cierre manual "Marcar como atendido".

### Modified Capabilities
<!-- Ninguna: el filtro de asesor (`inbox-assignee-filter`) no cambia; solo se combina con el nuevo filtro. -->

## Impact

- **Base de datos**: migración `551_conversation_awaiting_reply.sql` (columna, índice, función + trigger `AFTER INSERT` en `messages`, backfill).
- **Tipos / carga**: `src/types/index.ts` (`Conversation`), `src/lib/inbox/conversations.ts` (`CONVERSATION_SELECT`, normalización, nuevo helper de filtro/orden).
- **UI**: `src/components/inbox/conversation-list.tsx` (filtro, etiqueta, orden, contador), `src/components/inbox/message-thread.tsx` (botón "Marcar como atendido"), textos en el diccionario de español.
- Sin cambios en APIs públicas ni dependencias nuevas. El realtime de `conversations` que ya usa la bandeja propaga los cambios del trigger.
