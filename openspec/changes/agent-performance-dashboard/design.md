## Context

El dashboard actual (`src/lib/dashboard/queries.ts`) agrega en el cliente y mide la cuenta entera: conversaciones abiertas, mensajes por día, tiempo de respuesta. Nunca desglosa por asesor, y las tres piezas que harían falta para hacerlo no existen o están vacías:

- **Propiedad del lead**: `conversations.assigned_agent_id` es el único rastro, y es estado mutable. Se borra al devolver el hilo al bot (`route.ts:84` pone `assigned_agent_id = null`) y se pisa en cada reasignación. No hay tabla de historial.
- **Autoría del mensaje**: `messages.sender_id` existe en el esquema pero el insert de `src/lib/whatsapp/send-message.ts:522` nunca lo escribe. Los 111 mensajes de asesor en producción lo tienen en NULL.
- **Etapa del embudo**: `deals` está vacía —0 filas, histórico incluido— porque la automatización de alta de prospecto lleva apagada desde el 2026-09-14.

Además, el cálculo de tiempo de respuesta existente (`queries.ts:194`) empareja el entrante con el siguiente saliente **sea de bot o de humano**, así que hoy mide una mezcla de los 16 segundos de la IA y las casi 3 horas del asesor.

Devolverle el hilo al bot le fallaba al rol `agent`. Hubo una migración 530 que le añadía una excepción al trigger `enforce_agent_keeps_assignment` de la 520; **se descartó del lote el 2026-09-23 sin desplegarse**. QA comprobó en producción, con `authenticated` y el JWT de un `agent`, que con la 530 aplicada el `agent` seguía sin poder desasignar: lo rechaza la política `conversations_select` sobre la fila resultante, no el trigger. El camino real ya escribe con service-role (`escribeConServiceRole()` en `src/lib/inbox/assignment.ts`), donde `auth.uid()` es NULL y el trigger de la 520 no corre, así que la 530 no habilitaba nada y solo relajaba la garantía de la 520. La regla "un `agent` no suelta el hilo, pero sí lo devuelve al bot" vive en el código de los endpoints (ver decisión 8).

## Goals / Non-Goals

**Goals:**

- Que la propiedad del lead deje de depender del estado actual de la conversación.
- Que el dueño vea, por asesor, cuántos clientes tiene en gestión, en qué etapa están y cuánto tarda en responder.
- Que un cliente que ya habló con un asesor vuelva a ese asesor y no a otro.
- Que la captura del historial no dependa de que cada camino de escritura se acuerde de registrarlo.

**Non-Goals:**

- Reconstruir el pasado. El historial nace el día del despliegue; `messages.sender_id` está vacío hacia atrás y no se va a inventar su autoría.
- Reemplazar el dashboard existente ni sus métricas de cuenta.
- Medir al bot como si fuera un asesor. La IA se mide aparte, donde ya se mide.
- Repartir automáticamente las 105 conversaciones abiertas hoy sin asignar. Es una decisión de operación, no de este cambio.

## Decisions

### 1. Historial de eventos, no de períodos

`conversation_assignments` guarda un **evento por cambio** (`conversation_id`, `from_agent_id`, `to_agent_id`, `changed_at`, `changed_by`), append-only.

*Alternativa considerada:* filas con `started_at`/`ended_at`, cerrando la anterior en cada cambio. Rechazada: obliga al trigger a actualizar la fila previa, lo que rompe la inmutabilidad y abre una carrera entre dos cambios simultáneos. Con eventos, cada escritura es un `INSERT` independiente y los períodos se derivan con `LEAD(changed_at)` cuando alguien los pida.

`changed_by` guarda `auth.uid()`, que es NULL en los caminos de service-role. **NULL no significa "lo hizo el sistema"**: significa "se escribió con service-role", y eso incluye a la IA, las automatizaciones, los flujos, la API v1 **y a todo `agent` que reasigna o devuelve al bot desde la bandeja**, porque esas escrituras van por `escribeConServiceRole()`. En producción los tres que atienden clientes son `agent`, así que la mayoría de los cambios hechos por personas también quedarán en NULL. Un valor no nulo solo aparece cuando escribe la sesión del usuario directamente (hoy, `owner`/`admin`). Nada del código lee `changed_by` hoy; si algún día hace falta distinguir el origen, hará falta otra fuente —no se añade ahora—.

### 2. Trigger de base de datos, no código de aplicación

El registro va en un trigger `AFTER INSERT OR UPDATE OF assigned_agent_id ON conversations`, con `IS DISTINCT FROM` para ignorar las escrituras que no cambian el asesor.

*Alternativa considerada:* registrar desde cada punto de escritura en TypeScript. Rechazada por lo mismo que llevó a poner el horario de atención en `outbound/gate.ts` y no en cada automatización: hay cinco caminos que asignan —IA, motor de automatizaciones, bandeja, API v1 y SQL a mano— y basta que uno se olvide para que la estadística mienta. El trigger los cubre todos y cubre también los que se agreguen después.

`AFTER` y no `BEFORE`: el historial no debe poder abortar la asignación. Un fallo ahí cuesta una fila de estadística, nunca un cliente sin asesor.

### 3. Siembra del estado actual, declarada como tal

La migración inserta una fila inicial por cada conversación hoy asignada, con `from_agent_id` nulo y `changed_at = conversations.updated_at`.

Esto hace que "clientes en gestión" funcione desde el primer día en vez de arrancar en cero. `updated_at` es una **aproximación** —no es el instante real de la asignación— y por eso la fila se marca como siembra: los cálculos de duración la excluyen. El tiempo de respuesta sí nace vacío, porque no hay manera honesta de sembrarlo.

### 4. Las métricas por asesor van en una RPC de SQL

Una función `SECURITY DEFINER` devuelve la tabla ya agregada, en vez de traer los datos crudos al navegador como hace el resto del dashboard.

*Alternativa considerada:* seguir el patrón de agregación en cliente de `queries.ts`. Rechazada: el tiempo de respuesta obliga a recorrer **todos** los mensajes para emparejarlos, y por decisión del Director la tabla no lleva ventana de tiempo, así que el barrido es sobre el historial completo —más de 700 entrantes por semana hoy, y creciendo con la campaña—. Traer eso al navegador no es viable. Es exactamente el caso que el propio comentario de `queries.ts:20` anticipa como el punto de migrar a RPC.

La RPC además encapsula el control de acceso: comprueba el rol adentro y devuelve vacío para un `agent`, de modo que la regla no viva solo en la interfaz.

### 7. Sin ventana de tiempo, y lo sin asignar en su propia fila

La tabla mide **todo** lo asignado a cada asesor, sin acotar por fecha: un lead abierto hace tres meses sigue siendo trabajo en gestión y debe verse. Y lo que no tiene dueño aparece en una fila "Sin asignar" con el mismo criterio de conteo.

Esa fila no es un adorno: hoy son 105 conversaciones abiertas que ninguna métrica cuenta y que los asesores tampoco ven, porque la RLS de la migración 520 les esconde lo no asignado. Sin la fila, el único que podría notarlas —el dueño— tampoco las ve.

Su tiempo de respuesta queda ausente por definición: no hay asesor a quien medir.

**Ajuste del 2026-09-21, tras ver el primer dato real.** La regla original —listar solo a los `agent`— dejaba 70 conversaciones de una administradora dentro de "Sin asignar", porque `admin` no es `agent`. Eran la campaña de propietarios, o sea gestión real de clientes, y la tabla habría dicho 178 huérfanas donde había 108. La regla queda así: fila propia para todo `agent`, aunque esté en cero, y para todo `owner`/`admin` **con cartera**; "Sin asignar" es solo lo que no tiene a nadie vigente detrás. Lo que se mide es quién atiende, no qué rol tiene.

### 5. Continuidad por historial, carga como respaldo

`pickHandoffAgent` consulta primero la última asignación de esa conversación. Si ese usuario sigue siendo miembro con rol `agent`, se lo devuelve. Si no hay historial o el asesor ya no es candidato, cae al reparto por carga de siempre.

Esto invierte la prioridad respecto de hoy y es deliberado: la carga reparte bien un lead **nuevo**, pero no debería mover uno que ya tiene dueño. El caso que lo motiva es concreto: Juan reactiva la IA en un hilo suyo, deja de contar como su carga (`pick-agent.ts:73` salta los no asignados), y el siguiente traspaso lo manda a otro asesor por una diferencia de una conversación.

### 6. El negocio se crea en `handOffToHuman`, con unicidad en la base

La creación del `deal` va dentro de `handOffToHuman` (`auto-reply.ts:419`), después de resolver el asesor, para que el negocio nazca ya asignado.

La deduplicación no se deja a un `SELECT` previo: dos traspasos casi simultáneos pasarían los dos. Va un **índice único parcial** sobre `deals (conversation_id) WHERE status = 'open'`, y el código trata la violación de unicidad como "ya existe", no como error. Es la misma lección de `create_deal` en el motor de automatizaciones, que hace un `insert` pelado y por eso no puede usarse con disparadores repetibles.

### 8. La devolución al bot se decide en el endpoint, mirando la transición

Soltar el hilo y devolverlo al bot terminan igual en la base (`assigned_agent_id = NULL`), y los dos endpoints que lo hacen escriben con service-role cuando actúa un `agent`, donde ni la RLS ni el trigger de la 520 comprueban nada. Por eso la regla vive en funciones puras de `src/lib/inbox/assignment.ts` que aplican los dos endpoints:

- `PATCH /api/conversations/[id]/assignee` nunca deja a un `agent` poner NULL.
- `POST /api/ai/autoreply/[id]` con `paused: false` sí, pero solo si **esa operación es la que reactiva la IA**: `ai_autoreply_disabled` era TRUE en la lectura previa (que va con el cliente de sesión) — `esDevolucionAlBot()`. Con la IA ya activa, quitar el asesor sería soltarlo, y se rechaza con 403 y `code: "ai_already_active"`, que la bandeja traduce (`src/lib/inbox/autoreply-errors.ts`). Un estado previo desconocido se trata como activo.

`owner` y `admin` no necesitan la excepción.

### 9. Un saliente fallido no es una respuesta

En el tiempo de primera respuesta, un saliente humano con `status = 'failed'` no cierra la espera ni genera muestra: nunca le llegó al cliente. El cliente sigue esperando hasta el siguiente saliente que sí salga. En producción había 6 así al 2026-09-23.

## Risks / Trade-offs

- **Las métricas nacen parciales** → Se declara en la interfaz. El desglose por etapas arranca vacío hasta que el traspaso empiece a crear negocios, y el tiempo de respuesta hasta que haya mensajes con autor. No se muestran ceros que se lean como resultados medidos.

- **Una tabla nueva sin `GRANT` explícito responde `permission denied` aunque la RLS esté bien** → La migración incluye los `GRANT` junto a las políticas, y la verificación de QA los comprueba desde un cliente autenticado, no desde `psql` como `postgres`, que los saltaría sin avisar.

- **La siembra con `updated_at` da una fecha aproximada** → Las filas de siembra se excluyen de cualquier cálculo de duración; solo sostienen el conteo de clientes en gestión.

- **La continuidad puede desbalancear el reparto** → Es el efecto buscado, pero significa que un asesor con muchos hilos reactivados acumula. Se mide con la tabla nueva; si desbalancea de verdad, se acota con un tope de antigüedad para la continuidad, que es un cambio de una condición.

- **La RPC se sale del patrón de agregación en cliente** → Queda como la primera de su tipo en el dashboard. Se documenta en el propio archivo para que la siguiente métrica pesada siga el mismo camino en vez de inventar un tercero.

- **Índice único parcial sobre `deals`** → Impide dos negocios abiertos por conversación también desde la bandeja, que hoy lo permite. Es coherente con lo que espera el embudo, pero es un cambio de comportamiento para la creación manual y QA debe verificarlo explícitamente.

- **Sin ventana de tiempo, el costo del cálculo crece con la historia y no se estabiliza** → Es la decisión del negocio y se implementa tal cual, pero conviene saber a qué se parece: hoy son unos miles de mensajes y la RPC responde sin problema; en un año serán cientos de miles. La mitigación va en el diseño desde ahora —índice por `conversation_id, created_at` sobre `messages` y el emparejamiento resuelto en SQL, no en memoria— y el punto de revisión es cuando la RPC pase de un segundo. Si llega ahí, la salida natural es una tabla de agregados que el mismo trigger mantenga al día, no recortar el período a espaldas del dueño.

## Migration Plan

El lote son **tres migraciones: 531, 532 y 533** (la última aplicada en el VPS es la 529). El número **530 queda vacío a propósito**: la migración que lo ocupaba se descartó sin desplegarse (ver Context), y un hueco en la numeración es inocuo mientras que renumerar lo ya revisado no lo es. Antes de desplegar, comprobar los números contra `supabase_migrations.schema_migrations` en el VPS y no solo contra el `ls` local: dos archivos con el mismo prefijo se saltan en silencio.

1. **531** — `conversation_assignments`: tabla, índices, RLS, `GRANT`, trigger y siembra del estado actual.
2. **532** — índice único parcial en `deals`, índice de apoyo en `messages` y la RPC de métricas por asesor.
3. **533** — el negocio sobrevive al borrado de la conversación.

Despliegue con `./scripts/apply-migrations.sh --dry-run` primero, confirmando que aparecen como pendientes **exactamente 531, 532 y 533**, y ninguna 530. El respaldo previo (`./scripts/backup.sh`) es parte del procedimiento de `docs/self-hosting.md`.

**Orden:** las tres salen juntas y con el código del lote. La reactivación de la IA por un `agent` no depende de ninguna migración —la habilita el endpoint con service-role (decisión 8)—, pero habilitarla sin el historial de la 531 multiplicaría la pérdida de rastro, y el código del lote crea negocios y lee la tabla de la 531, que la 532 y la 533 respaldan.

**Rollback:** las tres son idempotentes y reversibles por separado. La 531 y la 532 se revierten dejando de leer sus objetos —la tabla y el índice pueden quedarse sin efecto para la aplicación—. El único camino sin vuelta atrás es la siembra, que es un `INSERT` de datos y se limpia con un `DELETE` acotado a las filas de siembra.

## Open Questions

**Resueltas por el Director de TI el 2026-09-21:**

- ~~Período de la métrica~~ → **Sin ventana de tiempo.** La tabla muestra todo lo asignado a cada asesor. Ver decisión 7 y el riesgo de costo creciente.
- ~~Qué hacer con las 105 conversaciones sin asignar~~ → **Van en una fila "Sin asignar"** dentro de la misma tabla. No se reparten ni se cierran en este cambio; se hacen visibles, que era el problema.

- ~~Qué hacer cuando un asesor deja la cuenta~~ → **Su trabajo pasa a "Sin asignar"**, y él desaparece de la tabla. Su historial se conserva intacto. Nota de implementación: la fila "Sin asignar" no puede calcularse solo con `assigned_agent_id IS NULL`; tiene que incluir también lo asignado a un usuario que ya no es miembro con rol `agent`.

**Abiertas:** ninguna.
