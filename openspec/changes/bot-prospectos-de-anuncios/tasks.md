## 1. Enlaces garantizados (I) — primero, es lo más chico y de impacto inmediato

- [x] 1.1 Prueba: `buildInventoryIndex` incluye `<base>/vehiculo/<id>` en cada línea y devuelve las entradas estructuradas (`id`, `model`, `year`, `price`, `url`)
- [x] 1.2 Agregar `id` al `select` del índice, la URL a cada línea (misma base que `knowledge-sync`) y exponer las entradas
- [x] 1.3 Pruebas de `ensureVehicleLinks`: agrega el enlace faltante (caso Sorento Radical), no toca un texto que ya los trae, ignora menciones sin año, desempata por precio, tope de 3, descarta "new"/"all" como token de modelo
- [x] 1.4 Implementar `ensureVehicleLinks` como función pura en `src/lib/ai/vehicle-links.ts`
- [x] 1.5 Aplicarla en `auto-reply.ts` sobre el texto final antes de `engineSendText` (no en borradores)
- [x] 1.6 Actualizar el texto del prompt en `defaults.ts` que describe el índice: ahora trae el enlace de la ficha

## 2. Perfil de crédito en el traspaso (E)

- [x] 2.1 Pruebas de `evaluateHandoffGate`: con crédito exige `ocupacion` e `ingresos`; de contado no; salida con `attempts >= 1` cuando solo faltan esos dos; sin salida si falta uno de los cuatro obligatorios
- [x] 2.2 Agregar `ocupacion` e `ingresos` a `HandoffRequest` (`types.ts`) y al parser del sentinel, con sus pruebas
- [x] 2.3 Implementar la regla en `handoff-gate.ts`
- [x] 2.4 `buildHandoffSummary`: línea "Ocupación · Ingresos" cuando hay crédito, con faltantes marcados; pruebas
- [x] 2.5 `buildGateRetryInstruction`: nombres legibles para los campos nuevos y la aclaración de no pedir cédula ni datos bancarios; pruebas
- [x] 2.6 Documentar en el formato del sentinel del prompt (`defaults.ts`) los dos campos nuevos

## 3. Guardar el origen publicitario (A)

- [x] 3.1 Verificar el siguiente número de migración libre (repo y `openspec/changes/*`) y crear `5NN_message_referral.sql` con `messages.referral jsonb`
- [x] 3.2 Prueba de webhook: un mensaje con `referral` se guarda con él; uno con `referral` parcial también; sin `referral` queda nulo
- [x] 3.3 Declarar `referral` en `WhatsAppMessage`, llevarlo a `NormalizedInbound` y escribirlo en el upsert de `persistInbound`

## 4. La automatización cede el turno (A)

- [ ] 4.1 Pruebas del motor: condición `from_ad` verdadera con referral en el contexto, falsa sin él
- [ ] 4.2 Pasar `from_ad` en el contexto de `runAutomationsForTrigger` desde `fanOutInbound`
- [ ] 4.3 Implementar el `case 'from_ad'` en `evaluateCondition` y aceptarlo en `validate.ts`
- [ ] 4.4 Editor: opción "Viene de un anuncio" en el selector de condiciones, sin operando; textos en `es` (y `en` si existe el catálogo)
- [ ] 4.5 Prueba de integración: Bienvenida con raíz `from_ad` y rama sí vacía → no envía, y la IA no queda bloqueada por `hasOutboundSince`

## 5. La IA usa el contexto del anuncio (A)

- [ ] 5.1 Prueba: `buildSystemPrompt` con `adContext` agrega la sección del anuncio; sin él no la agrega
- [ ] 5.2 Leer el referral más reciente de la conversación en `auto-reply.ts` (una consulta, en el `Promise.all` existente) y pasarlo al prompt
- [ ] 5.3 Nota de traspaso: "Origen: anuncio · <titular>" cuando la conversación tiene referral; prueba
- [ ] 5.4 Bandeja: marca de origen con el titular en el mensaje que trae referral

## 6. Verificación y despliegue

- [ ] 6.1 Suite completa, `tsc --noEmit` y lint en verde
- [ ] 6.2 Prueba local con un payload real de anuncio (referral de ejemplo de la documentación de Meta)
- [ ] 6.3 Merge a `develop`, promover a `main`, respaldo y despliegue en el VPS; confirmar que la migración se aplicó
- [ ] 6.4 Producción: reconfigurar la Bienvenida con la raíz "viene de un anuncio" (sí → nada)
- [ ] 6.5 Producción: ajustar el `system_prompt` (crédito: pedir ocupación e ingresos aproximados; si viene de anuncio, mencionar la vitrina loramotors.co)
- [ ] 6.6 Revisar en la base los primeros prospectos de anuncio tras el despliegue: referral guardado, primera respuesta de la IA, enlaces presentes
