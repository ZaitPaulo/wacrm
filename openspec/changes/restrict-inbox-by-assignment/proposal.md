## Why

Hoy cualquier miembro de la cuenta ve todas las conversaciones. La RLS de `conversations` (migración 017) solo pregunta `is_account_member(account_id)`, sin mirar el rol ni la asignación, así que el día que entre el primer asesor a LoraMotors va a abrir la bandeja y leer los chats de todos los demás — incluidos los de sus compañeros y los que todavía no atiende nadie.

En una compraventa de autos eso no es un detalle cosmético: las conversaciones son la cartera de cada asesor. Se necesita el corte antes de sumar gente a la cuenta, no después.

## What Changes

- Un miembro con rol `agent` solo ve las conversaciones donde `assigned_agent_id` es él. `owner`, `admin` y `viewer` siguen viendo todo.
- **Lo no asignado queda invisible para el asesor.** No hay bandeja de "sin asignar" ni reparto automático: el admin reparte a mano desde el desplegable del hilo. Es deliberado — un prospecto sin dueño es responsabilidad del admin, no de quien lo vea primero.
- La restricción baja también a los contactos y a los negocios: un contacto se ve si tiene una conversación visible, y un negocio se ve si su contacto se ve. Sin eso, ocultar el chat no serviría de nada: la ficha del contacto muestra el mismo hilo (`api/contacts/[id]/threads`) y la tarjeta del embudo muestra el nombre.
- **BREAKING** para el rol `agent`: un contacto sin conversación asignada no lo ve nadie salvo el admin. Como consecuencia, al asesor se le esconden "Nuevo contacto" y la importación — si no, crearía un contacto y lo perdería de vista al guardar.
- Un asesor puede pasarle su conversación a otro miembro, pero no puede dejarla sin asignar. Soltar una conversación al limbo es potestad del admin.
- El corte se hace en la base con RLS, no en la consulta de la bandeja. La lista de conversaciones ya se lee desde el cliente sin ningún filtro propio (`conversation-list.tsx:107`), así que la política es la única frontera que sirve.

## Capabilities

### New Capabilities

- `conversation-visibility`: quién puede ver cada conversación, contacto y negocio de la cuenta según su rol y la asignación del hilo; qué pasa con lo no asignado; y quién puede cambiar esa asignación.

### Modified Capabilities

Ninguna. `ai-reply-gating` y `flow-handoff-routing` corren con service-role (sin `auth.uid()`), así que la RLS nueva no los toca; sus requisitos no cambian.

## Impact

- **Migración nueva en rango 500+**: función `conversation_visible(account_id, assigned_agent_id)` `SECURITY DEFINER` —gemela de `is_account_member`—, reescritura de las políticas de `conversations`, `messages`, `contacts` y `deals` (SELECT y también UPDATE/DELETE: hoy piden solo `is_account_member(..., 'agent')`, así que un asesor podría modificar por API lo que no ve), trigger que impide a un `agent` poner `assigned_agent_id` en NULL, e índice `conversations(account_id, assigned_agent_id)` para el `EXISTS` que evalúa cada fila de `contacts`.
- Tablas colgadas de `contacts` a revisar una por una: `contact_tags`, `contact_custom_values`, `contact_notes`, `contact_documents`, `contact_channels`, `contact_links`, `flow_runs`, `notifications`.
- `src/lib/auth/roles.ts` + `src/hooks/use-can.ts`: predicado `canViewAllConversations`, mismo patrón que `canViewMargins`.
- `src/app/(dashboard)/inbox/page.tsx`: los handlers de realtime insertan la conversación directo desde el payload del evento, sin volver a la base. `use-realtime.ts` se suscribe a las tablas enteras sin filtro. Hace falta una guarda en el cliente además de la RLS.
- `src/components/inbox/message-thread.tsx`: el desplegable de asignación pierde "Sin asignar" para el rol `agent`.
- `src/app/(dashboard)/contacts/page.tsx`: se esconden alta e importación para el rol `agent`.
- **El tablero se recorta solo.** `lib/dashboard/queries.ts` cuenta con el cliente del propio usuario, así que un asesor pasa a ver sus cifras y no las de la empresa. Se acepta tal cual: mantenerlas globales exigiría un RPC `SECURITY DEFINER` aparte, y las cifras propias son más útiles para quien atiende.
- **La API pública v1 no cambia**: usa service-role y filtra a mano por `account_id` (`api/v1/conversations/route.ts:32`). Quien tenga una API key sigue viendo toda la cuenta. Es coherente —las llaves las crea el admin— pero queda dicho.
- **Despliegue**: todas las conversaciones de producción están hoy sin asignar. Si esto entra sin repartir el histórico, el primer asesor abre la bandeja y la ve vacía. Y para verificarlo hace falta crear un miembro con rol `agent` en el VPS: la cuenta tiene un solo usuario.
