## Context

El motor de Flows ya sabe asignar: `executeHandoff` (`src/lib/flows/engine.ts:435-457`) escribe `assigned_agent_id` si el config del nodo trae `assign_to`, y el tipo `HandoffNodeConfig` lo documenta desde el día uno (`src/lib/flows/types.ts:100-113`). Lo que falta es todo lo de arriba: el builder nunca escribe ese campo. El trabajo es cerrar el cableado, no rediseñar nada.

Restricciones del repo que condicionan el diseño:

- Es un fork de wacrm que se sigue sincronizando con upstream. Cuanto menos se toque `engine.ts`, mejor; los cambios ahí deben ser localizados.
- No hay Server Actions en el proyecto. El editor de flujos es un client component que persiste vía `PUT /api/flows/[id]`.
- `flow_nodes.config` se guarda como JSONB opaco: la API no valida ni filtra claves (`src/app/api/flows/[id]/route.ts`), así que sumar `assign_to` no requiere tocar la ruta.
- `flows.fallback_policy` ya es una columna JSONB con `PUT` que la acepta, pero **el editor nunca la manda**: hoy vive en el "envelope inmutable" del contexto (`src/components/flows/flow-editor-state.tsx:72`).
- i18n con next-intl y tres catálogos (`messages/{es,en,ko}.json`).

## Goals / Non-Goals

**Goals:**
- Que el nodo "Derivar a un agente" pueda, efectivamente, derivar a un agente.
- Un default por flujo, para que el camino de fallback agotado —que hoy no asigna a nadie— también tenga a quién derivar.
- Cero migraciones y cero cambios de contrato en la API.
- Que los flujos existentes sigan comportándose exactamente igual mientras no se configure nada.

**Non-Goals:**
- El paso `assign_conversation` del motor de **automatizaciones**, que tiene su propio bug (devuelve `'no agent resolved'` como paso exitoso) y su propio "round robin" que no reparte. Otro cambio.
- Round-robin, balanceo por carga o por horario. Acá solo hay asignación a un agente fijo.
- Exponer el resto de `fallback_policy` (`max_reprompts`, `on_exhaust`, `on_timeout_hours`) en la UI. Se agrega solo el campo del agente; el resto sigue tomando sus defaults.
- Notificar al agente: ya lo hace el trigger `on_conversation_assigned` de la migración 027, que se dispara solo con que `assigned_agent_id` pase a no nulo.

## Decisions

### El default del flujo vive dentro de `fallback_policy`, no en una columna nueva

`flows.fallback_policy` ya es JSONB, ya tiene un resolutor tolerante a campos faltantes (`resolveFallbackPolicy`) y el `PUT` ya la acepta. Meter `handoff_assign_to` ahí cuesta cero migraciones y cero cambios de API.

*Alternativa descartada:* columna `flows.default_handoff_agent_id`. Más explícita y con FK posible, pero exige migración, tocar el `PutBody`, el `SELECT` y el tipo `FlowRow`. No compensa para un campo opcional.

*Tensión asumida:* el nombre "fallback policy" queda un poco forzado para un valor que también usa el nodo explícito. Se documenta en el tipo. La alternativa —duplicar el valor en dos lugares— es peor.

### El nodo pisa la asignación existente; el fallback no

Son dos intenciones distintas y merecen reglas distintas.

El nodo explícito es una decisión del autor del flujo: "cuando el cliente llegue acá, que lo atienda Ana". Si otro agente se había asignado la conversación mientras el bot corría, la instrucción del flujo gana. Es además el comportamiento actual del código y no hay razón para cambiarlo.

El fallback agotado es lo contrario: se dispara porque el cliente se trabó, no porque nadie lo decidiera. Si un humano ya tomó la conversación —perfectamente posible, los Flows no bloquean el inbox— pisarlo sería quitarle el caso de las manos. Se espeja la regla que ya usa el handoff de la IA (`src/lib/ai/auto-reply.ts:205`: `if (config.handoffAgentId && !conv.assigned_agent_id)`).

*Costo:* el camino de fallback necesita leer `conversations.assigned_agent_id` antes de escribir. Un `SELECT` extra en una ruta que corre una vez por run agotado. Irrelevante.

### `executeHandoff` recibe la política ya resuelta

Para aplicar la precedencia nodo → default, `executeHandoff` necesita la `fallback_policy` del flujo. Hoy no la tiene: el run trae `flow_id`, no el flow.

Se le pasa como parámetro desde el llamador en vez de que la función cargue el flujo por su cuenta. `advanceFromNodeKey` puede llegar al nodo `handoff` sin haber cargado el flujo nunca, así que la carga se hace ahí, perezosa, solo cuando el nodo es de derivación. Mantiene `executeHandoff` sin I/O propia de lectura y deja el costo en el único camino que lo necesita.

*Alternativa descartada:* cargar el flujo al inicio de cada dispatch. Agrega un `SELECT` a **todos** los mensajes entrantes para un dato que casi nunca se usa. El camino de fallback ya carga el flujo (`loadFlow` en `engine.ts:994-996`), así que ahí sale gratis.

### Un solo componente de selección de agente para los dos lugares

El nodo y el ajuste del flujo necesitan el mismo control. Va en `src/components/flows/forms/fields.tsx`, donde ya viven los campos compartidos del builder, con la carga de miembros vía `fetch("/api/account/members")` en un hook.

Se replica el contrato del `AgentSelect` del builder de automatizaciones (`src/components/automations/automation-builder.tsx:406-444`), que ya resolvió los mismos tres casos: lista vacía → input crudo; opción "sin elegir"; valor guardado que ya no está en la lista → se conserva marcado como desconocido. Mismo problema, misma solución; no hay motivo para inventar otra.

*Alternativa descartada:* extraer el `AgentSelect` de automatizaciones a un componente compartido y consumirlo desde ambos módulos. Es lo correcto a largo plazo, pero acopla dos módulos que hoy son independientes y agranda la superficie de conflicto con upstream. Se deja anotado como deuda.

### `fallback_policy` pasa a ser estado editable del builder

Requiere sumarla a `BuilderState`, sembrarla desde `initialFlow.fallback_policy` y agregarla al payload del `PUT` (`flow-editor-state.tsx:338-345`). Con eso el dirty-tracking, el guardado y la advertencia de "cambios sin guardar" la cubren sin trabajo extra.

Se siembra pasándola por `resolveFallbackPolicy`, no cruda: garantiza que el editor mande siempre la política completa y no una versión parcial que pise los defaults al guardar.

## Risks / Trade-offs

**Un agente configurado se da de baja de la cuenta** → `conversations.assigned_agent_id` no tiene FK (migración 001), así que el id queda colgado y la conversación se asigna a un fantasma. Mitigación: el selector conserva el valor y lo muestra como "agente desconocido" en vez de vaciarlo en silencio, para que el autor lo note al editar. Detectarlo en tiempo de ejecución exigiría validar contra `profiles` en cada derivación; no se hace.

**El nodo pisa una asignación humana** → es la decisión deliberada de arriba, pero puede sorprender. Mitigación: queda registrado en el evento `handoff` con el `assigned_to` efectivo, así que la traza muestra qué pasó.

**El valor vive en un campo que se llama "fallback"** → alguien puede buscarlo en el lugar equivocado dentro de seis meses. Mitigación: KDoc en `FlowFallbackPolicy` explicando que el campo aplica a las dos rutas de derivación.

**El editor ahora manda `fallback_policy` en cada guardado** → si el resolutor tuviera un bug, un guardado normal podría degradar la política de un flujo existente. Mitigación: `resolveFallbackPolicy` ya está cubierto por tests y se le suma cobertura para el campo nuevo, incluyendo el caso de política sin `handoff_assign_to`.

## Migration Plan

No hay migración de base de datos. El despliegue es sólo código:

- Los flujos existentes tienen `fallback_policy` sin `handoff_assign_to` → `resolveFallbackPolicy` lo resuelve como "sin default" → comportamiento idéntico al actual.
- Los nodos `handoff` existentes tienen config `{ note }` sin `assign_to` → la condición del motor sigue sin cumplirse → comportamiento idéntico al actual.
- Rollback: revertir el código. No queda estado incompatible; a lo sumo, flujos con un `handoff_assign_to` guardado que la versión anterior simplemente ignora.

## Open Questions

Ninguna bloqueante. Anotado como deuda para un cambio futuro: unificar el selector de agente de Flows y el de automatizaciones en un componente compartido, junto con el arreglo del paso `assign_conversation`.
