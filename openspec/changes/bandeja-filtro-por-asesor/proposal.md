## Why

El dueño del negocio no tiene cómo ver qué conversaciones tiene asignadas cada asesor: la lista de la bandeja no muestra el asignado ni filtra por él, y la única forma es abrir cada chat. El 2026-09-18 había 40 conversaciones abiertas sin asesor, invisibles para los asesores (migración 520), y nadie las veía como grupo.

## What Changes

- Filtro **Asesor** en la bandeja: Todos, Sin asignar, o un asesor concreto, con cuántas conversaciones tiene cada opción.
- Cada fila de la lista muestra el nombre del asesor asignado, o "Sin asignar".
- Las dos cosas solo aparecen para quien ve todas las conversaciones (owner, admin, viewer). Un asesor solo ve las suyas, así que para él no aportan nada.
- De paso: el filtro por canal no recalculaba la lista al cambiarlo (faltaba en las dependencias del `useMemo`).

## Capabilities

### New Capabilities

- `inbox-assignee-filter`: ver y filtrar la bandeja por asesor asignado.

### Modified Capabilities

(ninguna: la visibilidad por rol no cambia, esto solo filtra lo que ya se ve)

## Impact

- `src/components/inbox/conversation-list.tsx`, `src/lib/inbox/conversations.ts` y traducciones `messages/*.json`.
- Sin migraciones ni cambios de API: `assigned_agent_id` ya viene en la consulta de la bandeja.
