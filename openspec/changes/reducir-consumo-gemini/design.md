## Context

El bot de LoraMotors llama a `gemini-3.8-flash` por la superficie compatible con OpenAI (`providers/gemini.ts` → `openai-compatible.ts`), con saldo prepago de AI Studio. Medición del 08/10 al 16/10/2026: 1.457 llamadas, ~18,2 k tokens de entrada por llamada, ~11 de salida registrados por cada 1.000 de entrada. Una recarga de 60.000 dura ~8,5 días.

Composición estimada de una llamada: inventario ~7 k tokens (126 vehículos, cada uno con su URL `https://loramotors.co/vehiculo/<uuid>`), prompt de la cuenta ~4,5 k (15.674 caracteres), historial de 20 mensajes ~3–4 k, instrucciones fijas ~2 k, extractos de la base de conocimientos ~0,5 k.

Por horario (L–V 8–18, sáb 8–14): 60 % de las llamadas caen en horario laboral; el 28 % del total son respuestas en horario después de la tercera del día por conversación.

Restricciones fijadas por el usuario: ningún costo ni servicio nuevo; se conservan todas las reglas actuales del bot; el control de datos del traspaso no se relaja; en horario laboral el bot no retoma una conversación traspasada; el tope cuenta por conversación.

## Goals / Non-Goals

**Goals:**
- Bajar los tokens cobrados por llamada sin cambiar lo que el bot sabe ni cómo decide.
- Bajar las llamadas en horario laboral, cuando hay asesores.
- Saber cuánto descuenta el caché implícito de Gemini.
- Que un saldo agotado deje de pasar inadvertido.

**Non-Goals:**
- Caché explícito (`cachedContents`): cobra almacenamiento por hora y exige la API nativa.
- Cambiar de modelo o de proveedor.
- Recortar o reescribir el prompt de la cuenta (queda para una revisión aparte con el usuario).
- Retomar automáticamente conversaciones que el asesor no atiende.

## Decisions

### D1. Prefijo estable: mover, no reescribir
Orden nuevo de `buildSystemPrompt`: (1) tarea y pautas fijas, (2) protocolo de traspaso y "nombre una sola vez" — ahora siempre en `auto_reply`, también en espera —, (3) prompt de la cuenta, (4) inventario, (5) regla de crédito, (6) explicación de etiquetas `[Foto]` (fija, se adelanta); luego lo variable: anuncio, instrucción de cierre por presupuesto (D6), instrucción de espera, fotos, extractos.

En espera hoy se omite el protocolo de traspaso para no "enseñar" el marcador. Con el protocolo siempre presente, la instrucción de espera —que ya dice "This overrides any earlier instruction" y "never write a [[HANDOFF]] marker"— queda después y prevalece; además el código ya ignora el marcador en espera (escenario vigente "El modelo vuelve a pedir traspaso"). Así ninguna regla cambia de efecto.

*Alternativa:* dos prefijos (normal y espera). Descartada: parte el caché en dos y la diferencia que cubre ya la cubren la instrucción de espera y el código.

El caché implícito de Gemini se activa solo y sin costo cuando el comienzo de la petición coincide con una reciente. Con 6–9 llamadas por hora puede vencer entre llamadas; por eso D2 mide antes de prometer.

### D2. `cached_tokens` en `ai_usage_log`
`openai-compatible.ts` lee `usage.prompt_tokens_details.cached_tokens`; `normalizeUsage` y `AiUsage` ganan `cached`; `usage.ts` lo escribe. Columna `cached_tokens integer NOT NULL DEFAULT 0` en la migración 557. `prompt_tokens` sigue siendo el total, para no romper las comparaciones históricas.

### D3. `reasoning_effort`
Lo envía solo `providers/gemini.ts`, mediante una opción nueva `extraBody` de `OpenAiCompatibleOptions`, para no tocar OpenAI ni OpenRouter. Valor desde `aiReasoningEffort()` en `defaults.ts` (`AI_REASONING_EFFORT`, por defecto `low`; `none` lo omite). Revertir no requiere desplegar código: basta la variable y reiniciar el contenedor.

### D4. `billing_exhausted`
`providerHttpError` mapea 402, y mensajes que contengan "prepayment credits" / "billing", a `billing_exhausted` (status 502 al exterior). No está en `TRANSIENT_AI_ERRORS`: no se reintenta. En el `catch` del auto-reply, antes del traspaso por fallo, `notifyBillingExhausted(db, accountId)` inserta notificaciones `ai_billing_exhausted` para owner y admin. Antirrepetición: columna `ai_configs.billing_alerted_at`; el aviso sale solo si es NULL o tiene más de 6 h, con un UPDATE condicional atómico (mismo patrón de `claim` que `sla-job.ts`). La nota del traspaso nombra el saldo agotado. Los embeddings fallan igual y ya degradan a búsqueda léxica, así que no necesitan cambio.

El tipo nuevo exige reescribir **entero** el CHECK `notifications_type_check` (lección de la 549): copiar la lista vigente de la última migración que lo toca y agregar `ai_billing_exhausted`.

### D5. Enlaces por referencia
`linea()` deja de imprimir la URL; la referencia `public_ref` ya va primera. El bloque de inventario dice que, al nombrar un vehículo, escriba `[[FOTOS <ref>]]`. Nuevo `expandVehicleLinks(text, entries)` en `vehicle-links.ts`: reemplaza cada marcador por la URL de la entrada con esa referencia y quita los marcadores desconocidos. Se aplica antes de `ensureVehicleLinks`, que sigue de respaldo. El filtro de fugas trata `[[` como sospechoso, así que la expansión va ANTES del filtro (igual que `[[NO_REPLY]]` se quita antes), y el filtro sigue marcando cualquier `[[` que sobreviva.

Ahorro estimado: ~25 tokens × 126 líneas ≈ 3 k tokens por llamada.

*Alternativa:* URL corta `/v/<ref>`. Descartada: obliga a una ruta nueva y el modelo puede seguir escribiéndola mal; el marcador lo valida el código.

### D6. Presupuesto en horario
Columnas `ai_configs.business_hours_reply_budget_enabled boolean NOT NULL DEFAULT false` y `business_hours_reply_budget integer NOT NULL DEFAULT 3 CHECK (between 1 and 20)`. En `runAutoReply`, después de cargar la conversación, se calcula `inHours = dentroDeHorario(now, horarioDeLaCuenta)` con la utilidad existente de `outbound/business-hours.ts` (festivos incluidos).
- **Espera en horario**: si `waiting && budgetEnabled && inHours` → `return` antes del debounce y del claim. No gasta cupo ni tokens. Los avisos de plazo (`handoff/sla-job.ts`) no dependen del bot y siguen.
- **Cierre**: si `!waiting && budgetEnabled && inHours && ai_reply_count >= N` → `buildSystemPrompt` recibe `closing: true` y agrega, en la parte variable, la instrucción: "You have already replied N times during business hours. Stop exploring options: collect, one at a time, only what the handoff still needs for its reason, and hand off as soon as it is complete (motivo=otro if none applies)". El control de datos no cambia.

Se usa `ai_reply_count` porque ya existe, se incrementa atómicamente en `claim_ai_reply_slot` y se reinicia al traspasar: así "por conversación" queda como "desde el último traspaso o reactivación", que es lo que mide la regla.

*Alternativa:* traspasar desde el código al llegar a N. Descartada por el usuario: saltaría el control de datos.

### D7. Ajustes
El formulario de configuración del bot (ajustes de IA, solo owner/admin, como los demás campos de `ai_configs`) gana el interruptor y N, con textos en `messages/es.json`, `en.json` y `ko.json`. La API que guarda `ai_configs` valida el rango.

### D8. Historial
`DEFAULT_CONTEXT_MESSAGE_LIMIT` pasa de 20 a 12.

## Risks / Trade-offs

- [El caché implícito acierta poco con 6–9 llamadas por hora] → D2 lo mide; si no acierta, el ahorro sigue viniendo de D5, D6 y D8. El caché explícito queda como decisión aparte, porque tiene costo.
- [El razonamiento bajo empeora respuestas complejas (crédito, permutas)] → Revisar 20 conversaciones reales la primera semana; con `AI_REASONING_EFFORT=medium` se revierte sin desplegar.
- [El modelo escribe mal el marcador o no lo escribe] → La expansión tolera espacios y mayúsculas; `ensureVehicleLinks` sigue de respaldo; un escenario de prueba garantiza que ningún `[[FOTOS` llegue al cliente.
- [Con 12 mensajes, el bot vuelve a preguntar algo dicho antes] → La regla "no vuelvas a pedir lo que ya dijo" se conserva; si aparece en la revisión, se sube con la variable de entorno.
- [Espera silenciosa en horario con un asesor que no responde] → Elegido por el usuario. Los recordatorios y escalamientos de plazo siguen avisando a asesor y admin.
- [Con el control de datos intacto, la fase 3 ahorra menos del 28 % medido] → Estimado 10–15 %; se mide con `ai_usage_log` después de una semana.
- [Reescribir el CHECK de notificaciones olvida un tipo] → Copiar la lista de la última migración que lo define y probar la inserción de cada tipo existente.

## Migration Plan

1. Migración `557_ai_token_economy.sql`, idempotente: `ai_usage_log.cached_tokens`; `ai_configs.billing_alerted_at`, `business_hours_reply_budget_enabled`, `business_hours_reply_budget`; CHECK de `notifications` completo con `ai_billing_exhausted`; GRANT si aplica.
2. Desplegar las fases en un solo paso (comitear y desplegar una sola vez cuando el usuario lo indique). Las fases son de implementación y prueba, no despliegues separados.
3. Tras el despliegue, encender el presupuesto en horario para LoraMotors desde ajustes (N = 3).
4. A los 7 días: consulta de `ai_usage_log` (tokens por llamada, `cached_tokens`, llamadas en horario) frente a la línea base del 08–16/10.

**Rollback:** el presupuesto se apaga desde ajustes; `AI_REASONING_EFFORT=none` y `AI_CONTEXT_MESSAGE_LIMIT=20` por entorno; el resto con `git revert`. La migración solo agrega columnas con valor por defecto y un tipo de notificación, así que no hace falta revertirla.

## Open Questions

- ¿Qué tanto descuenta Gemini 3.8 Flash por token cacheado? Se verá en el informe de facturación de AI Studio cuando haya datos de `cached_tokens`.
