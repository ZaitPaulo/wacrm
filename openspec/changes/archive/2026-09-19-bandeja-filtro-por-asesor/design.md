## Context

La bandeja ya carga `conversations.*`, que incluye `assigned_agent_id`, y la reasignación desde el hilo ya actualiza el estado de la lista (`onAssignChange` en `inbox/page.tsx`). Faltan los nombres: `message-thread.tsx` carga `profiles` para su menú de asignar, y la lista no.

## Goals / Non-Goals

**Goals:** filtrar y ver el asignado desde la lista, sin consultas nuevas por fila.

**Non-Goals:** reportes por asesor, reparto automático, cambiar quién ve qué (migración 520).

## Decisions

- **El filtro se aplica en el cliente**, igual que los demás de la lista: las conversaciones ya están cargadas y la RLS ya decidió qué se ve. Un filtro en la consulta obligaría a recargar por cada cambio.
- **La regla del filtro es una función pura** en `lib/inbox/conversations.ts` (`matchesAssigneeFilter`), junto a `matchesContactFilters`, para probarla sin montar el componente.
- **Los nombres salen de una sola consulta a `profiles`** al montar la lista, la misma que ya hace el hilo, y solo si el usuario puede ver todo.
- **Un asignado que no está en `profiles`** (alguien que salió de la cuenta) se muestra como "Asesor desconocido", no como "Sin asignar": la conversación sí tiene dueño.

## Risks / Trade-offs

- [Los conteos son de lo cargado, no del total en base] → La bandeja ya carga todas las conversaciones visibles, así que hoy coinciden.
