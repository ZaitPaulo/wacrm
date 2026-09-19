## Context

- El panel lateral de la bandeja (`src/components/inbox/contact-sidebar.tsx`) ya carga los negocios del contacto con `pipeline:pipelines(*)` y `stage:pipeline_stages(*)`, pero solo los muestra.
- El tablero mueve negocios con un `update({ stage_id })` directo del cliente Supabase (`src/app/(dashboard)/pipelines/page.tsx:225`); RLS de `deals` ya permite que los agentes lo hagan.
- `pipeline_stages` no tiene ninguna noción de transición; su RLS (017) es: miembros leen, admins modifican, a través de `pipelines.account_id`.
- Etapas reales de Ventas en producción (captura del usuario, 2026-09-18): Prospecto, Contactado, Cotizado, Seguimiento, Negociación, No viable, Cerrado. La memoria del proyecto tenía otra lista más vieja, así que la siembra busca por nombre y no por id.
- El usuario decidió: la regla aplica **solo en la bandeja**, y las reglas son **configurables por embudo**.

## Goals / Non-Goals

**Goals:**
- Cambiar la etapa de un negocio desde la bandeja, limitado a destinos permitidos.
- Guardar las reglas por embudo en la base y editarlas desde los ajustes del embudo.
- Sembrar las reglas de Ventas en la misma migración.

**Non-Goals:**
- Aplicar las reglas en el tablero, en las automatizaciones o con un trigger en la base.
- Cambiar `deals.status` (open/won/lost) al entrar a "Cerrado" o "No viable": el tablero tampoco lo hace hoy.
- Historial o auditoría de cambios de etapa.

## Decisions

1. **Tabla de pares en lugar de una columna en `pipeline_stages`.**
   `pipeline_stage_transitions(id, pipeline_id, from_stage_id, to_stage_id, created_at)`, `unique(from_stage_id, to_stage_id)`, `check (from_stage_id <> to_stage_id)`, FKs con `on delete cascade` hacia `pipelines` y `pipeline_stages`. Que ambas etapas sean del `pipeline_id` se valida con FKs compuestas contra un `unique (pipeline_id, id)` nuevo en `pipeline_stages`, en lugar de un trigger.
   *Alternativa descartada:* una columna `uuid[] allowed_next` en `pipeline_stages`. No tiene integridad referencial, y al borrar una etapa quedarían ids colgando.

2. **`pipeline_id` desnormalizado en la regla.** Sirve para la RLS (mismo patrón `EXISTS … pipelines p … is_account_member(p.account_id[, 'admin'])` que `pipeline_stages`) y para traer todas las reglas de un embudo en una sola consulta.

3. **"Sin reglas = todo permitido" se decide a nivel de embudo, no de etapa.** Si un embudo tiene al menos una regla, una etapa sin reglas de salida es final. Así "No viable" y "Cerrado" quedan finales sin tener que marcarlas, y los embudos que nadie configuró siguen como hoy.

4. **Función pura `getAllowedTargetStages(currentStageId, stages, transitions)`** en `src/lib/pipelines/stage-transitions.ts`. La usan la bandeja y la vista previa del editor, y es lo que cubren los tests (DoD).

5. **La restricción se aplica solo en el cliente.** El usuario pidió que el tablero y las automatizaciones sigan libres, y todos escriben `deals.stage_id`, así que un trigger los bloquearía a todos. Riesgo aceptado: alguien con acceso a la API podría saltarse la regla, igual que ya puede hacerlo desde el tablero.

6. **UI de la bandeja:** la pastilla de etapa pasa a ser el disparador de un `Popover` (ya se usa en el mismo archivo para las etiquetas) con las etapas destino como botones, cada una con su color. Actualización optimista de la tarjeta, y rollback + `toast.error` si falla (el mismo patrón que `handleDealMoved`). Las reglas se cargan en el mismo `Promise.all` de `fetchContactData`, filtradas por los `pipeline_id` de los negocios. Si no hay destinos, la pastilla queda como texto.

7. **Editor en ajustes del embudo:** una sección "Transiciones permitidas" con una fila por etapa y casillas para las demás etapas. Al guardar se reemplaza el conjunto del embudo: se borran las reglas que ya no están y se insertan las nuevas. No hace falta transacción: el peor caso es un conjunto a medio guardar que se corrige guardando otra vez. Las etapas nuevas que todavía no tienen id se editan después de guardarlas.

8. **Siembra por nombre con `INSERT … SELECT … JOIN` + `ON CONFLICT DO NOTHING`**, a partir de una lista `VALUES (from_name, to_name)` unida con `pipelines.name = 'Ventas'` y `pipeline_stages.name`. Es idempotente, y si falta algo simplemente no produce filas.

## Risks / Trade-offs

- [Los nombres de las etapas en producción no coinciden exactamente (tildes, mayúsculas)] → se compara con `lower(trim(name))`. Después de desplegar, contar las reglas en el VPS y esperar 10.
- [Hay más de un embudo llamado "Ventas" en otra cuenta] → la siembra aplica a todos, lo cual es aceptable: cada regla queda dentro de su propio embudo.
- [Colisión de número de migración con upstream] → usar 528, que es el siguiente libre en `supabase/migrations`, y verificar que no exista otro `528_*` antes de hacer commit (ver la memoria sobre colisiones).
- [El agente ve el selector aunque no pueda cambiar reglas] → es correcto: mover negocios sí le está permitido y editar reglas no.

## Migration Plan

1. Aplicar `528_pipeline_stage_transitions.sql` en local (`supabase` no aplica migraciones nuevas solo con `start`: correr `migration up`/reset según la memoria de pruebas locales).
2. Probar en local, hacer merge a `develop`, aplicar la migración en el VPS y promover a `main`.
3. Rollback: `drop table pipeline_stage_transitions` más quitar el `unique (pipeline_id, id)`. El código de la bandeja trata el caso "sin reglas" como "todo permitido", así que sin la tabla solo fallaría la consulta. Para que no se rompa la carga del panel, si la consulta de reglas da error se trata como lista vacía.

## Open Questions

- ¿Llegar a "Cerrado" o "No viable" debería marcar el negocio como ganado o perdido (`status`)? Queda fuera de este cambio; conviene decidirlo después, junto con el tablero.
