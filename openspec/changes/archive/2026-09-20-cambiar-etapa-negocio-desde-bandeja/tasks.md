## 1. Base de datos (/backend)

- [x] 1.1 Crear `supabase/migrations/528_pipeline_stage_transitions.sql`: `unique (pipeline_id, id)` en `pipeline_stages`, tabla `pipeline_stage_transitions` con FKs compuestas y cascada, `check from <> to`, `unique (from_stage_id, to_stage_id)` e índice por `pipeline_id`
- [x] 1.2 RLS: `select` para miembros y `all` para admins, con el patrón `EXISTS pipelines … is_account_member` de 017
- [x] 1.3 Siembra idempotente de las 10 reglas de "Ventas" por nombre (`lower(trim())`, `ON CONFLICT DO NOTHING`)
- [x] 1.4 Verificar que no exista otra migración 528 y aplicarla en el stack local; comprobar con psql que se crean 10 reglas y que una segunda corrida no duplica

## 2. Dominio (/backend)

- [x] 2.1 Agregar el tipo `PipelineStageTransition` en `src/types/index.ts`
- [x] 2.2 Implementar `getAllowedTargetStages(currentStageId, stages, transitions)` en `src/lib/pipelines/stage-transitions.ts`
- [x] 2.3 Tests en `src/lib/pipelines/stage-transitions.test.ts`: embudo con reglas (Cotizado → 3 destinos ordenados), etapas finales, embudo sin reglas (todas menos la actual), exclusión de la etapa actual, reglas de otro embudo ignoradas

## 3. Bandeja (/frontend)

- [x] 3.1 En `contact-sidebar.tsx`, cargar las reglas de los embudos de los negocios dentro de `fetchContactData` (si hay error, tratarlo como lista vacía) y las etapas de esos embudos
- [x] 3.2 Convertir la pastilla de etapa en un `Popover` con los destinos permitidos, cada uno con su color; si no hay destinos, dejarla como texto
- [x] 3.3 Actualización optimista de `stage_id`/`stage`, con `toast.error` y rollback si falla
- [x] 3.4 Textos en `messages/es.json` (`Inbox.sidebar`) y la clave equivalente en `messages/en.json`

## 4. Ajustes del embudo (/frontend)

- [x] 4.1 Sección "Transiciones permitidas" en `pipeline-settings.tsx`: una fila por etapa con casillas de destino, cargada desde la base
- [x] 4.2 Al guardar, reemplazar el conjunto (borrar las quitadas e insertar las nuevas) y avisar el resultado con un toast
- [x] 4.3 Textos en `messages/es.json` / `messages/en.json`

## 5. Verificación (/qa)

- [x] 5.1 `npm test` (tests nuevos y existentes en verde), `npm run lint` y typecheck (`npx tsc --noEmit`)
  - Auditoría QA 2026-09-18: 140 archivos / 1787 tests en verde (12 de `stage-transitions`), `tsc --noEmit` sin errores, `eslint` sobre los archivos tocados sin errores (2 warnings previos en `contact-sidebar.tsx`: `User` sin usar y `<img>`). El `npm run lint` completo ya traía errores en archivos que este cambio no toca.
  - RLS probada en el stack local dentro de una transacción con ROLLBACK: agente y viewer leen pero no insertan/borran/actualizan; admin y owner sí; otra cuenta no ve ni borra reglas ajenas y su admin no puede insertar en un embudo ajeno; anon sin acceso; el agente sí mueve `deals.stage_id` de un contacto asignado (y no el de uno no asignado, por `contact_visible`). FK compuesta, `check` y `unique` rechazan lo que deben; borrar una etapa cascadea sus reglas; la siembra da 10 y no duplica.
  - Arreglado en la auditoría: faltaba `GRANT` de tabla a `authenticated` (en local la tabla nueva salía sin SELECT/INSERT/UPDATE/DELETE y todo fallaba con "permission denied").
- [x] 5.2 (Verificado por el usuario en producción el 2026-09-18: la bandeja ofrece solo los destinos permitidos.) Prueba manual en local: mover desde la bandeja Seguimiento → Negociación → Cerrado, confirmar que Cerrado no ofrece destinos, que el tablero sigue arrastrando libremente y que un embudo sin reglas ofrece todas las etapas
- [x] 5.3 Editar las reglas en los ajustes y confirmar que la bandeja las respeta al recargar
