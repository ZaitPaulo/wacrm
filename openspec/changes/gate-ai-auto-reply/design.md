## Context

`dispatchInboundToAiReply` (`src/lib/ai/auto-reply.ts`) se invoca desde el bloque `after()` del webhook de WhatsApp, una vez por cada mensaje entrante, y **después** de que las automatizaciones hayan corrido (el webhook las espera con `await`). Ese orden es la base sobre la que se apoya todo este diseño.

Hoy decide con dos criterios defectuosos:

1. Consulta por **existencia** de automatizaciones de mensaje activas y, si hay alguna, se calla. No mira si la palabra clave coincide ni si esa automatización le envía algo al cliente.
2. No agrupa: cada entrante genera su propia respuesta.

El repositorio es un fork de `ArnasDon/wacrm` que se sigue sincronizando; el último merge trajo 119 commits. Eso condiciona qué archivos conviene tocar.

Datos verificados contra la base de producción, que el diseño usa:

- `messages.sender_type` ∈ (`customer`, `agent`, `bot`).
- `messages.status` incluye `failed`, `delivered`, `read`.
- Las marcas de tiempo de WhatsApp tienen precisión de segundos, por lo que dos mensajes de una misma ráfaga pueden compartir `created_at`.
- El insert del mensaje entrante en el webhook **descarta la fila**: no devuelve `id` ni `created_at`.

## Goals / Non-Goals

**Goals:**

- Exactamente una respuesta por ráfaga, venga de donde venga.
- Que las automatizaciones que no responden al cliente convivan con la IA.
- No gastar tokens en dispatches que no van a responder.
- Mantener la superficie de conflicto con upstream lo más chica posible.

**Non-Goals:**

- Cambiar el motor de automatizaciones o su contrato.
- Introducir infraestructura nueva (colas, workers, cron).
- Modificar el esquema de base de datos.
- Resolver el gasto de tokens del traspaso a humano: es inherente.

## Decisions

### Decidir por efecto observado, no por intención configurada

La IA consulta si salió algún mensaje hacia el cliente después del entrante que la disparó (`sender_type <> 'customer'` y `status <> 'failed'`). No pregunta *quién* respondió.

*Por qué:* el requisito está formulado sobre el cliente ("que siempre reciba una respuesta"), y esta consulta mide exactamente eso. Al ser agnóstica al emisor, cubre automatizaciones, flows y agentes humanos con una sola consulta, y sigue funcionando si mañana upstream agrega otro mecanismo de respuesta.

*Alternativa descartada — instrumentar `engine.ts`:* haría que el motor reporte si envió algo. Más explícito, pero exige propagar un flag por cuatro capas con recursión de por medio, solo detecta lo que envían las automatizaciones (no flows ni humanos), y toca uno de los archivos más grandes de upstream, garantizando conflictos en cada sync.

*Alternativa descartada — decidir por `action_type` configurado:* leer si las automatizaciones que coincidieron tienen alguna acción de envío. Falla justo en el caso que importa: si las condiciones detienen la automatización antes de enviar, el cliente queda sin respuesta.

### Filtrar los envíos fallidos

La consulta excluye `status = 'failed'`.

*Por qué:* un mensaje que quedó registrado pero nunca llegó al cliente no puede silenciar a la IA. Es lo que sostiene la garantía de "nunca ninguna respuesta".

### Esperar dentro del `after()` en vez de encolar

`await delay(aiReplyDebounceMs())` antes de generar, con `AI_REPLY_DEBOUNCE_MS` por defecto en 8000.

*Por qué:* el webhook declara `maxDuration = 60`, así que hay margen de sobra. No requiere infraestructura nueva y mantiene el flujo en un solo lugar, fácil de leer y de probar.

*Alternativa descartada — cola diferida con cron:* `automation_pending_executions` y `/api/automations/cron` ya existen, pero `AUTOMATION_CRON_SECRET` está comentado en `.env` y haría falta un pinger externo. Es más robusto y no ocupa el webhook; queda como el camino a seguir si el volumen o la latencia lo justifican.

### Gates baratos antes de la espera

Las comprobaciones que no requieren esperar (config inactiva, hilo asignado, cupo agotado) corren primero.

*Por qué:* mantener viva la invocación 8 segundos para un caso que igual iba a abortar es puro desperdicio de tiempo de función.

### Desempate por id ante marcas de tiempo iguales

El filtro de "posterior a" es `created_at > X OR (created_at = X AND id > Y)`.

*Por qué:* con precisión de segundos, dos mensajes de una ráfaga pueden compartir `created_at`. Comparando solo por tiempo, ambos dispatches se creerían el más nuevo (y ninguno respondería) o ninguno lo sería (y responderían los dos). El id impone un orden total: gana exactamente uno.

### Reclamar el cupo antes de generar

`claim_ai_reply_slot` pasa de ejecutarse entre la generación y el envío, a ejecutarse antes de generar.

*Por qué:* si no hay cupo, no tiene sentido pagarle al proveedor. Es el pedido explícito de no gastar tokens sin responder.

*Contrapartida aceptada:* si la generación falla después de reclamar, se consume un cupo sin haber respondido. Con el límite en 20 por conversación es despreciable. Invierte la política original del código ("sub-responder antes que sobre-responder"), y lo hace a conciencia.

### Módulo aparte para las consultas de ventana

Las dos consultas y el helper de espera viven en `src/lib/ai/reply-window.ts`, no dentro de `auto-reply.ts`.

*Por qué:* tienen una responsabilidad única y clara ("¿pasó algo después de este mensaje?") y se prueban solas, sin montar todo el escenario del dispatch. `auto-reply.ts` queda como orquestador legible.

## Risks / Trade-offs

**Toda respuesta llega ~8 segundos más tarde** → Configurable por `AI_REPLY_DEBOUNCE_MS`; 0 desactiva la espera. En WhatsApp se lee como que el bot está escribiendo, pero es un cambio de comportamiento perceptible.

**La espera ocupa la invocación del webhook** → Con `maxDuration = 60` hay margen. Con volumen alto de mensajes simultáneos crece el tiempo de función facturado; la mitigación real es migrar a la cola con cron, ya identificada.

**Un agente humano que responde durante la ventana silencia a la IA** → Es el comportamiento correcto según el requisito (el cliente ya recibió respuesta), pero conviene que el equipo lo sepa para no leerlo como una falla.

**Fallar hacia "nadie respondió" ante un error de consulta** → Las dos consultas devuelven `false` si la base falla. Prioriza no dejar al cliente en silencio, a costa de arriesgar una respuesta duplicada. Ambos errores se registran en consola.

**Se pierde la protección contra doble respuesta ante escrituras muy rápidas** → Si una automatización envía su mensaje después de que la sonda ya corrió, el cliente podría recibir dos. La ventana de 8 s lo hace improbable, porque el webhook espera a las automatizaciones antes de llamar al dispatch.

## Migration Plan

No hay migración de datos ni de esquema. El despliegue es un cambio de código.

**Rollout:** desplegar sin `AI_REPLY_DEBOUNCE_MS` definida toma el valor por defecto de 8000.

**Rollback:** definir `AI_REPLY_DEBOUNCE_MS=0` desactiva la agrupación sin revertir código, dejando activas solo las verificaciones de convivencia. Para revertir todo, el cambio está contenido en cuatro archivos.

**Validación posterior:** enviar tres mensajes seguidos y confirmar en `ai_usage_log` que se registra **una** fila y no tres.

## Open Questions

Ninguna. Los tres puntos que estaban abiertos se decidieron con el usuario: el criterio es el efecto real y no la configuración, la ventana por defecto son 8 segundos, y el cupo se reclama antes de generar.
