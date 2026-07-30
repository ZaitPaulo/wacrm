# Compuerta de respuesta del auto-reply de IA

Fecha: 2026-07-30
Estado: aprobado, pendiente de implementar
Archivo principal: `src/lib/ai/auto-reply.ts`

## Problema

Dos comportamientos observados en producción, ambos sobre *cuándo* debe hablar la IA.

### 1. Una automatización de mensaje apaga la IA en toda la cuenta

`dispatchInboundToAiReply` consulta si **existe** alguna automatización activa con
trigger `new_message_received` o `keyword_match` y, si la hay, hace `return`:

```js
// auto-reply.ts:61-68 (actual)
const { data: autoResponders } = await db
  .from('automations')
  .select('id')
  .eq('is_active', true)
  .in('trigger_type', ['new_message_received', 'keyword_match'])
  .limit(1)
if (autoResponders && autoResponders.length > 0) return
```

Es una consulta por existencia: no evalúa si la keyword coincide con el mensaje, ni si
la automatización envía algo al cliente. Una automatización que solo etiqueta y crea un
deal deja al cliente sin ninguna respuesta.

Verificado en la cuenta `f7aa2ec8`: la automatización *Lead Qualifier*
(`keyword_match`) mantuvo `ai_usage_log` vacío — el modelo no se invocó nunca.

### 2. Cada mensaje de una ráfaga produce una respuesta

El webhook llama a `dispatchInboundToAiReply` una vez por mensaje entrante, sin
agrupar. Traza real:

```
20:12:30  CLIENTE  "como unos 60 millones"
20:12:33  CLIENTE  "un suv"
20:12:35  CLIENTE  "kia"
20:12:39  BOT(IA)  "¡Excelente! Con un presupuesto de aproxima…"
20:12:43  BOT(IA)  "¡Entendido! Un SUV con un presupuesto…"
20:12:46  BOT(IA)  "¡Excelente! Con esos datos, hemos encontra…"
```

El contexto no se pierde (`buildConversationContext` trae los últimos 20 mensajes y
`mergeConsecutive` une los turnos del mismo rol), pero se responde tres veces. Los
tokens por llamada crecen —1528 → 2111 → 2376— porque cada contexto incluye las
respuestas que el propio bot acaba de emitir: **6.015 tokens donde bastaban ~1.500**.

## Requisito

El cliente recibe **exactamente una** respuesta por ráfaga: de una automatización o de
la IA, nunca ambas, nunca ninguna. Las automatizaciones que no responden al cliente
(etiquetar, crear deal, webhook) se ejecutan siempre sin bloquear a la IA.

Criterio decidido: lo que cuenta es si el cliente **realmente recibió** un mensaje, no
si una automatización estaba configurada para enviarlo. Si sus condiciones la detienen
o el envío falla, la IA responde.

## Diseño

Todo ocurre en `dispatchInboundToAiReply`. No se toca `engine.ts` —el archivo más
grande de upstream— para no acumular conflictos en cada sync del fork.

### Firma

Recibe además el mensaje que disparó el dispatch:

```ts
interface DispatchArgs {
  accountId: string
  conversationId: string
  contactId: string
  configOwnerUserId: string
  inboundMessageId: string   // nuevo
}
```

El webhook ya tiene ese id disponible en el punto de llamada.

### Secuencia

1. **Gates baratos** (sin cambios): config ausente o inactiva, `autoReplyEnabled` en
   false, hilo asignado a un humano, `ai_autoreply_disabled`, cap alcanzado.
   Van **antes** de la espera para no ocupar 8 s en un caso que igual abortaría.

2. **Se elimina** la consulta de automatizaciones (punto 1 del problema). La reemplaza
   la sonda del paso 5.

3. **Espera de agrupación**: `await delay(aiReplyDebounceMs())`, por defecto 8000 ms,
   configurable con `AI_REPLY_DEBOUNCE_MS`.

4. **Guard de recencia**: si existe un mensaje con `sender_type = 'customer'` y
   `created_at` posterior al inbound → `return`. El dispatch de ese mensaje responderá,
   con más contexto.

5. **Sonda de respuesta**: si existe un mensaje con `sender_type <> 'customer'`,
   `status <> 'failed'` y `created_at` posterior al inbound → `return`. Ya le
   respondieron.

   Al no preguntar *quién* respondió, la misma consulta cubre automatización, flow y
   agente humano. El filtro por `status` es lo que garantiza que un envío fallido no
   deje al cliente en silencio.

6. **Reclamo del slot antes de generar**: `claim_ai_reply_slot` pasa a ejecutarse
   *antes* de `generateReply`, no después. Si no hay slot, no se llama al modelo.

7. Contexto, knowledge, generación y envío, sin cambios.

El contexto se construye **después** de la espera, de modo que incluye toda la ráfaga.

### Orden de las verificaciones y gasto de tokens

Los pasos 4, 5 y 6 son consultas a la base y ocurren antes de `generateReply`. En una
ráfaga de tres mensajes se hace **una sola** llamada al modelo.

Queda un gasto inevitable: cuando el modelo emite `[[HANDOFF]]` ya consumió tokens sin
que el cliente reciba nada. No hay forma de saber que no puede ayudar sin preguntarle.

### Comportamiento resultante

```
20:12:30  "como unos 60 millones"  → espera 8s → llegó :33 → aborta (0 tokens)
20:12:33  "un suv"                 → espera 8s → llegó :35 → aborta (0 tokens)
20:12:35  "kia"                    → espera 8s → nadie más → genera y responde
20:12:43  BOT: una respuesta con presupuesto + tipo + marca
```

Con *Lead Qualifier* activa: si solo etiqueta y crea el deal, la sonda no ve salida y la
IA responde. Si envía la cotización, la sonda la ve y la IA calla.

## Pruebas

En `auto-reply.test.ts`, con base y proveedor mockeados:

1. Ráfaga de tres mensajes → una sola invocación del proveedor.
2. Automatización que solo etiqueta → la IA responde.
3. Automatización que envió un mensaje → la IA calla, sin llamar al proveedor.
4. Mensaje saliente con `status = 'failed'` → la IA responde.
5. Agente humano respondió durante la espera → la IA calla.
6. Sin slot disponible en el cap → no se llama al proveedor.

## Costos y riesgos

- **Latencia**: toda respuesta llega ~8 s más tarde. Es el precio de agrupar; ajustable
  por `AI_REPLY_DEBOUNCE_MS`.
- **Ocupación del webhook**: la espera mantiene viva la invocación esos 8 s. Con
  `maxDuration = 60` hay margen, pero con volumen alto de mensajes simultáneos esto se
  vuelve caro en tiempo de función; ahí la opción correcta pasa a ser encolar y procesar
  desde el cron (`automation_pending_executions` ya existe, pero
  `AUTOMATION_CRON_SECRET` está comentado en `.env`).
- **Slot consumido sin respuesta**: al reclamar antes de generar, un fallo de generación
  consume un slot del cap sin haber respondido. Con el cap en 20 es despreciable, y es
  la contrapartida deliberada de no gastar tokens.

## Alternativas descartadas

- **Instrumentar `engine.ts`** para que reporte si envió: propagar el flag por cuatro
  capas con recursión, y solo detectaría envíos de automatizaciones (no de flows ni de
  humanos). Además garantiza conflictos en cada merge con upstream.
- **Decidir por `action_type` configurado**: si las condiciones detienen la
  automatización antes de enviar, el cliente queda sin respuesta. Viola el requisito.
- **Cola diferida con cron**: más robusto y sin ocupar el webhook, pero exige activar
  `AUTOMATION_CRON_SECRET` y montar un pinger. Es el camino si la latencia o el volumen
  lo justifican más adelante.
