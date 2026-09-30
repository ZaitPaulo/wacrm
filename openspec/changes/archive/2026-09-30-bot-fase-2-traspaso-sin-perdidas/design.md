## Context

Hoy el traspaso (`handOffToHuman` en `src/lib/ai/auto-reply.ts`, con la RPC `ai_handoff_assign` de la 537) pausa el bot con `ai_autoreply_disabled = true`, y el dispatch se corta en esa compuerta. Varias cosas dependen de esa bandera:

- el banner de IA de la bandeja;
- la ruta "Tomar el control / Reactivar IA" (`src/app/api/ai/autoreply/[conversationId]/route.ts`);
- la reactivación del lead que vuelve (538, que la pone en `false`);
- el primer mensaje de una persona desde la bandeja (`send-message.ts`, que la pone en `true`).

Los avisos al asesor ya existen: `notifications` (027/541) dispara un push con un trigger (542), para cualquier tipo, con el `title` y el `body` de la fila. El cron del VPS llama rutas con `tick.sh` y un secreto compartido; `/api/assignment/cron` es el modelo. El horario vive en `accounts.business_hours` y se lee con `leerHorarioCuenta` (Fase 1).

La compuerta de datos (`handoff-gate.ts`) es pura. Solo la urgencia tiene una salida por intentos; el nombre de una venta bloquea para siempre.

## Goals / Non-Goals

**Goals:**
- Que un cliente traspasado no escriba al vacío: el bot le responde lo concreto y le dice quién y cuándo lo atiende.
- Que un traspaso sin atender llegue a oídos de alguien con autoridad, dentro del horario.
- Que no pedir o no dar el nombre deje de trabar la venta.

**Non-Goals:**
- Reasignar solo un traspaso sin atender. Se descartó a pedido del negocio: se avisa, no se reasigna.
- Cambiar la reactivación del lead que vuelve (538) o el job de conversaciones olvidadas (537).
- Las reglas de negocio del prompt (Fase 3).

## Decisions

### 1. Estado "en espera" como columna aparte, sin tocar `ai_autoreply_disabled`

`conversations.ai_waiting_agent_since TIMESTAMPTZ NULL`. La espera es `ai_autoreply_disabled = true AND ai_waiting_agent_since IS NOT NULL`.

*Alternativa descartada:* dejar `ai_autoreply_disabled = false` tras el traspaso. Rompe el banner, la reactivación de la 538 y la semántica de "pausado" que usan la bandeja y los reportes. Con una columna aparte, todo lo existente sigue viendo "pausado".

Se escribe en `handOffToHuman`, después de la RPC, con un solo UPDATE: `ai_waiting_agent_since = now()`, `ai_reply_count = 0`, `handoff_reminded_at = NULL`, `handoff_escalated_at = NULL`. Si la RPC falló y el código pausa por su cuenta, el mismo UPDATE lleva también esos campos.

Se limpia (`NULL`) en dos lugares:
- `send-message.ts`, en el mismo UPDATE que ya pone `ai_autoreply_disabled = true` cuando hay `senderId`;
- la ruta de autoreply, tanto al pausar como al reactivar.

La 538 no se toca: al reactivar deja `disabled = false` y la espera deja de aplicar, porque exige `disabled = true`. El job también exige las dos condiciones.

### 2. Modo espera en el dispatch

- La compuerta temprana lee `ai_waiting_agent_since` y `assigned_agent_id`. Si está pausado y no espera, termina como hoy. Si espera, `waiting = true`.
- Tope: `Math.min(config.autoReplyMaxPerConversation, WAITING_MAX_REPLIES = 6)`, que se le pasa a `claim_ai_reply_slot`. El contador arrancó en 0 al traspasar.
- Prompt: `buildSystemPrompt` recibe `waiting?: { agentName: string | null; when: string | null }`. Agrega una sección, en inglés como el resto de las reglas fijas: la conversación ya fue traspasada a `agentName`, que escribe `when`; responder solo preguntas concretas con el inventario; no pedir datos ni emitir `[[HANDOFF]]`; si el cliente pregunta por la atención, decir quién y cuándo; si el mensaje no necesita respuesta, devolver solo `[[NO_REPLY]]`.
- `when` es la frase de tiempo de la Fase 1. `notify-customer.ts` exporta `handoffWhenSentence(accountId)` con la misma lógica que usa el aviso.
- El nombre del asesor se lee de `profiles.full_name` por `assigned_agent_id` y se pasa por `primerNombre`.
- La respuesta pasa por `generateSafeReply` (Fase 1). En modo espera se ignora cualquier `handoff` y se envía el texto, si lo hay.

### 3. `[[NO_REPLY]]`

`parseGeneration` (`generate.ts`) reconoce `[[NO_REPLY]]`, lo quita del texto y marca `silent: true` en `GenerateResult`. Se procesa **antes** del filtro de fugas, porque `detectLeak` marca cualquier `[[`.

En el dispatch, `silent` con texto vacío termina sin enviar ni traspasar, en los dos modos. En modo normal el prompt no enseña el marcador; si el modelo lo usara igual, callar es más seguro que el camino de `!text`, que traspasa.

### 4. El nombre del perfil

`evaluateHandoffGate` recibe `profileName?: string | null` y devuelve `nameFromProfile: boolean`. La excepción aplica si falta solo `nombre` (con el perfil de crédito completo o ya exceptuado), `attempts >= 1` y `profileName` tiene texto. El dispatch carga `contacts.name` **solo** cuando el pedido no trae nombre (una consulta, perezosa). Si `nameFromProfile`, completa `handoff.nombre = "<perfil> (perfil de WhatsApp)"` antes del resumen y del título del negocio.

El prompt (`defaults.ts`) suma la regla: pedir el nombre una vez, junto a algo útil, y no repetirlo.

### 5. Job de plazos en TypeScript, no en SQL

Ruta `POST /api/handoff/sla/cron`, con el mismo esquema de secreto que `/api/assignment/cron`, cada 5 minutos en el crontab. La lógica de "qué toca" es pura, en `src/lib/handoff/sla.ts`:

```
slaStart(since, config): Date   // since, o proximaApertura(since) si cayó fuera de horario; sin horario, since
dueActions({ since, now, config, remindMin, escalateMin, remindedAt, escalatedAt, hasAgent })
  → { remind: boolean; escalate: boolean; waitedMinutes: number }
```

Fuera del horario en `now`, no hay acciones. Se hace en TypeScript porque el horario y los festivos ya están ahí (`business-hours.ts`, probado). Reescribirlo en PL/pgSQL duplicaría la lógica de festivos.

La ruta:
1. Lee hasta 200 conversaciones con `ai_autoreply_disabled AND ai_waiting_agent_since IS NOT NULL AND handoff_escalated_at IS NULL`.
2. Agrupa por cuenta y lee `assignment_settings` y el horario una vez por cuenta.
3. Por cada acción debida hace un **UPDATE condicional** (`... SET handoff_reminded_at = now() WHERE id = ? AND handoff_reminded_at IS NULL RETURNING id`). Así dos pasadas simultáneas no duplican el aviso.
4. Solo si el UPDATE devolvió la fila, inserta las notificaciones.

Los destinatarios del aviso salen de `profiles` con `account_id` y `account_role IN ('owner','admin')`, sin el asesor asignado. Los textos salen del catálogo (`HandoffSla.*`) con `loadCatalogSection`.

### 6. Datos y ajustes

La migración 546 agrega:
- las columnas de `conversations`;
- `assignment_settings.handoff_remind_after_minutes INTEGER DEFAULT 15 CHECK (> 0)` y `handoff_escalate_after_minutes INTEGER DEFAULT 45 CHECK (> 0)`, con un CHECK de tabla escalamiento > recordatorio cuando ambos no son nulos;
- los tipos `handoff_reminder` y `handoff_unattended` en el CHECK de `notifications`;
- un índice parcial `idx_conversations_waiting_agent ON conversations(ai_waiting_agent_since) WHERE ai_waiting_agent_since IS NOT NULL`.

Las columnas nuevas en tablas existentes heredan los GRANT de su tabla. No hay tablas nuevas. Lleva prueba SQL en `supabase/tests/`.

La API y la UI de Ajustes → Asignación suman los dos campos, que son números opcionales, con la misma validación que el CHECK.

## Risks / Trade-offs

- **[El bot en espera contradice al asesor]** → No califica, no traspasa y tiene un tope de 6 respuestas. La espera termina con el primer mensaje del asesor.
- **[Avisos de más a los administradores]** → Uno por traspaso, solo en horario, y solo si el asesor no escribió desde la bandeja. Un asesor que atiende por su línea personal disparará avisos. Es intencional: ese chat no se ve en el CRM.
- **[El nombre del perfil es un apodo, por ejemplo "Dios es amor"]** → El resumen lo marca "(perfil de WhatsApp)", y el asesor sabe que no es un nombre confirmado. Es mejor que un lead que no llega.
- **[El cron del VPS no recarga el crontab]** → Hay que reiniciar el contenedor del cron al desplegar. Queda en las tareas y en el resumen.
- **[Conversaciones traspasadas antes del despliegue]** → Tienen `ai_waiting_agent_since` nulo: no entran al modo espera ni a los avisos. No hay retroactividad.
