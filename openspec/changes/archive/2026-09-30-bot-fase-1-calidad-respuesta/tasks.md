## 1. Filtro de salida

- [x] 1.1 Pruebas de `detectLeak` en `src/lib/ai/output-guard.test.ts`, con los casos de la spec: el razonamiento real del 26/09, el marcador y sus campos, los términos internos, y como negativos respuestas reales del log con nombres de vehículos en inglés ("GT Line", "Active Tourer", "Touring").
- [x] 1.2 Implementar `detectLeak` en `src/lib/ai/output-guard.ts` con las tres reglas del diseño.
- [x] 1.3 Agregar `AiReply.safeFallback` a `messages/{es,en,ko}.json` y el lector con respaldo (`src/lib/i18n/server-catalog.ts`). La instrucción de reintento por fuga va al modelo, no al cliente: queda como constante `LEAK_RETRY_INSTRUCTION` en `output-guard.ts`.

## 2. Respuesta segura y reintento en el auto-reply

- [x] 2.1 Agregar `aiProviderRetryDelayMs()` en `src/lib/ai/defaults.ts` (variable `AI_PROVIDER_RETRY_DELAY_MS`, 3000 por defecto), con prueba.
- [x] 2.2 Pruebas en `auto-reply.test.ts`: fuga que se regenera limpia, fuga persistente que envía el mensaje seguro, reintento exitoso tras `timeout`, doble fallo que traspasa, `invalid_key` sin reintento, y mensaje nuevo del cliente durante la espera del reintento (sin respuesta ni traspaso).
- [x] 2.3 Implementar `generateSafeReply` en `auto-reply.ts`: generación con reintento por fallo transitorio, filtro con una regeneración, `SupersededError` y conservación del `handoff` declarado.
- [x] 2.4 Usar `generateSafeReply` en los tres caminos, incluida la regeneración con `buildGateRetryInstruction`.

## 3. El traspaso manda primero la respuesta

- [x] 3.1 Pruebas en `auto-reply.test.ts`: con traspaso aceptado y `text` no vacío, se envía el texto (con enlaces) y después el aviso, en ese orden. Con solo el marcador, solo el aviso. Si el envío del texto falla, el traspaso sigue.
- [x] 3.2 Implementarlo en el camino `gate.transfer` de `dispatchInboundToAiReply`.

## 4. Aviso con cuándo lo contactan

- [x] 4.1 Pruebas de `handoffWhen` en `src/lib/handoff/when.test.ts` con fechas fijas: en horario, noche de martes, sábado por la tarde (lunes), víspera de festivo colombiano y sin horario.
- [x] 4.2 Implementar `handoffWhen` en `src/lib/handoff/when.ts`, reutilizando `dentroDeHorario` y `proximaApertura`.
- [x] 4.3 Agregar a los mensajes `Handoff.whenSoon`, `whenToday`, `whenTomorrow`, `whenWeekday` y `weekdays`, en español y en inglés.
- [x] 4.4 En `notify-customer.ts`: leer el horario de la cuenta (si falla, sin mención de tiempo) y componer el aviso. Actualizar sus pruebas.

## 5. Selector de plantillas

- [x] 5.1 Pruebas de `greetingVariableIndices`, `firstNameForGreeting` e `isPlaceholderValue` en `src/lib/whatsapp/template-prefill.test.ts`: "JEFERSON veroes" → "Jeferson", "⭐" → null, "Dios es amor" → "Dios", "1" y "J" son relleno, "Ana" no lo es.
- [x] 5.2 Implementar `src/lib/whatsapp/template-prefill.ts`.
- [x] 5.3 `TemplatePicker`: prop `contactName`, llenado al elegir la plantilla, `canConfirm` con `isPlaceholderValue`, aviso junto al campo (`Inbox.templatePicker.placeholderValueHint` en español y en inglés).
- [x] 5.4 Pasar `contactName` desde `message-thread.tsx` y `contact-detail-view.tsx`.

## 6. Verificación

- [x] 6.1 `npx vitest run` completo en verde, `npx tsc --noEmit` y `npx eslint` sobre los archivos tocados.
- [x] 6.2 Correr `detectLeak` sobre las 1.879 respuestas exportadas del bot (scratchpad `conversaciones_bot.txt`): debe marcar la del 26/09 y ninguna otra, o solo falsos positivos revisados y aceptados.
- [ ] 6.3 Probar en local: selector de plantillas con un contacto con nombre y otro sin nombre, y aviso de traspaso en horario y fuera de horario (cambiando la hora simulada en la prueba).
