## 1. Ventana de agrupación configurable

- [x] 1.1 Escribir el test de `aiReplyDebounceMs()` en `src/lib/ai/defaults.test.ts`: por defecto 8000, respeta un override válido, cae al default con valores no numéricos o negativos, y acepta 0 para desactivar la espera
- [x] 1.2 Verificar que el test falla (`npx vitest run src/lib/ai/defaults.test.ts`)
- [x] 1.3 Implementar `aiReplyDebounceMs()` en `src/lib/ai/defaults.ts` leyendo `AI_REPLY_DEBOUNCE_MS`, con guarda `>= 0` (a diferencia de `aiRequestTimeoutMs`, aquí 0 es válido)
- [x] 1.4 Verificar que el test pasa
- [x] 1.5 Documentar `AI_REPLY_DEBOUNCE_MS` en `.env.local.example`, junto a `AI_CONTEXT_MESSAGE_LIMIT`
- [x] 1.6 Commit

## 2. Consultas de ventana temporal

- [x] 2.1 Escribir `src/lib/ai/reply-window.test.ts` cubriendo: `hasNewerCustomerMessage` verdadero/falso, `hasOutboundSince` verdadero/falso, exclusión de `status = 'failed'`, desempate por id ante `created_at` igual, y que ambas devuelven `false` cuando la consulta falla
- [x] 2.2 Verificar que el test falla (no existe el módulo)
- [x] 2.3 Crear `src/lib/ai/reply-window.ts` con `InboundRef`, `delay(ms)`, `hasNewerCustomerMessage(db, conversationId, inbound)` y `hasOutboundSince(db, conversationId, inbound)`
- [x] 2.4 Implementar el filtro "posterior a" como `created_at.gt.<ts>` OR (`created_at.eq.<ts>` AND `id.gt.<id>`), para que dos mensajes con la misma marca de tiempo tengan un orden total
- [x] 2.5 Hacer que ambas consultas registren el error en consola y devuelvan `false`, de modo que un fallo de base nunca deje al cliente sin respuesta
- [x] 2.6 Verificar que el test pasa
- [x] 2.7 Commit

## 3. Compuerta en el auto-reply

- [x] 3.1 Añadir a `src/lib/ai/auto-reply.test.ts` los mocks de `./reply-window` y los casos: se cancela ante un mensaje más nuevo sin invocar al proveedor; se cancela si ya salió una respuesta; responde cuando una automatización corrió pero no envió nada; la espera ocurre antes de construir el contexto; sin cupo no se invoca al proveedor
- [x] 3.2 Verificar que los tests nuevos fallan
- [x] 3.3 Extender `DispatchArgs` en `src/lib/ai/auto-reply.ts` con `inboundMessageId` e `inboundCreatedAt`
- [x] 3.4 Eliminar la consulta a `automations` y su `return` (el gate por existencia que apagaba la IA en toda la cuenta)
- [x] 3.5 Insertar `await delay(aiReplyDebounceMs())` después de los gates baratos y antes de construir el contexto, para que el transcript incluya toda la ráfaga
- [x] 3.6 Añadir los dos guards: `hasNewerCustomerMessage` y `hasOutboundSince`, ambos con `return` silencioso
- [x] 3.7 Mover el bloque de `claim_ai_reply_slot` para que corra antes de `generateReply`, y actualizar su comentario explicando el nuevo orden y la contrapartida (un fallo de generación quema un cupo)
- [x] 3.8 Actualizar los tests preexistentes que asumían el gate de automatizaciones: ese comportamiento se eliminó a propósito
- [x] 3.9 Verificar que toda la suite de `src/lib/ai/` pasa
- [x] 3.10 Commit

## 4. Propagación desde el webhook

- [x] 4.1 En `src/app/api/whatsapp/webhook/route.ts`, hacer que el insert del mensaje entrante devuelva la fila con `.select('id, created_at').single()` (hoy la descarta), conservando intactos todos los campos insertados
- [x] 4.2 Pasar `inboundMessageId` e `inboundCreatedAt` en la llamada a `dispatchInboundToAiReply`, y exigir que la fila insertada exista en la condición de guarda
- [x] 4.3 Verificar tipos con `npx tsc --noEmit`
- [x] 4.4 Verificar el build con `npm run build`
- [x] 4.5 Correr la suite completa; deben pasar todos salvo los 5 fallos ambientales preexistentes de `currency.test.ts` y `date-utils.test.ts`, que dependen de la zona horaria `America/Bogota` y el locale `es-CO`
- [x] 4.6 Commit

## 5. Verificación contra WhatsApp real

- [ ] 5.1 Con el auto-reply activo y sin automatizaciones de mensaje, enviar tres mensajes seguidos en menos de 8 segundos y confirmar que llega una sola respuesta que considera los tres
- [ ] 5.2 Confirmar en `ai_usage_log` que esa ráfaga registró una sola fila, no tres
- [ ] 5.3 Reactivar *Lead Qualifier* dejándole solo acciones que no envían mensajes, y confirmar que la automatización etiqueta y además la IA responde
- [ ] 5.4 Añadirle a esa automatización una acción `send_message` y confirmar que llega solo la respuesta de la automatización, que la IA calla y que `ai_usage_log` no crece
- [ ] 5.5 Si algún caso se desvía del spec, volver al diseño antes de parchear
