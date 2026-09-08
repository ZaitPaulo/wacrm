## 1. Base de datos

- [x] 1.1 Crear `supabase/migrations/519_ai_handoff_attempts.sql`, idempotente, con `ai_handoff_attempts int not null default 0` en `conversations`
- [x] 1.2 Añadir el campo a la interfaz `Conversation` en `src/types/index.ts`, documentando para qué sirve

## 2. Formato y parseo del sentinel

- [x] 2.1 Definir en `src/lib/ai/types.ts` (no `defaults.ts`: evita un ciclo de imports con `GenerateResult`) el tipo `HandoffRequest` (nombre, presupuesto, interes, credito, motivo) y los motivos válidos, marcando cuáles son urgentes
- [x] 2.2 Reemplazar `HANDOFF_SENTINEL` por el formato con campos, conservando el nombre exportado que ya usan los tests
- [x] 2.3 Escribir los tests de `parseGeneration` para el formato nuevo: sentinel completo, con `?`, con campos en otro orden, con espacios de más, mal formado, y sentinel desnudo
- [x] 2.4 Implementar el parseo en `parseGeneration` (`src/lib/ai/generate.ts`) hasta que esos tests pasen

## 3. Instrucciones al modelo

- [x] 3.1 Reescribir el bloque de handoff de `buildSystemPrompt` en modo `auto_reply`: formato exacto del sentinel, los cuatro datos obligatorios, `?` para lo desconocido, prohibición de inventar, y la lista de motivos
- [x] 3.2 Quitar el "Prefer handing off over guessing" y sustituirlo por la regla de que transferir exige datos
- [x] 3.3 Actualizar los tests de `defaults.test.ts` que asertan sobre el scaffold

## 4. El gate

- [x] 4.1 Escribir los tests del gate en `auto-reply.test.ts` cubriendo cada escenario del spec: falta un dato, datos completos, urgencia con nombre, urgencia sin nombre, segundo intento urgente, y reintento no urgente
- [x] 4.2 Implementar la evaluación del gate como función pura en `src/lib/ai/handoff-gate.ts` (archivo aparte: separa la decisión de la nota interna) (campos faltantes, urgencia, escape por intentos)
- [x] 4.3 Sustituir `if (handoff || !text)` en `auto-reply.ts` por la decisión del gate, conservando el camino `!text` sin sentinel como transferencia directa
- [x] 4.4 Camino de handoff rechazado: enviar el texto del turno si lo hay, e incrementar `ai_handoff_attempts`
- [x] 4.5 Camino de handoff rechazado sin texto: segunda generación con la instrucción inyectada de pedir los campos faltantes
- [x] 4.6 Verificar que un handoff rechazado no asigna asesor, no apaga el bot y no envía el aviso al cliente

## 5. Nota interna para el asesor

- [x] 5.1 Extender `buildHandoffSummary` para incluir los datos recolectados y el motivo, marcando los faltantes
- [x] 5.2 Actualizar los tests de `handoff.test.ts`

## 6. Reactivación

- [x] 6.1 Resetear `ai_handoff_attempts` en `api/ai/autoreply/[conversationId]/route.ts`, junto al `ai_handoff_summary` que ya limpia
- [x] 6.2 Test de que reactivar el bot deja la conversación como nueva para el gate

## 7. Cierre

- [x] 7.1 Correr la suite completa y el lint
- [ ] 7.2 Aplicar la migración en el VPS
- [ ] 7.3 Ajustar el `system_prompt` de LoraMotors para nombrar los motivos con los valores del parser
- [ ] 7.4 Probar en producción el guion que falló: saludo, presupuesto, y confirmar que muestra vehículos en vez de transferir
