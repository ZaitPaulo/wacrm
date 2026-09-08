## Context

La multi-tenencia del CRM se resolvió en la migración 017 con una sola función: `is_account_member(account_id, min_role)`. Toda política RLS del proyecto la llama, y para los datos operativos (`conversations`, `contacts`, `deals`, `messages`) el `SELECT` pide el mínimo — `viewer` —, o sea: **cualquier miembro ve todo lo de su cuenta**. El rol solo diferencia escritura.

La bandeja se apoya enteramente en eso. `conversation-list.tsx:107` hace un `select` pelado sobre `conversations` desde el cliente, sin filtro propio, y `use-total-unread.ts` lo mismo. No hay capa de servidor donde interceptar: el corte tiene que darse en la política o no se da.

La asignación ya existe (`conversations.assigned_agent_id`, migración 001) y hoy la escriben tres caminos: el desplegable del encabezado del hilo (`message-thread.tsx:863`), el paso `assign_conversation` del motor de automatizaciones (`engine.ts:484`) y el handoff de la IA con `assignToMe` (`api/ai/autoreply/[conversationId]/route.ts:68`). Los dos últimos corren con service-role.

Restricción de contexto: es un fork de wacrm que se mantiene a mano. Nada de arquitectura nueva — migraciones secuenciales idempotentes, RLS con funciones `SECURITY DEFINER` al estilo de `is_account_member`, y predicados de rol en `lib/auth/roles.ts`.

## Goals / Non-Goals

**Goals:**

- Que un miembro con rol `agent` no pueda leer, por ningún camino con su sesión, una conversación que no tiene asignada — ni su contacto, ni sus mensajes, ni su negocio.
- Que la regla viva en un solo lugar de la base, para que agregar una consulta nueva en el cliente no abra un agujero por olvido.
- Que `owner`, `admin` y `viewer` no noten ningún cambio.
- Que los caminos con service-role (webhooks, motores, IA, API v1) sigan viendo la cuenta completa.

**Non-Goals:**

- Reparto automático de prospectos. El `round_robin` del paso `assign_conversation` es de mentiras hoy (`.limit(1)` sin orden, siempre el mismo miembro); arreglarlo es otro change.
- Bandeja compartida de "sin asignar" con botón de tomar.
- Mantener globales las cifras del tablero para el asesor.
- Restringir la API pública v1, que es de cuenta por diseño.
- Asignación a nivel de contacto. Un contacto puede tener hasta tres conversaciones (índice único `(account_id, contact_id, channel)`, migración 513) y por lo tanto quedar repartido entre dos asesores según el canal. Se acepta.

## Decisions

### Una función por tabla raíz, no una condición repetida

Se agregan dos funciones `SECURITY DEFINER STABLE`, calcadas de `is_account_member` (mismo `SET search_path = public`, mismo `GRANT` a `authenticated, service_role`):

```sql
conversation_visible(p_account_id uuid, p_assigned_agent_id uuid) → boolean
  EXISTS (SELECT 1 FROM profiles p
          WHERE p.user_id = auth.uid()
            AND p.account_id = p_account_id
            AND (p.account_role <> 'agent' OR p_assigned_agent_id = auth.uid()))

contact_visible(p_account_id uuid, p_contact_id uuid) → boolean
  EXISTS (SELECT 1 FROM profiles p
          WHERE p.user_id = auth.uid()
            AND p.account_id = p_account_id
            AND (p.account_role <> 'agent'
                 OR EXISTS (SELECT 1 FROM conversations c
                            WHERE c.contact_id = p_contact_id
                              AND c.assigned_agent_id = auth.uid())))
```

Ambas incluyen la pertenencia a la cuenta, así que **reemplazan** a `is_account_member` en la política en vez de sumarse: una llamada por fila, no dos.

`account_role` en NULL da falso (la comparación con NULL no es verdadera), igual que en `is_account_member`, donde el `CASE` sin rama devuelve NULL. Un perfil sin rol no ve nada: mismo criterio que ya rige.

`SECURITY DEFINER` no es adorno. La subconsulta de `contact_visible` sobre `conversations` corre sin RLS, que es lo que evita que la política de `contacts` dispare la de `conversations` en cadena.

*Alternativa descartada*: una sola función `es_asesor_restringido(account_id)` combinada con la condición de asignación en cada política. Deja la regla escrita en cuatro lugares y el día que entre un rol nuevo hay que acordarse de los cuatro.

### Los hijos siguen colgando del padre, con la función nueva

`messages`, `contact_tags`, `contact_custom_values`, `contact_documents`, `contact_channels`, `contact_links` y `flow_runs` ya usan el patrón `EXISTS (SELECT 1 FROM <padre> ... is_account_member(...))`. Solo se cambia la llamada por la función nueva; la forma no se toca.

`notifications` no se toca: ya está acotada por `auth.uid() = user_id` (migración 027).

### `deals` cuelga del contacto

`deals_select` pasa a `contact_visible(account_id, contact_id)`. Un negocio sin contacto queda invisible para el `agent` — es el mismo criterio que un contacto sin conversación asignada, y evita la tarjeta con el nombre en blanco que aparecería si el negocio se viera pero su contacto no (`pipelines/page.tsx:104` trae `contact:contacts(*)` embebido).

### Escritura acotada a lo visible

Las políticas de `UPDATE`/`DELETE` de estas tablas hoy piden solo `is_account_member(..., 'agent')`. Se les agrega la condición de visibilidad, porque si no un asesor puede modificar por API con su sesión exactamente lo que la bandeja le esconde. `INSERT` no cambia: crear no es ver.

### El trigger, no un privilegio de columna

Para "el asesor puede pasar la conversación pero no soltarla" hace falta distinguir *qué columna* cambia y *quién* la cambia. La RLS no filtra por columna, y el privilegio de columna —el truco que usa `notifications` con `REVOKE UPDATE … GRANT UPDATE(read_at)`— es por rol de base (`authenticated`), no por `account_role`. Queda un trigger `BEFORE UPDATE`:

```
si auth.uid() IS NULL           → pasar (service-role: webhooks, motores, IA)
si el rol del que llama ≠ agent → pasar
si NEW.assigned_agent_id IS NULL y OLD no lo era → RAISE EXCEPTION
```

El orden importa: la guarda de `auth.uid() IS NULL` va primera para que el handoff de la IA y el paso `assign_conversation` sigan pudiendo asignar y desasignar.

### Dos índices

`contact_visible` corre un `EXISTS` por cada fila de `contacts` que se evalúe: índice `(contact_id, assigned_agent_id)`. Y la bandeja del asesor pasa a barrer `conversations` filtrando por asignación: índice `(account_id, assigned_agent_id)`. Ninguno existe hoy — `idx_conversations_contact_id` es solo por contacto.

### La guarda del cliente en tiempo real es obligatoria, no defensa en profundidad

`use-realtime.ts:50-62` se suscribe a `messages` y `conversations` enteras, sin `filter`. Y `inbox/page.tsx:265` mete la conversación en la lista **directamente desde el payload del evento**, sin volver a la base:

```
INSERT de una conversación ajena
        └─▶ setConversations(prev => [conv, ...prev])   ← nunca pasa por RLS
```

Si el Realtime del VPS autoalojado no aplica RLS en `postgres_changes` —hay que comprobarlo, no darlo por hecho—, el asesor vería aparecer chats ajenos aunque la política esté perfecta. La guarda va en los dos handlers (`handleConversationEvent` y `handleMessageEvent`): si soy `agent` y el evento no es de una conversación mía, se ignora.

Ojo con el caso legítimo: cuando el admin me asigna una conversación que yo no veía, llega un `UPDATE` cuyo `assigned_agent_id` sí soy yo. Ese evento debe pasar y disparar el `hydrateConversation` de siempre.

### La interfaz solo esconde lo que la base ya niega

Predicado nuevo en `lib/auth/roles.ts` —`canViewAllConversations`— y su `CanAction` en `use-can.ts`, mismo patrón que `canViewMargins`, con el mismo comentario de que es cosmético y la frontera real es la RLS. De ahí cuelgan: la opción "Sin asignar" del desplegable del hilo, y el alta e importación de contactos.

## Risks / Trade-offs

- **El día del despliegue las bandejas quedan vacías** → hoy todas las conversaciones de producción tienen `assigned_agent_id` en NULL. Repartir el histórico **antes** de aplicar la migración, o aplicarla cuando todavía no haya ningún miembro con rol `agent` (que es el caso hoy: la cuenta tiene un solo usuario, el owner).
- **Un prospecto nuevo entra sin dueño y no lo ve nadie salvo el admin** → es la decisión tomada, no un descuido. El riesgo real es de operación, no de código: si el admin no reparte, el lead se enfría. Queda anotado como el gancho del change que arregle el reparto automático.
- **El asesor pierde de vista lo que crea** → un contacto sin conversación no le es visible. Por eso se le esconden el alta y la importación. La política de `INSERT` no cambia, así que si alguien llama a la API igual lo crea; simplemente no lo verá después.
- **Costo por fila del `EXISTS` de `contacts`** → con los índices nuevos es una lectura de índice por fila. En una cuenta con miles de contactos y un listado paginado no debería notarse, pero conviene mirar el `EXPLAIN` del listado de contactos con sesión de `agent` antes de dar por cerrado.
- **El tablero del asesor deja de cuadrar con el del admin** → aceptado. Si alguien lo reporta como bug, la respuesta es un RPC `SECURITY DEFINER` aparte, no aflojar la RLS.
- **La API v1 sigue viendo todo** → las llaves las crea el admin (`api_keys`, migración 026). Si mañana se le da una llave a un asesor, este boquete se abre; hay que decidirlo entonces, no ahora.
- **Verificar cuesta** → no hay banco de pruebas de RLS en el repo. La comprobación es manual contra el VPS, con un miembro `agent` creado a propósito, y por `psql` con `SET request.jwt.claims` para las rutas que la interfaz no ofrece.

## Migration Plan

1. Aplicar `520_restrict_inbox_by_assignment.sql` en local contra la base de desarrollo (que apunta al VPS).
2. Crear en el VPS un usuario de prueba con rol `agent` (invitación desde Ajustes → Miembros).
3. Verificar con las dos sesiones abiertas: el `agent` ve solo lo suyo; el owner ve todo.
4. Verificar por `psql` lo que la interfaz no ofrece: `SELECT` directo por id de una conversación ajena, `UPDATE` de una conversación ajena, `UPDATE … SET assigned_agent_id = NULL` con sesión de asesor.
5. Comprobar si el Realtime autoalojado aplica RLS en `postgres_changes`; si no, la guarda del cliente queda como única protección de ese camino y hay que dejarlo escrito.
6. Repartir el histórico de conversaciones antes de sumar asesores reales.

**Rollback**: la migración es idempotente y las políticas anteriores están íntegras en `017_account_sharing.sql`; volver atrás es recrearlas con `is_account_member` y borrar trigger, funciones e índices. Ningún dato se transforma, así que no hay pérdida posible.

## Open Questions

- ¿El Realtime del VPS aplica RLS en `postgres_changes`? Se resuelve probándolo en el paso 5, no antes.
- ¿Qué criterio se usa para repartir el histórico el día que entren los asesores — todo al owner, por etiqueta, por vehículo de interés? Es decisión de operación y no bloquea la implementación.
