## 1. Migración 546

- [x] 1.1 `supabase/migrations/546_handoff_waiting_sla.sql`: columnas de `conversations` (`ai_waiting_agent_since`, `handoff_reminded_at`, `handoff_escalated_at`) e índice parcial; columnas de `assignment_settings` con sus CHECK; tipos nuevos de `notifications`. Idempotente.
- [x] 1.2 Prueba SQL en `supabase/tests/` (defaults, CHECK de plazos, tipos de notificación aceptados).

## 2. Marca de espera al traspasar y su fin

- [x] 2.1 Pruebas: el traspaso (con datos y por fallo técnico) deja `ai_waiting_agent_since`, pone `ai_reply_count` en 0 y limpia `handoff_*_at`; el mensaje de una persona desde la bandeja limpia la espera y una automatización no; la ruta de autoreply la limpia al pausar y al reactivar.
- [x] 2.2 Implementarlo en `handOffToHuman`, `send-message.ts` y `api/ai/autoreply/[conversationId]/route.ts`, y actualizar el tipo `Conversation`.

## 3. `[[NO_REPLY]]` y modo espera en el dispatch

- [x] 3.1 Pruebas de `parseGeneration` con `[[NO_REPLY]]` (`silent`) y del dispatch: `silent` sin texto no envía ni traspasa.
- [x] 3.2 Implementar `silent` en `generate.ts`/`types.ts` y en el dispatch, antes del filtro de fugas.
- [x] 3.3 Exportar `handoffWhenSentence(accountId)` desde `notify-customer.ts`, con prueba.
- [x] 3.4 `buildSystemPrompt` con `waiting` (quién y cuándo, reglas del modo espera, `[[NO_REPLY]]`), con pruebas en `defaults.test.ts`.
- [x] 3.5 Pruebas del dispatch en espera: responde en espera, el prompt lleva al asesor y el cuándo, tope de 6, ignora un `handoff`, se calla sin espera, `NO_REPLY` no envía.
- [x] 3.6 Implementar el modo espera en `dispatchInboundToAiReply`.

## 4. El nombre deja de ser un peaje

- [x] 4.1 Pruebas de `evaluateHandoffGate` con `profileName`: pasa al segundo intento con solo el nombre faltante, no pasa sin perfil ni al primer intento, y no cambia los demás casos.
- [x] 4.2 Implementar `profileName` y `nameFromProfile` en `handoff-gate.ts`.
- [x] 4.3 Pruebas del dispatch: carga `contacts.name` solo si falta el nombre y el resumen dice "(perfil de WhatsApp)".
- [x] 4.4 Implementarlo en el dispatch y agregar la regla "pedir el nombre una vez" al prompt de `defaults.ts`, con prueba.

## 5. Plazos y avisos

- [x] 5.1 Pruebas de `src/lib/handoff/sla.ts`: traspaso en horario y de noche, fuera de horario sin acciones, sin horario de corrido, sin asesor sin recordatorio, plazos apagados, ya avisado.
- [x] 5.2 Implementar `slaStart` y `dueActions`.
- [x] 5.3 Textos `HandoffSla.*` en `messages/{es,en,ko}.json`; tipos `handoff_reminder` y `handoff_unattended` en `NotificationType`, con icono y texto en la página de notificaciones.
- [x] 5.4 Pruebas de la ruta `api/handoff/sla/cron`: rechaza sin secreto, crea el recordatorio para el asesor, crea el aviso para owner y admin sin el asesor, no duplica si el UPDATE condicional no devuelve fila, ignora conversaciones sin la IA pausada.
- [x] 5.5 Implementar la ruta y agregarla a `deploy/cron/crontab`.

## 6. Ajustes de asignación

- [x] 6.1 API `api/assignment/settings`: leer y guardar los dos plazos, con validación (enteros > 0 o nulos; escalamiento > recordatorio), con pruebas.
- [x] 6.2 Modelo y UI de Ajustes → Asignación con los dos campos y sus textos en los tres idiomas, con pruebas.

## 7. Banner y verificación

- [x] 7.1 Banner de IA: mensaje del modo espera, en los tres idiomas.
- [x] 7.2 `npx vitest run` completo, `npx tsc --noEmit` y `npx eslint` sobre los archivos tocados.
