## Why

El dueño no tiene forma de saber cuántos clientes atiende cada asesor. Hoy el único rastro de propiedad de un lead es `conversations.assigned_agent_id`, que es un estado mutable —una foto del ahora— y no un registro: se borra al devolverle el hilo al bot y se pisa en cada reasignación. Si un asesor atendió 40 clientes este mes y hoy tiene 12 abiertos, el 40 no existe en ninguna parte.

Verificado en producción el 2026-09-21: el dashboard nunca desglosa por asesor, los 111 mensajes de asesor tienen `sender_id` en NULL —así que no se sabe quién respondió ni cuánto tardó—, y `deals` está vacía, de modo que no hay etapa de embudo que mostrar. Las tres columnas que el negocio pide son hoy incalculables o saldrían en cero.

## What Changes

- **El historial de asignaciones deja de perderse.** Una tabla append-only registra cada cambio de `conversations.assigned_agent_id` —de quién a quién, cuándo y en qué hilo—, alimentada por un trigger de base de datos para cubrir todos los caminos (IA, automatizaciones, bandeja, API v1) sin tocar ninguno por separado.
- **Los mensajes salientes guardan su autor.** El envío pasa a escribir `messages.sender_id`, hoy siempre nulo para el asesor. Es lo que habilita medir el tiempo de respuesta humano separado del bot.
- **La transferencia respeta la continuidad del lead.** Cuando la IA vuelve a traspasar un hilo que un asesor ya atendió, se lo devuelve a él en vez de repartirlo por carga. **BREAKING** respecto del reparto actual, que ignora el historial.
- **El traspaso crea el negocio.** Al transferir al asesor, el sistema abre un `deal` en Ventas/Prospecto con los datos que el bot ya recogió (nombre, presupuesto, interés, crédito). Es lo que puebla la columna de etapas.
- **La nota del traspaso sobrevive a la reactivación.** Reactivar la IA deja de borrar `ai_handoff_summary`, para que quien retome el hilo no empiece de cero.
- **Nueva tabla de rendimiento en el dashboard**, visible solo para `owner` y `admin`: por asesor, clientes en gestión, desglose por etapa del embudo y tiempo promedio de primera respuesta.
- **El asesor puede devolverle el hilo al bot.** Lo habilita el endpoint de reactivación, que escribe con service-role y comprueba en código que la operación sea de verdad una devolución (la IA estaba pausada). La migración 530 que se escribió para esto se descartó sin desplegarse: lo que lo impedía no era el trigger sino la RLS (ver design.md). Sale junto con este cambio y no antes: sin el historial, habilitarla multiplicaría la pérdida de rastro.

## Capabilities

### New Capabilities

- `agent-assignment-history`: registro append-only de quién tuvo asignada cada conversación y durante cuánto tiempo, independiente del estado actual del hilo.
- `agent-performance-metrics`: la vista de rendimiento por asesor —clientes en gestión, etapas del embudo y tiempo de respuesta—, su control de acceso y la autoría del mensaje saliente que la hace calculable.
- `handoff-deal-creation`: apertura automática del negocio en el momento en que la IA transfiere la conversación a un asesor.

### Modified Capabilities

- `ai-handoff-assignment`: el reparto deja de mirar solo la carga. Si la conversación ya tuvo asesor, vuelve a él; el reparto por carga pasa a ser el camino de respaldo.
- `conversation-visibility`: el rol `agent` pasa a poder dejar una conversación sin asignar en el caso concreto de devolvérsela al bot. La prohibición general sigue en pie.

## Impact

**Base de datos** (migraciones 531, 532 y 533; el número 530 queda vacío, ver design.md):
- Tabla nueva de historial de asignaciones, con su RLS y sus `GRANT` explícitos.
- Trigger `AFTER UPDATE OF assigned_agent_id` sobre `conversations`.

**Código:**
- `src/lib/whatsapp/send-message.ts` — escribir `sender_id` en el insert del saliente.
- `src/lib/ai/pick-agent.ts` — continuidad antes que carga.
- `src/lib/ai/auto-reply.ts` — creación del `deal` en el traspaso.
- `src/app/api/ai/autoreply/[conversationId]/route.ts` — conservar `ai_handoff_summary`.
- `src/lib/dashboard/queries.ts` + `types.ts` — agregación por asesor; el cálculo de tiempo de respuesta actual mezcla bot y humano y no sirve tal cual.
- `src/app/(dashboard)/dashboard/page.tsx` y componente de tabla nuevo — UI, con `canEditSettings` de `src/lib/auth/roles.ts` como control de acceso.
- Mensajes i18n (`spanish-locale`).

**Límite conocido:** el historial empieza a capturar el día que se despliega. Lo anterior no se reconstruye — `messages.sender_id` está vacío hacia atrás y no hay registro de asignaciones previas. Las métricas nacen en cero y se llenan desde ese momento.
