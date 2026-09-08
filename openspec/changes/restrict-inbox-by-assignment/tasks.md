## 1. Migración: funciones e índices

- [x] 1.1 Crear `supabase/migrations/520_restrict_inbox_by_assignment.sql` con el encabezado de comentario al estilo del repo (qué hace, qué no toca, idempotente)
- [x] 1.2 Agregar `conversation_visible(p_account_id uuid, p_assigned_agent_id uuid)` — `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public`, con `ALTER FUNCTION … OWNER TO postgres` y `GRANT EXECUTE … TO authenticated, service_role`, calcada de `is_account_member`
- [x] 1.3 Agregar `contact_visible(p_account_id uuid, p_contact_id uuid)` con la misma forma, incluyendo el `EXISTS` sobre `conversations` que corre sin RLS por ser `SECURITY DEFINER`
- [x] 1.4 Crear los índices `conversations(contact_id, assigned_agent_id)` y `conversations(account_id, assigned_agent_id)` con `IF NOT EXISTS`

## 2. Migración: políticas RLS

- [x] 2.1 Reescribir `conversations_select`, `conversations_update` y `conversations_delete` con `conversation_visible(account_id, assigned_agent_id)` en lugar de `is_account_member(...)`; dejar `conversations_insert` como está
- [x] 2.2 Reescribir `messages_select` y `messages_modify` para que el `EXISTS` sobre `conversations` use `conversation_visible`
- [x] 2.3 Reescribir `contacts_select`, `contacts_update` y `contacts_delete` con `contact_visible(account_id, id)`; dejar `contacts_insert` como está
- [x] 2.4 Reescribir `deals_select`, `deals_update` y `deals_delete` con `contact_visible(account_id, contact_id)`
- [x] 2.5 Reescribir las políticas de las tablas que cuelgan de `contacts` para que su `EXISTS` use `contact_visible`: `contact_tags`, `contact_custom_values`, `contact_notes`, `contact_documents`, `contact_channels`, `contact_links`, `flow_runs`
- [x] 2.6 Verificar que `notifications` no necesita cambios (ya acotada por `auth.uid() = user_id`) y dejarlo dicho en un comentario de la migración

## 3. Migración: trigger de asignación

- [x] 3.1 Agregar la función de trigger que impide a un `agent` poner `assigned_agent_id` en NULL, con la salida temprana por `auth.uid() IS NULL` para no romper service-role
- [x] 3.2 Colgar el trigger `BEFORE UPDATE OF assigned_agent_id ON conversations FOR EACH ROW`, con `DROP TRIGGER IF EXISTS` antes
- [x] 3.3 Aplicar la migración contra la base de desarrollo y confirmar que corre dos veces seguidas sin error

## 4. Predicado de rol en TypeScript

- [x] 4.1 Agregar `canViewAllConversations(role)` a `src/lib/auth/roles.ts`, con el comentario de que es cosmético y la frontera real es la RLS (mismo tono que `canViewMargins`)
- [x] 4.2 Agregar la `CanAction` `"view-all-conversations"` a `src/hooks/use-can.ts` con su rama en el switch
- [x] 4.3 Agregar las pruebas del predicado en `src/lib/auth/roles.test.ts` — los cuatro roles, uno por uno

## 5. Bandeja: guarda de tiempo real

- [x] 5.1 En `src/app/(dashboard)/inbox/page.tsx`, resolver el id de usuario y si el rol es restringido (vía `useAuth` / `useCan`) para tenerlos disponibles en los handlers
- [x] 5.2 Descartar en `handleConversationEvent` los eventos de conversaciones cuyo `assigned_agent_id` no sea el usuario, dejando pasar el `UPDATE` que **asigna** una conversación al usuario (ese es el camino legítimo por el que aparece un hilo nuevo)
- [x] 5.3 Descartar en `handleMessageEvent` los mensajes de conversaciones que no estén en la lista visible y que el `hydrate` no pueda resolver
- [ ] 5.4 Comprobar que un `UPDATE` que le **quita** la asignación al usuario saca la conversación de la lista en vez de dejarla pegada

## 6. Interfaz: acciones que la base va a negar

- [x] 6.1 En `src/components/inbox/message-thread.tsx`, esconder la opción "Sin asignar" del desplegable de asignación cuando el rol no puede ver todo
- [x] 6.2 En `src/app/(dashboard)/contacts/page.tsx`, esconder el alta de contacto y la importación para el rol `agent`
- [x] 6.3 Revisar que ninguna otra vista ofrezca crear contactos al asesor (formulario de negocio en `deal-form.tsx`, cualquier atajo desde la bandeja)

## 7. Verificación

- [x] 7.1 Correr `npm run lint` y `npx vitest run` y dejarlos en verde
- [x] 7.2 ~~Crear en el VPS un miembro con rol `agent`~~ — innecesario: la cuenta ya tenía 3 asesores y 3 admins. La prueba se hizo con uno de ellos, en una transacción revertida
- [ ] 7.3 Con la sesión del `agent`: la bandeja muestra solo lo asignado, los contactos solo los suyos, el embudo solo sus tarjetas y el contador de no leídos cuadra
- [x] 7.4 Con la sesión del owner: todo sigue igual que antes, incluidas las conversaciones sin asignar
- [x] 7.5 Por `psql` con sesión de `agent`: `SELECT` por id de una conversación ajena devuelve cero filas; `UPDATE` de una conversación ajena afecta cero filas; `UPDATE … SET assigned_agent_id = NULL` de una propia falla con el error del trigger; reasignar a otro miembro sí funciona
- [ ] 7.6 Comprobar si el Realtime del VPS aplica RLS en `postgres_changes` y anotar el resultado en `design.md`
- [ ] 7.7 Confirmar que un mensaje entrante por el webhook sigue creando conversación y contacto con normalidad (service-role no afectado)

## 8. Cierre

- [ ] 8.1 Anotar en el change el criterio con el que se repartirá el histórico de conversaciones antes de sumar asesores reales
- [ ] 8.2 Documentar los cambios de código con la skill `inline-code-documenter` una vez que el usuario confirme que funciona
