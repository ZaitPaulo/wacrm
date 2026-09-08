## Context

El CRM corre en español y el catálogo `es.json` está completo (1867 claves, paridad con `en.json`). Lo que quedó en inglés es todo lo que **no** pasa por el catálogo: el contenido semilla de las plantillas, los mensajes de validación, un puñado de `aria-label` y placeholders, y —lo más visible para el cliente— los tres objetos ya cargados en la base.

Cuatro restricciones del código condicionan el diseño y se verificaron leyéndolo:

1. **`vars` solo lo escribe `collect_input`** (`src/lib/flows/engine.ts:1042`). Un toque de botón o de fila de lista enruta por `next_node_key` pero **no deja rastro de qué eligió el cliente**. Cualquier guion que capture presupuesto o forma de pago con opciones tocables no puede, hoy, contárselo a nadie.
2. **La nota de derivación no se interpola ni se entrega** (`engine.ts:536`): se guarda cruda dentro del payload del evento de log. Los `{{vars.*}}` del flujo actual son texto muerto.
3. **Las dos interpolaciones no son iguales.** `interpolateVars` en flujos (`engine.ts:607`) usa `\{\{vars\.([a-zA-Z0-9_]+)\}\}` — **sin tolerancia a espacios**. `interpolate` en automatizaciones (`automations/engine.ts:793`) usa `\{\{\s*([\w.]+)\s*\}\}` — sí los tolera. Escribir `{{ vars.nombre }}` funciona en una y falla silenciosamente en la otra.
4. **`create_deal.value` no interpola** (`automations/engine.ts:580`: `value: cfg.value ?? 0`), a diferencia de `title` en la línea inmediatamente anterior.

Y una restricción de alcance: los endpoints de flujos y automatizaciones **no** forman parte de la API pública. `docs/public-api.md` y `src/app/api/v1/` cubren broadcasts, contacts, conversations, me, messages y webhooks; flows aparece solo en la lista de "ideas futuras". Sus contratos se pueden cambiar sin romper consumidores externos.

## Goals / Non-Goals

**Goals:**

- Que el cliente lea español y que le pregunten por autos.
- Que lo que el cliente responde llegue al agente que atiende.
- Que activar todo lo entregado no produzca respuestas duplicadas.
- Que los datos ya cargados queden saneados sin pisar las ediciones manuales del operador.
- Que el operador vea la validación en español.

**Non-Goals:**

- Cambiar el despacho del webhook. `route.ts:844` es correcto: los disparadores de relación deben seguir disparando aunque un flujo consuma el mensaje. El problema es de contenido configurado, no de motor.
- Pasar variables del flujo a las automatizaciones. El contexto de automatización solo transporta `message_text`, `conversation_id` e `interactive_reply_id`; conectar ambos mundos es un cambio de arquitectura que este trabajo no necesita.
- Enlazar el vehículo de interés contra `inventory_vehicles`.
- Crear plantillas de mensaje de Meta en español (trámite de aprobación, no código).

## Decisions

### 1. Los toques de botón y lista se guardan en `vars` bajo la clave del nodo

**Decisión.** Cuando el cliente toca una opción en un nodo `send_buttons` o `send_list`, el motor guarda el **título visible** de la opción elegida en `vars[<node_key>]`.

**Por qué.** Es lo que desbloquea el requisito de que la derivación entregue el contexto: sin esto, un guion que pregunta presupuesto y forma de pago con botones no puede reportar ninguna de las dos respuestas. Guardar bajo la clave del nodo no agrega ninguna superficie de configuración: el `node_key` ya existe, ya es estable y el builder ya se lo muestra al operador como "identificador interno". Además aplica retroactivamente a todo flujo existente, sin migración.

Se guarda el **título** y no el `reply_id` porque el consumidor es una nota que lee una persona: "Con financiamiento" es útil, `financiado` no lo es. El enrutamiento sigue haciéndose por `next_node_key` como hasta ahora, así que nada depende del id para funcionar.

**Alternativa descartada:** agregar un campo `var_key` opcional a `SendButtonsNodeConfig` y `SendListNodeConfig`, simétrico a `collect_input`. Es más explícito y más descubrible, pero arrastra cambios en tipos, formulario del builder, validación y tres catálogos, y deja el comportamiento apagado por defecto — con lo cual el flujo semilla funcionaría pero los flujos que el operador ya armó seguirían perdiendo las respuestas. Queda como evolución posible si algún día se necesita elegir el nombre de la variable.

**Riesgo asumido:** si un `collect_input` usa un `var_key` idéntico al `node_key` de un nodo de opciones, la última escritura gana. Es improbable y no corrompe nada.

### 2. La nota de derivación se interpola y se escribe en `contact_notes`

**Decisión.** `executeHandoff` pasa la nota por `interpolateVars` y, si queda contenido, inserta una fila en `contact_notes`. El evento de log sigue registrándose igual que hoy.

**Por qué `contact_notes`.** Es la superficie que el agente ya tiene delante: `src/components/inbox/contact-sidebar.tsx:53` la lee y la muestra junto a la conversación. No hay que construir nada nuevo ni enseñarle al agente dónde mirar. La alternativa —insertar un mensaje interno en `messages`— contaminaría el hilo de la conversación con texto que no se envió a nadie, y el hilo es lo que el agente usa para saber qué vio el cliente.

La escritura va por el cliente admin (service role), así que la política RLS `auth.uid() = user_id` no aplica; se persiste `user_id` = `flows.user_id`, igual que hace el resto del motor.

**Compatibilidad.** Esto cambia comportamiento observable de flujos que ya existen: una nota con `{{…}}` que hoy se guarda literal pasará a resolverse, y aparecerán notas de contacto donde antes no había. Es exactamente lo que el operador quiso al escribir la nota, pero conviene mencionarlo en el changelog.

### 3. La interpolación de flujos pasa a tolerar espacios

**Decisión.** Relajar el patrón de `interpolateVars` a `\{\{\s*vars\.([a-zA-Z0-9_]+)\s*\}\}`.

**Por qué.** Hoy `{{ vars.nombre }}` no interpola en flujos pero sí en automatizaciones. La diferencia no está documentada en ninguna parte y falla en silencio: el cliente recibe las llaves en pantalla. Es una línea, elimina una clase entera de errores, y ningún texto que hoy funciona deja de funcionar.

### 4. La validación devuelve códigos, no frases

**Decisión.** `ValidationIssue` cambia de `message: string` a `code: string` + `params?: Record<string, string | number>`. La traducción ocurre en el punto de render: `validation-panel.tsx` y el toast de `automation-builder.tsx`.

**Por qué.** Las mismas funciones corren en el servidor —donde no hay idioma de usuario— y en el cliente. Devolver prosa desde una capa que no sabe en qué idioma habla el operador es el origen del problema. Con códigos, el servidor puede seguir rechazando activaciones inválidas y el cliente redacta en el idioma activo.

Se reemplaza el campo en lugar de agregarlo junto al existente porque estos endpoints no son API pública y no hay consumidor externo que preservar. Dejar ambos garantizaría que alguien renderice el equivocado.

Los mensajes con datos variables (`Duplicate node_key "x"`, `Caption exceeds N chars`) pasan sus valores por `params` y el catálogo los interpola con ICU. Cuidado con `src/i18n/icu-safety.test.ts`: cualquier clave nueva que contenga `{{…}}` literal debe leerse con `t.raw()`.

**Hueco conocido: `validateInteractivePayload`.** Los pasos `send_buttons` y `send_list` de las automatizaciones no validan por sí mismos: delegan en `src/lib/whatsapp/interactive.ts`, que devuelve prosa en inglés. Ese módulo lo comparten además las respuestas rápidas, el compositor de la bandeja y el constructor de mensajes interactivos —que ya hoy pintan su `error` crudo—, así que convertirlo a códigos es un cambio de alcance mayor y con más superficie que este. Aquí su texto viaja como el parámetro `detail` del código `interactiveInvalid`, de modo que el operador ve en español el marco de la frase y en inglés el detalle de qué objetó Meta. Queda como trabajo aparte.

### 5. El reparto de disparadores es un contrato de contenido, más una advertencia

**Decisión.** No se toca el webhook. La regla operativa es **el flujo conversa, la automatización actúa**, y se hace cumplir de dos maneras:

- El contenido entregado la respeta: la automatización de primer contacto solo etiqueta.
- Al activar una automatización cuyo disparador de relación coincide con el de un flujo activo, y que tiene al menos un paso de los que envían mensaje (`send_message`, `send_buttons`, `send_list`, `send_template`), el servidor devuelve una **advertencia** junto con la respuesta exitosa, nombrando el flujo en conflicto.

**Por qué advertencia y no bloqueo.** Puede haber razones legítimas para querer las dos cosas —por ejemplo un flujo que solo atiende una rama y una automatización que cubre el resto—. El sistema no tiene información suficiente para decidir por el operador, pero sí para avisarle. Y bloquear sería, además, imponerle una política al fork de otras instalaciones.

**Por qué en el servidor.** El cliente ya tiene que consultar los flujos activos para saberlo, y la comprobación importa igual si la activación entra por otra vía.

### 6. La creación del negocio se mueve al momento de calificar

**Decisión.** El `create_deal` sale de la automatización de primer contacto y pasa a una automatización disparada por `tag_added` con la etiqueta de prospecto calificado. Se crea con `value: 0`.

**Por qué valor cero.** El presupuesto que declara el cliente es un rango elegido de una lista, no un precio. `create_deal.value` además no interpola (`automations/engine.ts:580`), así que ni siquiera podría recibir un valor variable sin tocar el motor — y el dato tampoco cruzaría desde el flujo, porque el contexto de automatización no transporta las variables de la ejecución. Cero significa "sin valorar" y el agente lo completa cuando toma la conversación, que es justo cuando lee la nota con el presupuesto declarado. Inventar 20.000 fue precisamente el defecto que se está corrigiendo; reemplazarlo por otra cifra fija repetiría el error.

**No se extiende `create_deal` para interpolar `value`.** Sería un cambio razonable en sí mismo, pero no tendría de dónde sacar el dato en esta cadena. Queda fuera.

### 7. Estructura del guion de calificación

Un solo flujo, disparador `first_inbound_message`. Las respuestas acotadas van por botones y lista; el texto libre queda para lo que solo el cliente puede redactar.

```
start
└─ saludo ......................... send_buttons  "¿Con qué te ayudamos hoy?"
   ├─ [Quiero comprar] ─────────► compra_vehiculo
   ├─ [Vendo mi auto] ──────────► venta_vehiculo
   └─ [Otra consulta] ──────────► otro_handoff

compra_vehiculo ................... collect_input → vars.vehiculo_interes
└─ compra_presupuesto ............. send_list     → vars.compra_presupuesto
   └─ compra_pago ................. send_buttons  → vars.compra_pago
      ├─ [De contado] ──────────► calificado
      ├─ [Con financiamiento] ──► calificado
      └─ [Entrego mi auto] ─────► permuta_vehiculo
                                   └─ collect_input → vars.vehiculo_permuta
                                      └─────────► calificado

venta_vehiculo .................... collect_input → vars.vehiculo_ofrecido
└─────────────────────────────────► calificado

calificado ........................ set_tag "Calificado"
└─ cierre ......................... send_message "Un asesor te escribe…"
   └─ handoff ..................... nota interpolada → contact_notes

otro_handoff ...................... handoff, nota "Consulta general"
```

Las tres variables de las ramas de compra (`compra_presupuesto`, `compra_pago`) existen gracias a la decisión 1. La nota de derivación las concatena; las que esa ejecución no recorrió se resuelven como vacío, que es el comportamiento actual de `interpolateVars` para claves ausentes.

Límites de la API de WhatsApp respetados por construcción: 3 botones como máximo por nodo, títulos de botón ≤20 caracteres, ≤10 filas de lista en total, títulos de fila ≤24. `src/lib/flows/validate.ts` los verifica y el flujo semilla debe pasar la validación sin errores.

**Moneda y rangos de presupuesto.** La cuenta tiene `default_currency = 'COP'`, así que los rangos se expresan en pesos colombianos. Los cortes **no se estiman: se derivan del inventario cargado**, que va de $40.000.000 a $198.000.000 con nueve unidades disponibles entre $45.000.000 y $138.000.000:

| Opción de la lista | Disponibles hoy |
|---|---|
| Hasta $60 millones | 3 — Sandero, Onix, Picanto |
| $60 a $90 millones | 3 — Swift, Versa, Tracker |
| $90 a $130 millones | 2 — Corolla, Tiguan |
| Más de $130 millones | 1 — CX-5, más Ranger reservada y Hilux vendida |
| Aún no lo defino | — |

Cinco filas, dentro del límite de diez, y ningún rango queda sin stock que ofrecer: un cliente que elige un rango vacío es un cliente al que se hizo elegir para nada.

`create_deal` lee `accounts.default_currency` en tiempo de ejecución (`automations/engine.ts:567-581`), de modo que los negocios quedan en COP sin configuración adicional y sin que la plantilla tenga que saberlo.

**Estos rangos envejecen con el inventario.** Son texto estático dentro del guion; si el stock se corre hacia arriba, las opciones dejan de representarlo. La descripción de la plantilla lo advierte y el guion es editable desde el builder, que es donde el operador corrige esto sin tocar código. Derivarlos dinámicamente de `inventory_vehicles` obligaría a recalcular el nodo en cada envío y a lidiar con un inventario momentáneamente vacío; no compensa para cinco opciones que cambian un par de veces al año.

### 8. La migración de datos solo reescribe lo que sigue igual a la semilla original

**Decisión.** La migración (rango 509+, idempotente) no puede asumir los UUIDs de esta instalación. Empareja por contenido y aplica una regla: **un valor se reescribe únicamente si todavía coincide, carácter por carácter, con el texto en inglés de la plantilla original.** Si difiere, el operador lo editó y la fila queda intacta.

**Por qué.** Es lo que protege el trabajo manual. El nodo `send_message` con "Transfiriendo a un agente de servicio" es una edición del operador, no de la plantilla; no coincide con ninguna semilla y por lo tanto no se toca. La regla es también lo que hace la migración segura de re-ejecutar: en la segunda corrida ya nada coincide con el inglés original y no hace nada.

Alcance de la migración:

| Objeto | Acción |
|---|---|
| `automations` ×2 | Renombrar, redescribir; palabras clave a español |
| `automation_steps` ×6 | Traducir textos; quitar el `create_deal` de 20.000; quitar el `wait` de 10 min previo a la asignación |
| `flows` ×1 + `flow_nodes` ×7 | Reemplazar por el guion nuevo |
| `pipeline_stages` ×5 | **Solo renombrar.** Sin reordenar, agregar ni eliminar |
| `flow_runs` | Cerrar las que estén `active` sobre flujos que no están `active` |
| `tags` | Crear "Calificado" si no existe; conservar "Prospecto" |

El flujo se deja en **borrador**. Activarlo es una decisión del operador, no de una migración: hay una plantilla de Meta en `en_US` como única aprobada y conviene revisar el guion antes de que le hable a un cliente real.

### 9. Cierre de ejecuciones al desactivar un flujo

**Decisión.** Además del saneo puntual de la migración, cuando un flujo deja el estado `active` sus ejecuciones vivas se cierran, registrando el motivo.

**Por qué.** Sin esto el problema vuelve: hoy hay una ejecución parada en `ask_name` desde el 11 de agosto porque el flujo volvió a borrador y nadie cerró la ejecución. Es un cliente esperando indefinidamente.

## Risks / Trade-offs

- **La migración pisa una edición manual que no reconoce como tal** → La regla de "solo reescribo lo que coincide exactamente con el inglés semilla" es conservadora por diseño: ante la duda, no toca. Antes de aplicar se hace un volcado de los tres objetos, para poder restaurar.
- **Renombrar etapas del embudo afecta a negocios existentes** → Solo se renombra. `position`, `id` y las referencias desde `deals` quedan idénticas, así que ningún negocio se mueve.
- **Guardar los toques en `vars` bajo el `node_key` colisiona con un `collect_input` homónimo** → Última escritura gana; no corrompe la ejecución. Se documenta en el módulo.
- **Interpolar la nota de derivación cambia el comportamiento de flujos de otras instalaciones del fork** → Es un cambio deliberado y alineado con la intención de quien escribió la nota, pero debe salir en el changelog, no en silencio.
- **Cambiar la forma de `ValidationIssue` toca los dos motores y sus pruebas** → `validate.test.ts` de flujos y de automatizaciones afirman sobre `message`. Se actualizan en el mismo cambio; el compilador señala cada punto porque el campo se reemplaza en lugar de agregarse.
- **Las claves nuevas deben entrar en los tres catálogos** → `src/i18n/messages.test.ts` falla si falta alguna, y `icu-safety.test.ts` falla si una clave con `{{…}}` literal se lee con `t()` plano.
- **El volumen del cambio invita a mezclar todo en un commit** → Los grupos de tareas están ordenados para poder detenerse después de cualquiera de ellos con el repositorio en verde.

## Migration Plan

1. Volcar a un archivo los 2 `automations` con sus pasos, el `flow` con sus nodos y las 5 `pipeline_stages`, antes de tocar nada.
2. Aplicar los cambios de código (decisiones 1 a 6). El comportamiento observable no cambia hasta que existan datos que lo ejerciten.
3. Aplicar la migración `509`. Es idempotente y conservadora.
4. Verificar en la interfaz: guion en español, validación en español, galería en español.
5. El operador revisa el guion y decide activarlo.

**Reversión.** El código se revierte con `git revert`. Los datos se restauran desde el volcado del paso 1. La migración no borra filas ni cambia identificadores, así que revertir no deja huérfanos.

## Open Questions

**Resueltas**

- **Rangos de presupuesto y moneda.** En COP, tomando `accounts.default_currency` como fuente de verdad — ya vale `'COP'`. Cortes derivados del inventario, según la tabla de la decisión 7.
- **Nombre de la etiqueta de calificación.** "Calificado", junto a la "Prospecto" existente.

**Abiertas**

- **¿Activar el flujo al terminar?** Este cambio lo deja en borrador deliberadamente. Queda a decisión del operador tras revisar el guion.
- **Revisión de los rangos cuando rote el stock.** No hay recordatorio automático. Si el inventario se corre de forma sostenida, los cortes hay que ajustarlos a mano desde el builder.
