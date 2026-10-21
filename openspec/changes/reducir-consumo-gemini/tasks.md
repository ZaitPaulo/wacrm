## 1. Base de datos

- [x] 1.1 Escribir `supabase/migrations/557_ai_token_economy.sql` (idempotente): `ai_usage_log.cached_tokens integer NOT NULL DEFAULT 0`; `ai_configs.billing_alerted_at timestamptz`, `business_hours_reply_budget_enabled boolean NOT NULL DEFAULT false`, `business_hours_reply_budget integer NOT NULL DEFAULT 3` con CHECK 1–20
- [x] 1.2 En la misma migración, reescribir ENTERO `notifications_type_check` copiando la lista vigente de la 549 y agregando `ai_billing_exhausted`; verificar que no colisione con la 556 reservada
- [x] 1.3 Aplicar la migración en el stack local y comprobar que se pueda insertar una notificación de cada tipo existente y del nuevo (2026-10-20: 15/15 tipos insertados en transacción revertida; CHECK 1–20 presente; segunda corrida idempotente)

## 2. Fase 1 — tokens cacheados y razonamiento

- [x] 2.1 Agregar `cached` a `AiUsage` y a `normalizeUsage`; leer `usage.prompt_tokens_details.cached_tokens` en `openai-compatible.ts` (0 si no viene)
- [x] 2.2 Escribir `cached_tokens` en `ai_usage_log` desde `usage.ts`
- [x] 2.3 Agregar `aiReasoningEffort()` en `defaults.ts` (`AI_REASONING_EFFORT`: low|medium|high|none, por defecto low) y la opción `extraBody` en `OpenAiCompatibleOptions`; enviarla solo desde `providers/gemini.ts`
- [x] 2.4 Pruebas: uso con y sin `prompt_tokens_details`; cuerpo de Gemini con `reasoning_effort: "low"` y sin él cuando vale `none`; OpenAI y OpenRouter sin cambios

## 3. Fase 1 — prefijo estable del prompt

- [x] 3.1 Reordenar `buildSystemPrompt` según D1: protocolo de traspaso y "nombre una sola vez" siempre en `auto_reply`; etiquetas `[Foto]` dentro del prefijo; anuncio, espera, fotos y extractos después
- [x] 3.2 Prueba: el prefijo es idéntico carácter por carácter entre conversación normal, en espera, con anuncio, con fotos y con extractos de la misma cuenta
- [x] 3.3 Prueba: el conjunto de bloques de texto es el mismo que antes del cambio para cada estado (ninguna regla se pierde ni cambia de redacción)
- [x] 3.4 Prueba: en espera, la instrucción de espera va después del protocolo y el marcador de traspaso se sigue ignorando

## 4. Fase 1 — saldo agotado

- [x] 4.1 Mapear en `providerHttpError` el HTTP 402 y los mensajes de créditos prepago o facturación a `billing_exhausted`; dejarlo fuera de `TRANSIENT_AI_ERRORS`
- [x] 4.2 Implementar `notifyBillingExhausted(db, accountId)`: claim atómico de `ai_configs.billing_alerted_at` (NULL o más de 6 h) y notificación `ai_billing_exhausted` a owner y admin; textos en `messages/es.json`, `en.json` y `ko.json`
- [x] 4.3 En el `catch` del auto-reply, con `billing_exhausted`: avisar y traspasar con la nota de saldo agotado
- [x] 4.4 Pruebas: un 402 no reintenta; un 500 sí reintenta una vez; dos fallos dentro de 6 h generan un solo aviso; a las 7 h sale otro; ningún envío por WhatsApp

## 5. Fase 2 — inventario por referencia e historial

- [x] 5.1 Quitar la URL de `linea()` en `inventory-index.ts` y conservar la URL en `entries`; ajustar el bloque de inventario de `buildSystemPrompt` para pedir `[[FOTOS <ref>]]`
- [x] 5.2 Implementar `expandVehicleLinks(text, entries)` en `vehicle-links.ts` (tolera espacios y mayúsculas, quita referencias desconocidas) y aplicarlo antes del filtro de fugas y antes de `ensureVehicleLinks`
- [x] 5.3 Pruebas: marcador expandido, referencia inexistente eliminada, vehículo sin marcador enlazado por el respaldo, ninguna respuesta enviada contiene `[[FOTOS`, el filtro de fugas no marca un marcador ya expandido
- [x] 5.4 Cambiar `DEFAULT_CONTEXT_MESSAGE_LIMIT` a 12 y actualizar sus pruebas
- [x] 5.5 Medir con un prompt real local los tokens antes y después (anotar la cifra en este archivo)
  - Sin la base de producción a mano, estimado por tamaño: cada línea pierde ` · https://loramotors.co/vehiculo/<uuid>` (~70 caracteres, ~25–30 tokens por el UUID) → con 126 vehículos, **~3,2–3,8 k tokens menos por llamada**. El historial de 20 → 12 quita ~1–1,5 k más. La cifra real sale de `ai_usage_log` en la tarea 7.4.

## 6. Fase 3 — presupuesto en horario laboral

- [x] 6.1 Leer las dos columnas nuevas en `loadAiConfig` (`AiConfig.businessHoursReplyBudget`) y el horario de la cuenta en `runAutoReply`; calcular `inHours` con `dentroDeHorario` (festivos incluidos)
- [x] 6.2 Espera en horario con el presupuesto encendido: salir antes del debounce y del claim (sin cupo, sin tokens)
- [x] 6.3 Cierre: con `ai_reply_count >= N` en horario, pasar `closing` a `buildSystemPrompt` y agregar la instrucción en la parte variable, sin tocar el control de datos
- [x] 6.4 Pruebas: tercera respuesta con datos completos traspasa; con datos incompletos sigue pidiéndolos y el control rechaza; fuera de horario sin cierre; conversación que empezó de noche recibe cierre a las 9:00; reclamo traspasa antes del tope; festivo cuenta como fuera de horario; presupuesto apagado no cambia nada; espera de noche responde y en horario calla
- [x] 6.5 Prueba: el prefijo estable no cambia con `closing` encendido
- [x] 6.6 Ajustes de IA: interruptor y N (1–20), solo owner/admin, validación en la API que guarda `ai_configs`, textos en los tres idiomas

## 7. Verificación y entrega

- [x] 7.1 Correr toda la suite de pruebas, el chequeo de tipos y el linter sin errores (2026-10-20: 195 archivos, 2.580 pruebas; `tsc` limpio; eslint 0 errores, 1 aviso previo en `ai-config.tsx`)
- [ ] 7.2 Probar en local una conversación completa en horario y otra fuera de horario contra el stack local
- [ ] 7.3 Dejar listo el commit en `develop`; desplegar una sola vez cuando el usuario lo indique, aplicar la 557 en el VPS y encender el presupuesto para LoraMotors (N = 3)
- [ ] 7.4 A los 7 días: medir en `ai_usage_log` tokens por llamada, `cached_tokens` y llamadas en horario frente a la línea base del 08–16/10, y revisar 20 conversaciones reales (razonamiento bajo e historial de 12)
