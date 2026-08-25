## 1. Tipos

- [x] 1.1 Agregar `'move_deal_stage'` a `AutomationStepType` en `src/types/index.ts`
- [x] 1.2 Declarar `MoveDealStageStepConfig` (`pipeline_id`, `stage_id`) junto a `CreateDealStepConfig`, siguiendo el estilo de los configs vecinos

## 2. Motor

- [x] 2.1 Escribir el auxiliar `findOpenDeal(db, { accountId, contactId, pipelineId })` en `src/lib/automations/engine.ts`: `status = 'open'`, mismo embudo, `created_at DESC`, `LIMIT 1`, siempre filtrando por `account_id`
- [x] 2.2 Guardar `create_deal` con ese auxiliar: si ya hay negocio abierto, devolver `deal already open (<id>)` sin insertar
- [x] 2.3 Implementar el `case 'move_deal_stage'`: verificar que la etapa pertenezca al embudo y a la cuenta (lanza si no), buscar el negocio con el auxiliar, y actualizar `stage_id` + `updated_at`
- [x] 2.4 Devolver los tres desenlaces con textos distintos: movido (con id de negocio y nombre de etapa), ya estaba en esa etapa, y sin negocio que mover — ninguno de los tres lanza

## 3. Validación

- [x] 3.1 Agregar el `case 'move_deal_stage'` en `validateStepsForActivation` (`src/lib/automations/validate.ts`) exigiendo `pipeline_id` y `stage_id`, reusando los códigos `pipelineRequired` y `stageRequired`

## 4. Constructor

- [x] 4.1 Registrar el paso en `STEP_META` y en `ADDABLE_STEPS` de `src/components/automations/automation-builder.tsx`, con un icono coherente con el de `create_deal`
- [x] 4.2 Agregar la rama del editor de configuración reusando `DealPipelineFields`
- [x] 4.3 Verificar que el paso aparezca como acción (no como condición ni espera) en el agrupador de tipos

## 5. Traducciones

- [x] 5.1 Agregar la etiqueta del paso en `messages/en.json`, `messages/es.json` y `messages/ko.json`, respetando CRLF y el orden de claves existente

## 6. Pruebas

- [x] 6.1 En `src/lib/automations/engine.test.ts`: `create_deal` no inserta si ya hay negocio abierto en ese embudo, y sí inserta si el que existe está cerrado o es de otro embudo
- [x] 6.2 En `engine.test.ts`: `move_deal_stage` mueve el negocio abierto, no falla si ya estaba en la etapa, no falla ni crea nada si no hay negocio, y lanza si la etapa no es del embudo
- [x] 6.3 En `engine.test.ts`: un `move_deal_stage` sin negocio NO interrumpe la corrida — el paso siguiente se ejecuta
- [x] 6.4 En `src/lib/automations/validate.test.ts`: el paso sin embudo o sin etapa impide activar

## 7. Verificación

- [x] 7.1 `npx tsc --noEmit` sin errores
- [x] 7.2 `npx vitest run src/lib/automations` en verde
- [x] 7.3 `npx eslint` sobre los archivos tocados sin errores nuevos
