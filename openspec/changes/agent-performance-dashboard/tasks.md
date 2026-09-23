## 1. Cimientos de datos — base de datos (`/backend`)

- [x] 1.1 Migración 531: crear `conversation_assignments` (`id`, `account_id`, `conversation_id`, `from_agent_id`, `to_agent_id`, `changed_at`, `changed_by`, marca de siembra), con índices por `conversation_id` y por `account_id, changed_at`
- [x] 1.2 Migración 531: RLS de solo lectura para `owner`/`admin` y `GRANT` explícitos; verificar desde un cliente autenticado, no desde `psql` como `postgres`
- [x] 1.3 Migración 531: trigger `AFTER INSERT OR UPDATE OF assigned_agent_id ON conversations` con `IS DISTINCT FROM`, que no aborta la operación si falla
- [x] 1.4 Migración 531: sembrar una fila por cada conversación hoy asignada, con `changed_at = updated_at` y marcada como siembra
- [x] 1.5 Probar la 531 contra la base del VPS dentro de una transacción con `ROLLBACK`: asignar, reasignar, desasignar, y comprobar que una actualización que no toca el asesor no registra nada
- [x] 1.6 Migración 532: índice único parcial `deals (conversation_id) WHERE status = 'open'`
- [x] 1.7 Confirmar los números 531 y 532 contra `supabase_migrations.schema_migrations` en el VPS antes de crear los archivos

## 2. Cimientos de datos — aplicación (`/backend`)

- [x] 2.1 Escribir `sender_id` en el insert de salientes de `src/lib/whatsapp/send-message.ts:522`, con su prueba
- [x] 2.2 Continuidad en `src/lib/ai/pick-agent.ts`: preferir el último asesor del historial si sigue siendo miembro con rol `agent`, con respaldo al reparto por carga
- [x] 2.3 Pruebas de `pickHandoffAgent`: vuelve al asesor anterior, cae a carga sin historial, y cae a carga si el asesor ya no es candidato
- [x] 2.4 Dejar de borrar `ai_handoff_summary` al reactivar en `src/app/api/ai/autoreply/[conversationId]/route.ts:84`, con su prueba
- [x] 2.5 Crear el negocio en `handOffToHuman` (`src/lib/ai/auto-reply.ts:419`): embudo Ventas / primera etapa, asignado al asesor que recibe, con los datos de la calificación
- [x] 2.6 Tratar la violación del índice único como "ya existe" y no como error; un fallo creando el negocio no impide el traspaso
- [x] 2.7 Pruebas de la creación del negocio: traspaso normal, traspaso sin asesor disponible, segundo traspaso del mismo hilo, y fallo al insertar

## 3. Métricas (`/backend`)

- [x] 3.1 Migración 532: RPC `SECURITY DEFINER` que devuelve, por persona que atiende, clientes en gestión, desglose por etapa y tiempo promedio de primera respuesta, **sin ventana de tiempo** (todo el historial)
- [x] 3.2 El tiempo de respuesta empareja el entrante con el siguiente saliente **de ese asesor** por `sender_id`, ignora los de la IA y cuenta cada entrante una sola vez; el emparejamiento se resuelve en SQL, no trayendo filas a memoria
- [x] 3.3 La RPC devuelve además la fila "Sin asignar" con las conversaciones abiertas sin asesor y sus negocios, con tiempo de respuesta ausente. Incluye también lo asignado a quien ya no es miembro con rol `agent`: no basta con `assigned_agent_id IS NULL`
- [x] 3.4 La RPC comprueba el rol adentro y devuelve vacío para un `agent`
- [x] 3.5 Un asesor sin muestras devuelve tiempo ausente, no cero
- [x] 3.6 Índice sobre `messages (conversation_id, created_at)` si no existe uno que sirva, para sostener el barrido sin ventana
- [x] 3.7 Tipos en `src/lib/dashboard/types.ts` y función de carga en `src/lib/dashboard/queries.ts`, documentando por qué esta métrica va por RPC y el resto no
- [x] 3.8 Pruebas de la RPC contra el VPS en transacción con `ROLLBACK`, con datos sembrados que cubran los escenarios del spec

## 3bis. Ajuste de la regla de filas (`/backend`)

- [x] 3bis.1 La RPC lista a todo `agent` (aunque esté en cero) y a todo `owner`/`admin` **con cartera asignada**; sin cartera no aparecen
- [x] 3bis.2 "Sin asignar" pasa a ser solo lo que no tiene detrás a un miembro vigente, sin importar su rol
- [x] 3bis.3 Verificar contra producción que la fila "Sin asignar" baja a 108 y que Angélica aparece con sus 70; el cuadre con el total debe seguir exacto

## 3ter. El rol en la salida de la RPC (`/backend`)

- [x] 3ter.1 Añadir `account_role` a la salida de la RPC, con NULL en la fila "Sin asignar"
- [x] 3ter.2 Reflejar la columna en `AgentPerformanceRow` y en el mapeo de `loadAgentPerformance`, con su prueba
- [x] 3ter.3 Verificar contra producción que Angélica sale con `admin`, los tres asesores con `agent` y la fila "Sin asignar" con NULL

## 3quater. Conversaciones sin negocio en la RPC (`/backend`)

El Director leyó "13 clientes en gestión" al lado de un desglose de etapas que suma 10 y dijo, con razón, que no cuadra. Los dos datos eran correctos; la tabla los ponía lado a lado sin decir que son cosas distintas. La interfaz pasa a mostrar "10 de 13 · 3 sin negocio".

- [x] 3quater.1 Columna `open_conversations_without_deal` en la RPC: de las conversaciones abiertas de esa fila, cuántas no tienen ningún negocio abierto. Mismo criterio de agrupación que `open_conversations`, la fila "Sin asignar" incluida
- [x] 3quater.2 Reflejarla en `AgentPerformanceRow` y en el mapeo de `loadAgentPerformance`, con su prueba
- [x] 3quater.3 Verificar contra producción: `sin negocio <= abiertas` en toda fila, el caso donde la resta simple mentiría, el cuadre intacto y el impacto en el tiempo de ejecución

## 3quinquies. Defecto: borrar un contacto con negocio (`/backend`)

Regresión que introduce este mismo lote. `contacts → conversations` es CASCADE y `conversations → deals` era NO ACTION, así que borrar un contacto con negocio aborta con 23503 — incluido el borrado masivo de la lista de contactos, que falla entero si un solo contacto de la selección tiene negocio. Antes no podía pasar porque `deals.conversation_id` estaba siempre en NULL. Se ejecutó antes que el 3quater por ser un defecto que bloquea una operación de la aplicación.

- [x] 3quinquies.1 Migración 533: `deals_conversation_id_fkey` a `ON DELETE SET NULL`, coherente con `deals_contact_id_fkey`, que ya lo era
- [x] 3quinquies.2 Verificar el fallo antes y su ausencia después, en el borrado individual y en el masivo; que el negocio sobrevive desvinculado y en su etapa —el ganado incluido—; y que el índice único parcial de la 532 sigue sirviendo

## 3sexies. Defectos críticos de QA (`/backend`)

Los dos que dejaron el cambio como no desplegable.

**A — el tiempo de respuesta nacía envenenado.** Un saliente de asesor sin `sender_id` no cerraba el bloque de espera, así que la siguiente respuesta con autor heredaba un entrante que el mensaje viejo ya había contestado. Medido: 120 s reales → 36.300 s. En producción hay 146 salientes de asesor sin autor en 37 conversaciones, o sea que habría sido el caso normal, y sin ventana de tiempo esas muestras no envejecen.

**B — la 530 no habilitaba nada.** Devolverle el hilo al bot seguía fallando con `new row violates row-level security policy` para un `agent`. La culpable es la política de SELECT de `conversations`, que se aplica también a la fila resultante del UPDATE. El mismo defecto rompe la reasignación a un compañero, que está roto desde la 520.

- [x] 3sexies.1 Separar "cierra la espera" de "es atribuible" en la RPC: cualquier saliente humano cierra el bloque, y `sender_id` decide solo a quién se le apunta la muestra
- [x] 3sexies.2 Verificar el caso D de QA con la fórmula vieja y la nueva sobre los mismos datos, y que no se rompen el bot, la ráfaga ni el asesor sin muestras
- [x] 3sexies.3 Aislar contra producción, **con un usuario real y no como `postgres`**, qué control rechaza la devolución al bot: no es el trigger de la 520/530 ni el `WITH CHECK` de la política de UPDATE
- [x] 3sexies.4 Reactivación: el UPDATE pasa a service-role tras validar en código cuenta, visibilidad y que quien llama sea el asignado (o `admin`/`owner`). La lectura previa sigue con el cliente de sesión
- [x] 3sexies.5 Reglas de asignación en funciones puras (`src/lib/inbox/assignment.ts`), para que los dos endpoints no puedan divergir, con sus pruebas
- [x] 3sexies.6 Endpoint nuevo `PATCH /api/conversations/[id]/assignee` para la reasignación, por la misma vía y con la misma validación, incluido que el destinatario sea miembro de la cuenta
- [x] 3sexies.7 El cliente de escritura se elige por rol (`escribeConServiceRole`): `admin`/`owner` siguen con su sesión para que el aviso conserve el nombre de quien reasigna, y solo el `agent` va por service-role
- [x] 3sexies.8 (`/frontend`) `message-thread.tsx` deja de escribir `conversations` desde el navegador y llama al endpoint nuevo, traduciendo 400/403/404/429 a mensajes en español vía i18n

## 4. Interfaz (`/frontend`)

- [x] 4.1 Componente de tabla de rendimiento del equipo: una fila por quien atiende, con su rol y las tres métricas
- [x] 4.2 Montarlo en `src/app/(dashboard)/dashboard/page.tsx` tras `canEditSettings` de `src/lib/auth/roles.ts`
- [x] 4.3 Estados vacíos honestos: sin negocios, el desglose dice "sin datos"; sin muestras, el tiempo queda vacío y no en cero
- [x] 4.4 Un asesor sin clientes aparece con cero, no se omite; un `admin` con cartera aparece con fila propia y su rol marcado
- [x] 4.5 Fila "Sin asignar" al final de la tabla, visualmente distinguible del resto y con el tiempo de respuesta vacío
- [x] 4.6 Mensajes i18n en español, siguiendo `spanish-locale`
- [x] 4.7 Responsive a ancho de teléfono, sin desbordes horizontales, siguiendo el patrón de `mobile-inbox-layout`
- [x] 4.8 Estados de carga y de error coherentes con el resto del dashboard

## 4bis. Vincular la conversación al crear el negocio desde la bandeja (`/frontend`)

El formulario ya tenía la conversación cargada en `linkedConversation` y no la
escribía, así que el negocio nacía desvinculado: el spec `inbox-deal-creation`
quedaba sin cumplir y el índice único parcial de la 532 no podía impedir un
segundo negocio abierto sobre el mismo hilo, porque dos NULL no colisionan en
Postgres.

- [x] 4bis.1 Escribir `conversation_id` en el alta de `handleSave`, tomándolo de `linkedConversation`; solo en el alta, no en la edición
- [x] 4bis.2 Sin conversación vinculada va `null`: un contacto puede no tener ninguna y no se inventa el vínculo
- [x] 4bis.3 Pruebas: alta con conversación, alta sin conversación, y que la edición sigue sin tocar el campo

## 4ter. Ajustes tras la revisión del Director (`/frontend`)

El Director vio la tabla en el navegador: "muy ancha y vacía", y "13 clientes"
junto a un desglose de 10 negocios no le cuadraba.

- [x] 4ter.1 Densidad: acotar el ancho del bloque, juntar las cifras de cada persona y bajar el desglose por etapas a un renglón dentro de Negocios, para que deje de competir con las cifras principales. No cambia el orden de las filas, el estado vacío honesto, "Sin asignar" al final ni el total al pie
- [x] 4ter.2 Negocios en formato "10 de 13 · 3 sin negocio", con la columna `open_conversations_without_deal` de la RPC; NO calculado como `openConversations - openDeals`, porque los dos números vienen de claves distintas y la resta puede mentir
- [x] 4ter.3 El texto de "Sin asignar" pasa a "Conversaciones abiertas que está atendiendo el bot": de las 117 sin asignar en producción, las 117 tienen la autorespuesta activa, así que describirlas como abandonadas era falso

## 5. Auditoría y regresiones (`/qa`)

- [x] 5.1 Verificar cada escenario de los cinco specs del cambio, uno por uno
- [x] 5.2 Regresión de `conversation-visibility`: el `agent` sigue sin poder soltar una conversación fuera del caso de devolverla al bot
- [x] 5.3 Regresión de `ai-handoff-assignment`: el asesor fijo configurado sigue teniendo precedencia sobre la continuidad y sobre la carga
- [x] 5.4 Regresión de `inbox-deal-creation`: ~~el índice único NO puede dispararse hoy en la creación manual porque `deal-form.tsx` no escribe `conversation_id`~~ — **premisa caduca**: el grupo 4bis hizo que el alta sí escriba `conversation_id`, así que el índice sí se dispara. Verificado: la creación manual sigue funcionando y la traducción del error aparece. Ver DEFECTO 3 del reporte de QA
- [x] 5.5 Verificar que la fila "Sin asignar" cuadra con el conteo real de conversaciones abiertas sin asesor en el VPS
- [x] 5.6 Verificar el acceso con un usuario de rol `agent` real: no ve la tabla y la RPC no le devuelve datos de otros
- [x] 5.7 Suite completa en verde y reporte con la salida de los comandos ejecutados

**Resultado de la auditoría (2026-09-21): NO DESPLEGABLE.** Tres defectos
bloqueantes, detallados en el reporte de QA:

1. **La migración 530 no arregla lo que dice arreglar.** Con la 530 aplicada, un
   `agent` sigue sin poder devolver el hilo al bot: ya no lo para el trigger, lo
   para la política de RLS `conversations_select` de la 520, que se aplica a la
   fila resultante. Escenarios 1 y 2 de `conversation-visibility` incumplidos.
2. **El tiempo de respuesta arranca envenenado.** Un mensaje de asesor sin
   `sender_id` no cierra el bloque de espera, así que la primera respuesta con
   autor se mide desde un entrante ya contestado. Medido: 34 días donde el asesor
   tardó 120 s. 35 conversaciones de producción afectadas y sin ventana de tiempo
   que las envejezca.
3. **Borrar un contacto con negocio vinculado falla por clave ajena**
   (`contacts` →CASCADE→ `conversations` →NO ACTION→ `deals`). Regresión
   introducida por el grupo 4bis. Ya despachada al backend como migración 533.

## 5bis. Correcciones de la re-auditoría final de QA (`/backend`)

Veredicto de QA: apto con reservas. Correcciones aplicadas el 2026-09-23:

- [x] 5bis.1 **Sacar la 530 del lote.** Con la 530 aplicada un `agent` seguía sin poder desasignar con su sesión (lo rechaza `conversations_select`, no el trigger), y el camino real escribe con service-role, donde el trigger de la 520 no corre. La 530 no habilitaba nada y solo relajaba la garantía de la 520. El archivo sale de `supabase/migrations/` (copia fuera del repo); 531-533 NO se renumeran. Stack local: función de la 520 restaurada y fila `530` quitada de `schema_migrations`. La regla de devolución al bot vive en el código de los endpoints (design.md, decisión 8)
- [x] 5bis.2 `changed_by` documentado al derecho en la 531 y en design.md: NULL = escrito con service-role, lo que incluye a todo `agent` que reasigna o devuelve al bot desde la bandeja; no distingue sistema de persona
- [x] 5bis.3 RPC de la 532: un saliente con `status = 'failed'` no cierra la espera ni genera muestra (6 en producción). Probado en el stack local con `authenticated` + JWT y `ROLLBACK`
- [x] 5bis.4 `POST /api/ai/autoreply/[id]` con `paused: false`: un `agent` solo puede desasignar si la IA estaba pausada (`esDevolucionAlBot`); si ya estaba activa, 403 con `code: "ai_already_active"`, traducido en la bandeja (`autoreply-errors.ts`, claves `Inbox.aiBanner.resumeNotYours` / `resumeAlreadyActive`)
- [x] 5bis.5 El negocio del traspaso toma el asesor que ya tenía el hilo en vez de nacer en "Sin asignar"; el dueño se relee al momento del traspaso, no se toma de la foto del inicio del dispatch

## 6. Despliegue (`/backend`)

- [ ] 6.1 `./scripts/backup.sh` y `./scripts/apply-migrations.sh --dry-run`, confirmando que aparecen como pendientes **exactamente 531, 532 y 533** (tres; el 530 queda vacío a propósito y NO debe aparecer)
- [ ] 6.2 Desplegar las tres migraciones juntas con el código del lote
- [ ] 6.3 Verificar en producción: una reactivación real registra su fila en el historial y el `sender_id` se está escribiendo en los salientes nuevos
- [ ] 6.4 Confirmar con el Director de TI antes de tocar producción
