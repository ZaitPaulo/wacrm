## Context

El ejecutor de pasos (`executeStep` en `src/lib/automations/engine.ts`) es un `switch` sobre `step_type` donde cada rama devuelve un texto descriptivo que termina en `automation_logs.steps_executed`, o lanza una excepción. Esa diferencia no es cosmética: en `executeStepsFrom`, un paso que lanza marca la corrida como `failed` y hace **`break`** — los pasos siguientes no corren. Es lo que ya nos obligó a poner el acuse de recibo al final de "Alta de prospecto", detrás del etiquetado y del negocio.

El motor corre con el cliente de servicio (`supabaseAdmin()`), que **se salta RLS**. La única barrera de inquilino es la que cada paso escribe a mano: `runAutomationsForTrigger` verifica que el contacto pertenezca a la cuenta antes de ejecutar nada, y pasos como `update_contact_field` y `close_conversation` vuelven a filtrar por `account_id` "defense in depth". El paso nuevo tiene que seguir esa misma disciplina, porque su configuración (`pipeline_id`, `stage_id`) viene de una fila que un administrador editó.

Sobre el modelo: la posición de un contacto en el embudo **es** la etapa de su negocio. `deals` tiene `pipeline_id`, `stage_id`, `contact_id` (anulable desde la migración 004), `status` (`open` / `won` / `lost`) y `account_id`. No hay ningún índice que limite cuántos negocios abiertos puede tener un contacto.

## Goals / Non-Goals

**Goals:**

- Que una automatización pueda **avanzar** el negocio de un contacto, no solo crearlo.
- Que dos automatizaciones que tocan negocios no puedan duplicar tarjetas, aunque estén mal configuradas.
- Que un paso que "no tenía nada que hacer" nunca corte la corrida.
- Que el inquilino quede verificado en cada consulta del paso nuevo, igual que en los pasos existentes.

**Non-Goals:**

- Cerrar negocios (`won` / `lost`) desde una automatización.
- Que `condition` sepa preguntar por negocios.
- Cambiar cómo el asesor mueve tarjetas en el tablero.
- Impedir que un humano cree dos negocios abiertos a mano: eso es legítimo y no se toca.

## Decisions

### 1. La guarda anti-duplicado vive en el paso, no en un índice de la base

Un índice único parcial sobre `(contact_id, pipeline_id) WHERE status = 'open'` sería más fuerte, pero castigaría también al asesor que crea a mano un segundo negocio para el mismo cliente — que es un caso real: alguien que pregunta por dos carros distintos. El problema que tenemos no es "un contacto nunca puede tener dos negocios", es "una automatización no debe crear el que ya existe".

Se implementa como un `SELECT` previo al `insert` dentro de `create_deal`, filtrando por `account_id`, `contact_id`, `pipeline_id` y `status = 'open'`. Si hay fila, el paso devuelve `deal already open (<id>)` y no inserta.

**Se acepta la carrera.** Dos mensajes entrantes casi simultáneos podrían pasar los dos el `SELECT` y crear dos negocios. No se blinda con transacción ni con índice porque la ventana es de milisegundos, el disparador que la usaría (`first_inbound_message`) corre una sola vez por contacto, y el daño —una tarjeta de más— se arregla arrastrando. Queda anotado como riesgo, no como defecto silencioso.

### 2. Se mueve el negocio abierto más reciente

Alternativa considerada: usar `deals.conversation_id` para mover el negocio de *esta* conversación. Se descartó porque el campo solo se llena cuando el negocio nace de una conversación, y porque hay disparadores sin conversación en el contexto — `tag_added` disparado desde la ficha del contacto o desde la bandeja no trae hilo. El paso quedaría inerte justo en el caso que motivó el change.

La regla es entonces: `status = 'open'`, mismo embudo, orden por `created_at DESC`, `LIMIT 1`. Es determinista y explicable en una línea al operador. Con la guarda de la decisión 1 activa, el caso "varios abiertos en el mismo embudo" solo puede venir de negocios creados a mano.

### 3. Sin negocio que mover NO es un error

Si el contacto no tiene negocio abierto en ese embudo, el paso devuelve `no open deal to move` y la corrida sigue. La razón es el `break`: hacer fallar el paso significaría que un `send_message` o un `assign_conversation` posteriores dejen de ejecutarse por algo que no es culpa suya. Es la misma convención que ya usa `add_tag` cuando la etiqueta ya estaba (`tag ... already present`).

Tampoco crea el negocio faltante. Un paso que a veces mueve y a veces crea es imposible de razonar desde la UI, y el operador que quiera ambas cosas puede encadenar `create_deal` + `move_deal_stage` — que ahora es seguro, precisamente por la decisión 1.

### 4. La etapa incompatible SÍ es un error

Si `stage_id` no pertenece a `pipeline_id`, o el embudo no es de la cuenta, el paso **lanza**. Eso no es un estado del mundo, es una configuración rota: mover el negocio a una etapa de otro embudo lo sacaría del tablero donde alguien lo está mirando. Falla ruidosamente, queda en el registro con su mensaje, y la validación previa a activar ya debería haberlo evitado.

La verificación es un solo `SELECT` sobre `pipeline_stages` con `id` y `pipeline_id`, más el `account_id` del embudo. Se hace **antes** de tocar `deals`.

### 5. Sin migración

`automation_steps.step_type` es `text` sin `CHECK` (verificado con `\d automation_steps` en el servidor), y `step_config` es `jsonb` libre. El paso nuevo es un valor más. Las instalaciones que no lo usen no notan nada, y una fila con `move_deal_stage` en una versión vieja del código caería en el `default` del `switch` — que ya devuelve "unknown step type" sin romper la corrida.

### 6. La UI reusa `DealPipelineFields`

El editor de `create_deal` ya resuelve el par embudo → etapa con las etapas filtradas por embudo. El paso nuevo usa el mismo componente y no agrega claves de i18n para los campos, solo la etiqueta del paso. Menos superficie nueva y consistencia visual gratis.

## Risks / Trade-offs

- **Carrera entre dos entrantes simultáneos del mismo contacto** → puede colarse un negocio duplicado. Mitigación: la ventana es mínima y el disparador que usaría la guarda corre una vez por contacto; el arreglo manual es arrastrar y borrar. Si alguna vez duele, la salida es un índice único parcial, y esta decisión queda escrita para poder revisarla.
- **"Mover el más reciente" puede sorprender** cuando el contacto tiene dos negocios abiertos creados a mano en el mismo embudo. Mitigación: el resultado del paso dice qué negocio movió, con su id, así que el registro explica lo que pasó.
- **Un paso silencioso puede parecer roto**: el operador que no ve moverse la tarjeta necesita saber por qué. Mitigación: los tres desenlaces (movido, ya estaba, no había) devuelven textos distintos y explícitos al registro de la corrida.
- **Duplica el criterio de "negocio abierto"** en dos pasos. Mitigación: una sola función auxiliar compartida (`findOpenDeal`) para que la definición viva en un lugar.

## Migration Plan

No hay migración de datos ni de esquema. El despliegue es el habitual: `develop` → `main` → `git pull` + rebuild en el VPS. La automatización "Crear negocio al calificar" sigue inactiva y sin tocar; reconfigurarla para que use el paso nuevo es un acto posterior y manual, desde la UI.

Rollback: revertir el commit. Una fila `move_deal_stage` que quedara guardada cae en el `default` del `switch` y se anota como paso desconocido, sin romper la corrida.

## Open Questions

- ¿El paso debería poder mover el negocio a una etapa **relativa** ("la siguiente") en vez de una fija? Sería más robusto ante renombrados de etapas, pero introduce el concepto de orden en la configuración. Se difiere hasta ver cómo se usa la versión fija.
