## Why

La revisión del 29/09/2026 midió 106 traspasos desde el 17/09. Los asesores tardaron una mediana de 2,3 h en responder en horario y de 13,8 h fuera de él. 14 conversaciones nunca recibieron respuesta. En 75 casos el cliente siguió escribiendo sin que nadie le contestara: 129 mensajes en total, como Sebastián con sus 29 mensajes. El asesor ya recibe un push por la asignación y otro por cada mensaje, pero nadie más se entera de que el cliente espera, y el bot queda mudo desde el traspaso.

A eso se suma que 21 conversaciones terminaron en "¿cómo es tu nombre?" sin llegar a traspasarse, y en 6 el bot pidió el nombre tres veces o más. El nombre funciona como peaje.

## What Changes

- **Bot en espera del asesor.** Al traspasar, la conversación pasa a un estado de espera: el bot ya no califica ni vuelve a pedir datos, pero sigue respondiendo preguntas concretas (precio, disponibilidad, fotos, dirección, horario). Si el cliente pregunta por su asesor, le recuerda quién lo atiende y cuándo le escribe. A un "ok" o "gracias" no responde. La espera termina cuando el asesor escribe su primer mensaje desde la bandeja o toma el control.
- **Recordatorio y escalamiento de traspasos sin atender.** Un job cada 5 minutos cuenta solo el tiempo dentro del horario de atención. A los 15 minutos sin respuesta del asesor le deja una notificación de recordatorio, con push. A los 45 minutos avisa a los administradores y dueños de la cuenta. No reasigna. Los dos plazos se configuran en Ajustes → Asignación, y dejarlos vacíos apaga la regla.
- **El nombre deja de ser un peaje.**
  - El modelo pide el nombre una sola vez y no condiciona la ayuda a que lo den.
  - Si una transferencia se rechaza solo porque falta el nombre, la siguiente pasa con el nombre del perfil de WhatsApp del contacto, marcado como tal en el resumen.
  - **BREAKING** (comportamiento): el nombre deja de bloquear para siempre una transferencia de venta.

## Capabilities

### New Capabilities
- `ai-waiting-agent`: qué hace el bot entre el traspaso y el primer mensaje del asesor.
- `handoff-sla-escalation`: recordatorio al asesor y aviso a los administradores cuando un traspaso no se atiende dentro de los plazos, contados en horario de atención.

### Modified Capabilities
- `ai-handoff-readiness`: una transferencia rechazada solo por el nombre pasa al segundo intento con el nombre del perfil, y el bot queda en espera en lugar de apagarse del todo.
- `ai-reply-gating`: `ai_autoreply_disabled` ya no calla al bot si la conversación está esperando al asesor. En ese caso responde en modo espera.

## Impact

- **Migración nueva (546)**:
  - Columna `conversations.ai_waiting_agent_since`.
  - Columnas `conversations.handoff_reminded_at` y `handoff_escalated_at`.
  - Columnas `assignment_settings.handoff_remind_after_minutes` (15 por defecto) y `handoff_escalate_after_minutes` (45 por defecto).
  - Tipos de notificación nuevos: `handoff_reminder` y `handoff_unattended`.
  - Con su prueba SQL y sus GRANT.
- **Código**:
  - `src/lib/ai/auto-reply.ts`: modo espera y marca de espera al traspasar.
  - `src/lib/ai/defaults.ts`: prompt del modo espera y regla de pedir el nombre una vez.
  - `src/lib/ai/handoff-gate.ts` y `handoff.ts`: el nombre del perfil.
  - `src/lib/whatsapp/send-message.ts` y `src/app/api/ai/autoreply/[conversationId]/route.ts`: limpian la espera.
  - Ruta de cron nueva `src/app/api/handoff/sla/cron/route.ts` y módulo puro `src/lib/handoff/sla.ts`.
  - `deploy/cron/crontab`.
  - Ajustes de asignación (API, modelo y UI).
  - Página y tipos de notificaciones, con los textos en `messages/*.json`.
- **Despliegue**: aplicar la migración y **reiniciar el contenedor del cron**, que copia el crontab al arrancar.
- **Costo**: el modo espera suma llamadas a Gemini solo cuando el cliente escribe algo que merece respuesta mientras espera. Tiene el mismo tope por conversación que el bot normal.
