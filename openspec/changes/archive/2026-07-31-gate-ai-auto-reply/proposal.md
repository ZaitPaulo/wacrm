## Why

El auto-reply de IA decide mal cuándo hablar, y falla en las dos direcciones: a veces no responde nada y a veces responde de más.

Una sola automatización activa con trigger `keyword_match` o `new_message_received` apaga el auto-reply en **toda la cuenta**, aunque esa automatización solo etiquete al contacto y nunca le escriba al cliente. Observado en producción: con *Lead Qualifier* activa, `ai_usage_log` quedó vacío — el modelo no se invocó ni una vez.

En el otro extremo, cada mensaje entrante dispara su propia respuesta. Los clientes escriben una idea en varios mensajes cortos, y el bot contesta a cada fragmento:

```
20:12:30  CLIENTE  "como unos 60 millones"
20:12:33  CLIENTE  "un suv"
20:12:35  CLIENTE  "kia"
20:12:39  BOT(IA)  "¡Excelente! Con un presupuesto de aproxima…"
20:12:43  BOT(IA)  "¡Entendido! Un SUV con un presupuesto…"
20:12:46  BOT(IA)  "¡Excelente! Con esos datos, hemos encontra…"
```

Esa ráfaga costó **6.015 tokens** de la clave del cliente cuando una sola respuesta habría costado ~1.500: los tokens por llamada crecen (1528 → 2111 → 2376) porque cada contexto incluye las respuestas que el propio bot acaba de emitir.

## What Changes

- **BREAKING** (de comportamiento, no de API): el auto-reply deja de consultar si *existe* una automatización de mensaje activa. Pasa a decidir por el efecto real: si el cliente ya recibió un mensaje, calla; si no, responde.
- El auto-reply espera una ventana de agrupación configurable antes de generar, de modo que una ráfaga produzca una sola respuesta con todo el contexto.
- Antes de generar, se verifica que no haya llegado un mensaje más nuevo del cliente ni haya salido una respuesta hacia él.
- El reclamo del cupo por conversación (`claim_ai_reply_slot`) pasa a ocurrir **antes** de generar, para no gastar tokens cuando el cupo está agotado.
- El webhook pasa al auto-reply el identificador y la marca de tiempo del mensaje entrante que lo disparó.
- Nueva variable de entorno `AI_REPLY_DEBOUNCE_MS` (por defecto 8000).

## Capabilities

### New Capabilities
- `ai-reply-gating`: cuándo el auto-reply de IA debe responder a un mensaje entrante — agrupación de ráfagas, convivencia con automatizaciones/flows/agentes humanos, y en qué punto se gasta presupuesto del proveedor.

### Modified Capabilities
<!-- Ninguna: openspec/specs/ está vacío; esta es la primera capacidad documentada del repo. -->

## Impact

**Código afectado**
- `src/lib/ai/auto-reply.ts` — se elimina el gate por existencia de automatizaciones; se añaden la espera y las dos verificaciones; se reordena el reclamo del cupo.
- `src/lib/ai/reply-window.ts` (nuevo) — las consultas de ventana temporal.
- `src/lib/ai/defaults.ts` — lectura de `AI_REPLY_DEBOUNCE_MS`.
- `src/app/api/whatsapp/webhook/route.ts` — el insert del mensaje entrante debe devolver `id` y `created_at` (hoy los descarta) para pasarlos al dispatch.

**Explícitamente fuera de alcance**
- `src/lib/automations/engine.ts` no se toca. Es de los archivos más grandes de upstream y este repo es un fork que se sigue sincronizando (el último merge trajo 119 commits); instrumentarlo garantizaría conflictos en cada sync.

**Sin cambios**
- Esquema de base de datos: se consultan columnas que ya existen (`messages.sender_type`, `messages.status`, `messages.created_at`).
- Contrato de las automatizaciones: siguen ejecutándose exactamente igual y antes que la IA.

**Operación**
- Toda respuesta del bot llega ~8 s más tarde. Es el costo de agrupar, ajustable por entorno.
- La espera mantiene viva la invocación del webhook esos segundos. Con `maxDuration = 60` hay margen; con volumen alto de mensajes simultáneos convendría encolar y procesar por cron (`automation_pending_executions` ya existe, pero `AUTOMATION_CRON_SECRET` está comentado en `.env`).
