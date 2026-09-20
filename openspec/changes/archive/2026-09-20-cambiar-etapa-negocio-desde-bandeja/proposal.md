## Why

Hoy, para mover un negocio de etapa, el asesor tiene que salir de la conversación e ir al tablero de Embudos, y ahí puede arrastrarlo a cualquier etapa. El negocio necesita que el avance se haga desde la bandeja, donde se atiende al cliente, y que solo se pueda saltar a las etapas que tienen sentido: se avanza, nunca se retrocede, y "No viable" y "Cerrado" son finales.

## What Changes

- En el panel lateral de la bandeja (sección "Negocios"), cada negocio muestra un selector con **solo las etapas destino permitidas** desde su etapa actual. Al elegir una, el negocio se mueve y la tarjeta se actualiza.
- Nueva tabla `pipeline_stage_transitions` (migración 528): pares `from_stage_id → to_stage_id` por embudo, con RLS por cuenta (igual que `pipeline_stages`: miembros leen, admins escriben).
- **Un embudo sin reglas permite todo** (cualquier otra etapa del embudo), para no romper "Sales Pipeline" ni los embudos nuevos.
- En los ajustes del embudo se agrega un editor para marcar, por cada etapa, a qué etapas puede pasar.
- La migración siembra las reglas del embudo "Ventas" por nombre de etapa, sin fallar si el embudo o alguna etapa no existe:
  - Prospecto → Contactado
  - Contactado → Cotizado | No viable
  - Cotizado → Seguimiento | Negociación | No viable
  - Seguimiento → Negociación | No viable
  - Negociación → No viable | Cerrado
  - No viable y Cerrado: finales (sin salida)
- **La restricción solo aplica en la bandeja.** El tablero de Embudos (arrastrar y soltar) y el paso `move_deal_stage` de las automatizaciones siguen moviendo libremente.

## Capabilities

### New Capabilities
- `deal-stage-transitions`: reglas de transición entre etapas configurables por embudo, y cambio de etapa de un negocio desde el panel de la bandeja respetando esas reglas.

### Modified Capabilities
<!-- Ninguna: automation-deal-progression y el tablero no cambian de comportamiento. -->

## Impact

- **Base de datos:** `supabase/migrations/528_pipeline_stage_transitions.sql` (tabla, índices, RLS, siembra de "Ventas"). Borrar una etapa borra sus reglas en cascada.
- **Código:** `src/components/inbox/contact-sidebar.tsx` (selector de etapa), `src/components/pipelines/pipeline-settings.tsx` (editor de reglas), nueva función pura en `src/lib/pipelines/` con sus tests, tipos en `src/types/index.ts`, textos en `messages/es.json` (y la clave en `messages/en.json` si el proyecto la mantiene en paralelo).
- **Sin cambios:** tablero de Embudos, motor de automatizaciones, APIs.
- **Despliegue:** requiere aplicar la migración 528 en el VPS antes de promover a `main`.
