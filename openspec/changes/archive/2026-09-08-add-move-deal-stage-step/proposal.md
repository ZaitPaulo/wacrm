## Why

Dos automatizaciones de la misma cuenta necesitan trabajar sobre el mismo negocio, y hoy el motor solo sabe crear negocios, nunca moverlos.

El caso concreto en producción: **"Alta de prospecto"** (`first_inbound_message`) etiqueta al contacto, le crea el negocio en `Ventas / Prospecto` y le manda el acuse. **"Crear negocio al calificar"** (`tag_added`) quiere reaccionar cuando ese prospecto se califica — pero su único paso es otro `create_deal` **apuntando a la misma etapa**, así que activarla deja dos tarjetas idénticas en la misma columna.

Tres hechos del código delimitan el problema:

- `create_deal` es un `insert` pelado (`src/lib/automations/engine.ts:571`): no consulta si el contacto ya tiene un negocio abierto. Nada en la base lo impide tampoco — `deals` no tiene índice único por contacto.
- **No existe ningún paso que mueva un negocio de etapa.** El catálogo completo de `AutomationStepType` (`src/types/index.ts:475`) llega hasta `create_deal` y sigue con `wait`, `condition`, `send_webhook` y `close_conversation`. Mover una tarjeta solo se puede arrastrando en el tablero (`pipeline-board.tsx` → `handleDealMoved`).
- El paso `condition` tampoco permite esquivarlo: sus sujetos son `tag_presence`, `contact_field`, `message_content` y `time_of_day` (`evaluateCondition` en `engine.ts`). No hay forma de preguntar "¿este contacto ya tiene negocio?" y ramificar.

El resultado es que el embudo solo avanza a mano. La información para avanzarlo — el cliente preguntó precio, pidió financiación, se le puso una etiqueta — ya está entrando por el canal y ya dispara automatizaciones; lo único que falta es el verbo.

## What Changes

- **Un paso nuevo, `move_deal_stage`**, que mueve el negocio abierto del contacto a la etapa indicada del embudo indicado. Si el contacto no tiene negocio abierto ahí, el paso no crea nada: lo reporta y la corrida sigue.
- **`create_deal` deja de duplicar.** Si el contacto ya tiene un negocio abierto en ese embudo, el paso no inserta otro y lo informa en el registro. Deja de ser posible llenar una columna de tarjetas gemelas por reconfigurar mal dos automatizaciones.
- **El constructor ofrece el paso nuevo** en la lista de acciones, con el mismo selector de embudo + etapa que ya usa `create_deal` (`DealPipelineFields`), y la validación de activación exige ambos campos.
- **Los tres idiomas** (`en`, `es`, `ko`) reciben la etiqueta del paso y las de su configuración.

**Qué NO cambia**

- No se toca el esquema: `automation_steps.step_type` es `text` sin `CHECK`, así que el paso nuevo no necesita migración.
- No se toca el tablero de Embudos ni la forma en que un asesor arrastra tarjetas.
- No se decide qué automatización usa el paso. Este change entrega el verbo; el reparto de trabajo entre "Alta de prospecto" y "Crear negocio al calificar" es configuración, y se hace después desde la UI.

**Fuera de alcance**

- Un paso que **cierre** el negocio como ganado o perdido. Es el mismo tipo de verbo y probablemente el siguiente, pero `status` tiene consecuencias en el tablero y en los reportes que merecen su propio análisis.
- Elegir *cuál* negocio mover cuando el contacto tiene varios abiertos en el mismo embudo. Aquí se define una regla simple y explícita (el más reciente); un selector real necesitaría que el paso supiera de qué conversación viene.
- Condiciones sobre negocios (`¿tiene negocio?`, `¿en qué etapa está?`) como sujeto de `condition`. Se anota como carencia, no se construye.

## Capabilities

### New Capabilities
- `automation-deal-progression`: cómo una automatización crea y hace avanzar el negocio de un contacto por el embudo sin duplicarlo, y qué pasa cuando el negocio que espera no existe.

### Modified Capabilities

Ninguna. No hay spec previo que describa el comportamiento de los pasos de automatización.

## Impact

- `src/types/index.ts` — `AutomationStepType` suma `'move_deal_stage'`; nueva `MoveDealStageStepConfig`.
- `src/lib/automations/engine.ts` — nuevo `case` en el ejecutor de pasos; guarda de duplicado en `create_deal`.
- `src/lib/automations/validate.ts` — reglas de activación del paso nuevo.
- `src/components/automations/automation-builder.tsx` — `STEP_META`, `ADDABLE_STEPS` y el editor de configuración.
- `messages/en.json`, `messages/es.json`, `messages/ko.json` — etiquetas.
- Pruebas: `src/lib/automations/engine.test.ts`, `src/lib/automations/validate.test.ts`.
- Sin migración de base de datos.
