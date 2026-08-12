## Why

El CRM opera en español (`NEXT_PUBLIC_APP_LOCALE=es`, catálogo `es.json` completo), pero **lo que el cliente lee por WhatsApp está en inglés y no es de este negocio**. No es una omisión de traducción: los guiones vienen del CRM genérico del que se hizo el fork y hablan de un SaaS por asientos, no de compraventa de vehículos.

La evidencia está en la propia base. De las cinco ejecuciones del flujo "Lead capture":

- Una persona respondió literalmente **"En español por favor"** al prompt `What's your name?`, y el motor lo guardó como su nombre.
- Otras dos guardaron ruido (`"Hiuy"`, `"Huyghb"`): nadie entiende qué le están preguntando.
- Una quedó **colgada en `active`** sobre el nodo `ask_name` desde el 11-ago, de un flujo que ya volvió a borrador. Ese contacto sigue esperando.

Y aunque estuviera en español, el guion no serviría: pide *nombre, correo laboral y empresa* a alguien que escribió para preguntar por un auto.

Hay además tres defectos de coherencia que solo se ven al leer el código junto con los datos:

1. **Doble saludo.** El flujo "Lead capture" y la automatización "Welcome Message" comparten el disparador `first_inbound_message`. El webhook (`src/app/api/whatsapp/webhook/route.ts:844`) dispara los triggers *de relación* aunque un flujo ya haya consumido el mensaje — es deliberado y correcto. Pero significa que activar ambos manda dos saludos al mismo cliente nuevo.
2. **La derivación no entrega nada.** `executeHandoff` (`src/lib/flows/engine.ts:536`) guarda `note` **cruda, sin interpolar**, y solo dentro del payload del evento de log. Los `{{vars.name}}`, `{{vars.email}}` y `{{vars.company}}` del flujo actual son texto muerto: el agente que toma la conversación nunca ve lo que el cliente respondió. Todo el trabajo de recolectar se pierde.
3. **Negocio de 20.000 por cada saludo.** El paso `create_deal` de "Welcome Message" crea un negocio de valor fijo 20.000 en la etapa "New Lead" con *cada* primer mensaje entrante, antes de saber siquiera qué auto le interesa a la persona.

Hoy nada de esto se nota porque **las dos automatizaciones están inactivas y el flujo en borrador**: el CRM no reacciona solo a nada. El costo aparece el día que se activen.

## What Changes

- **Los guiones pasan a ser de compraventa de vehículos, en español.** El bot deja de pedir correo laboral y empresa, y pasa a preguntar por vehículo de interés, presupuesto, forma de pago y si entrega un auto en parte de pago.
- **Se reparte quién le habla al cliente.** Regla única: en el primer contacto **el flujo conversa y la automatización solo actúa en silencio** (etiquetar, registrar). Ninguna automatización que comparta disparador con un flujo activo vuelve a enviar un mensaje. El motor no cambia; cambia el contrato de contenido, y el builder avisa cuando se lo está por romper.
- **La derivación entrega el resumen al agente.** Lo que el cliente respondió deja de morir en el log: la nota se interpola y llega a la conversación como nota interna, de modo que quien la toma ve el resumen sin abrir el visor de ejecuciones.
- **El negocio se crea cuando hay algo que valga un negocio**, no con cada saludo, y con valor real en lugar de 20.000 fijo.
- **Las plantillas semilla se reescriben** para el rubro y en español, y sus nombres y descripciones pasan por el catálogo en vez de renderizarse crudos desde el módulo TS.
- **Los mensajes de validación salen del catálogo.** Los ~65 mensajes en inglés de `flows/validate.ts` y `automations/validate.ts` se pintan hoy tal cual en el panel de validación y en los toasts del builder.
- **Se corrigen los restos de interfaz sin traducir**: `aria-label`s, placeholders y errores tipo `Failed to load flows: 500`.
- **Se saneen los datos ya cargados**: las 2 automatizaciones, el flujo, las 5 etapas del embudo (`New Lead` … `Won`) y la ejecución huérfana.

**Fuera de alcance**

- Plantillas de mensaje de Meta (`message_templates`). Solo existe `hello_world` en `en_US`; crear plantillas en español requiere aprobación de Meta y es un trámite aparte, no un cambio de código.
- Recolectar el vehículo de interés cruzándolo contra `inventory_vehicles`. El guion lo pregunta en texto libre; enlazarlo al stock real merece su propio análisis (ya existe `vehicle_inquiries` para atribución por CTA de vitrina).
- Traducir el catálogo `ko.json` con criterio humano. Se mantiene la paridad de claves que exige `spanish-locale`, sin pretender calidad de traducción al coreano.

## Capabilities

### New Capabilities
- `vehicle-lead-qualification`: qué le pregunta el bot a quien escribe por un vehículo, en qué orden, y qué se hace con cada respuesta hasta que un agente toma la conversación.
- `inbound-response-ownership`: qué motor le responde al cliente ante un mismo evento entrante, para que reciba exactamente una respuesta y no dos.

### Modified Capabilities
- `spanish-locale`: hoy exceptúa "plantillas" del requisito de que todo texto visible salga del catálogo. Esa excepción se acota a las plantillas de mensaje de Meta cargadas por el usuario; los mensajes de validación y la galería de plantillas semilla pasan a ser texto de interfaz sujeto al requisito.
- `flow-handoff-routing`: la derivación pasa a entregarle al agente lo que el cliente respondió, con la nota interpolada y visible en la conversación. Hoy el spec solo cubre *a quién* se asigna, no *con qué contexto*.

## Impact

**Datos ya cargados** (cuenta `f7aa2ec8-5661-4067-b4c7-82f8ef8559a2`)
- `automations` ×2 y sus 6 `automation_steps`; `flows` ×1 y sus 7 `flow_nodes`.
- `pipeline_stages` ×5 del embudo "Proceso Compra - Venta".
- 1 `flow_run` huérfano en `active`.
- Migración en el rango **509+** (la última es `508_vehicle_economics.sql`). Debe ser idempotente y **no puede asumir estos UUIDs**: son de esta instalación. Actualiza por coincidencia de contenido, y no toca filas que el operador ya haya editado a mano.

**Código**
- `src/lib/flows/templates.ts`, `src/lib/automations/templates.ts` — reescritura de las 3 + 4 plantillas.
- `src/app/api/flows/templates/route.ts:25` y `src/app/(dashboard)/automations/page.tsx:197` — hoy pintan `name`/`description` crudos; pasan a resolver claves de catálogo.
- `src/lib/flows/validate.ts` (~40 mensajes), `src/lib/automations/validate.ts` (~25) — pasan a devolver claves, no prosa.
- `src/components/flows/validation-panel.tsx:95`, `src/components/automations/automation-builder.tsx:704` — traducen en el punto de render.
- `src/lib/flows/engine.ts:504-544` — interpolar la nota de derivación y entregarla al agente.
- `src/lib/automations/engine.ts:580` — `value: cfg.value ?? 0` no interpola; para un valor de negocio real hay que resolverlo como ya se hace con `title` (`:579`).
- Restos sin i18n: `node-config-form.tsx:469,511,670,818,941`, `header.tsx:70,83,172`, `flow-editor-shell.tsx:109`, `automation-builder.tsx:879,1157,1166,1476`, `automations/page.tsx:339`, y los `throw new Error("Failed to …")` de `flows/page.tsx:105,144,185`, `flows/[id]/page.tsx:45`, `flows/[id]/runs/page.tsx:122`, `flow-editor-state.tsx:435`.
- `messages/{es,en,ko}.json` — claves nuevas en los tres, según exige `spanish-locale`.

**Riesgos**
- **La migración de datos toca contenido que el operador pudo haber editado.** El nodo `send_message` con "Transfiriendo a un agente de servicio" es edición manual suya, no de la plantilla. Sobrescribirlo a ciegas borra trabajo.
- **Cambiar `pipeline_stages` afecta negocios existentes.** Renombrar es seguro; reordenar o borrar etapas no. La migración solo renombra.
- **Interpolar la nota de derivación cambia comportamiento observable** de flujos que ya existen en otras instalaciones del fork: una nota con `{{…}}` que hoy se guarda literal pasará a resolverse.
- **Los tests de paridad de catálogos** (`src/i18n/messages.test.ts`, `icu-safety.test.ts`) fallan si una clave nueva no entra en los tres archivos o si lleva `{{…}}` leído con `t()` plano.
