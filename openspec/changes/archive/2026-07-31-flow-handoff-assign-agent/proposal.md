## Why

El nodo terminal de los Flows se llama, en la UI, **"Derivar a un agente"** (`messages/es.json` → `Flows.builder.nodes.handoff.label`), y el campo de nota que lo acompaña dice "para el agente que la tome". Pero el builder no tiene ningún selector de agente: el formulario del nodo solo pinta esa nota (`src/components/flows/forms/node-config-form.tsx:198-206`) y el config por defecto es `{ note: "" }` (`src/components/flows/flow-editor-state.tsx:186-187`).

El backend sí está listo. `HandoffNodeConfig.assign_to` existe y está documentado (`src/lib/flows/types.ts:100-113`), y el motor lo respeta:

```ts
// src/lib/flows/engine.ts:440-451
const convUpdate = { status: "pending", updated_at: ... };
if (cfg.assign_to) convUpdate.assigned_agent_id = cfg.assign_to;  // nunca entra
```

Como nadie escribe `assign_to`, la condición jamás se cumple. Al terminar el flujo la conversación queda en `status: "pending"` con `assigned_agent_id` en NULL: cae a la cola compartida en vez de llegarle a alguien. El run se cierra como `handed_off` y el evento se registra con `assigned_to: null`, así que la traza dice "todo salió bien" y el problema es invisible hasta que alguien nota que nadie atendió la conversación.

Hay un segundo camino de derivación que ni siquiera consulta `assign_to`: cuando se agota la política de fallback (`src/lib/flows/engine.ts:1039-1051`) el motor cambia el estado a `pending` y termina el run, sin asignar a nadie ni tener dónde configurarlo.

Como efecto secundario, tampoco se dispara la notificación al agente: el trigger `on_conversation_assigned` (migración 027) solo corre cuando `assigned_agent_id` cambia a un valor no nulo.

## What Changes

- El formulario del nodo `handoff` gana un **selector de agente** que escribe `assign_to` en el config del nodo. Lista los miembros de la cuenta por nombre y cae a un input de id crudo si la lista no está disponible.
- `defaultConfigFor("handoff")` pasa a devolver `{ note: "", assign_to: "" }`.
- Nuevo ajuste **a nivel de flujo**: un agente por defecto para las derivaciones, guardado como `handoff_assign_to` dentro del JSONB `flows.fallback_policy`. Sin migración: la columna ya existe y el `PUT /api/flows/[id]` ya acepta `fallback_policy`.
- El camino de **fallback agotado** pasa a asignar ese agente por defecto, cosa que hoy no hace en absoluto.
- El **nodo explícito** usa su propio `assign_to`; si está vacío, cae al default del flujo; si tampoco hay, mantiene el comportamiento actual (solo `pending`).
- Regla de precedencia sobre asignaciones existentes: el nodo explícito **pisa** al asignado actual (el autor lo eligió a propósito); el default de fallback **no pisa** — solo asigna si la conversación está sin dueño, espejo de lo que ya hace el handoff de la IA (`src/lib/ai/auto-reply.ts:205`).
- `fallback_policy` deja de ser parte del "envelope inmutable" del editor y pasa a ser estado editable que viaja en el guardado.

Sin cambios de contrato: `assign_to` ya era opcional, los flujos existentes siguen comportándose igual (sin agente configurado → `pending` a secas).

## Capabilities

### New Capabilities
- `flow-handoff-routing`: a quién se le asigna una conversación cuando un Flow la deriva — nodo explícito, default del flujo, camino de fallback agotado, y qué pasa cuando la conversación ya tiene dueño.

### Modified Capabilities
<!-- Ninguna. La única capacidad documentada en el repo es `ai-reply-gating`, cuyos requisitos no cambian. -->

## Impact

**Código afectado**
- `src/components/flows/forms/node-config-form.tsx` — el `case "handoff"` suma el selector de agente.
- `src/components/flows/forms/fields.tsx` — nuevo campo de selección de agente + carga de miembros, reusable por el nodo y por el ajuste de flujo.
- `src/components/flows/flow-editor-state.tsx` — `defaultConfigFor("handoff")`; `fallback_policy` entra en `BuilderState`, se siembra del flujo cargado y se incluye en el payload del `PUT`.
- `src/components/flows/flow-builder.tsx` — el campo del agente por defecto en el panel de ajustes del flujo.
- `src/lib/flows/types.ts` — `FlowFallbackPolicy.handoff_assign_to`.
- `src/lib/flows/fallback.ts` — `resolveFallbackPolicy` normaliza el campo nuevo.
- `src/lib/flows/engine.ts` — `executeHandoff` resuelve la precedencia nodo → default; el camino de fallback agotado asigna sin pisar.
- `messages/{es,en,ko}.json` — etiquetas nuevas.

**Sin cambios**
- Esquema de base de datos. `flows.fallback_policy` ya es JSONB y `conversations.assigned_agent_id` ya existe. No hay migración.
- `PUT /api/flows/[id]` — ya acepta `fallback_policy` y guarda `config` de nodos como JSONB opaco (`src/app/api/flows/[id]/route.ts`).
- El motor de automatizaciones (`src/lib/automations/engine.ts`), que tiene su propio paso `assign_conversation` con sus propios problemas. Fuera de alcance.

**Riesgo operativo**
- Un agente configurado en un flujo y luego dado de baja de la cuenta deja un `assigned_agent_id` colgado: `conversations.assigned_agent_id` no tiene FK (migración 001). El selector conserva y marca el id desconocido en vez de descartarlo en silencio, igual que hace hoy el builder de automatizaciones.
