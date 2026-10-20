## Context

**Ficha actual.** La ficha del contacto es un `Sheet` lateral (`src/components/contacts/contact-detail-view.tsx`, unas 790 líneas) que abre la lista de Contactos (`src/app/(dashboard)/contacts/page.tsx:862`). Tiene siete pestañas y no tiene URL propia. La bandeja tiene su propio panel de contacto (`src/components/inbox/contact-sidebar.tsx`), que es otro componente y se queda.

**Visibilidad (migración 520).** Dos funciones `SECURITY DEFINER` reparten la visibilidad del rol `agent`:
- `conversation_visible(account_id, assigned_agent_id)` gobierna `conversations`, `messages` y `appointments`.
- `contact_visible(account_id, contact_id)` gobierna `contacts` y todo lo que cuelga del contacto (`contact_tags`, `contact_custom_values`, `contact_notes`, `documents`, `contact_channels`, `contact_links`), además de `deals` y el `INSERT` de `appointments`.

Varias lecturas dependen de esas políticas para recortar los datos del asesor sin filtrar en la consulta: la lista de la bandeja (`conversation-list.tsx`), el embudo, la Agenda y `src/lib/dashboard/queries.ts`. La spec `conversation-visibility` dice explícitamente que "el listado se arma desde el cliente sin filtro propio".

**Fuentes de historia que ya existen:**

| Fuente | Tabla | Lo que aporta |
|---|---|---|
| Conversaciones | `conversations`, `messages` | hilos por canal, primer y último mensaje, conteo |
| Asignaciones | `conversation_assignments` (531) | traspasos bot → asesor → asesor |
| Citas | `appointments`, `appointment_events`, `appointment_vehicles` (548) | agendó, movió, confirmó, asistió, no asistió |
| Negocios | `deals` | creación, etapa actual, valor, estado |
| Consultas | `vehicle_inquiries` (508) | preguntó por tal vehículo |
| Ventas | `inventory_vehicles.sold_to_contact_id/sold_at/sold_price` (508) | le vendimos |
| Consignación | `inventory_vehicles.owner_contact_id` (525) | nos dejó el carro en venta |
| Documentos | `documents` (502) | archivos de persona, compra y venta |
| Notas | `contact_notes` | notas internas |
| Origen | `messages` con referral (526) | llegó por un anuncio |

**Lo que falta:**
- No hay historial de cambios de etapa de los negocios. `pipeline_stage_transitions` (528) son las *reglas* de qué etapa puede seguir a cuál.
- No hay registro de llamadas.
- No se guarda a quién se le compró un vehículo: `vehicle_acquisitions` (508) guarda solo el costo y la fecha, y es legible solo por admin.

**Producción hoy.** 513 negocios en Prospecto y 0 vehículos vendidos, porque nadie registra cierres. Al principio la hoja de vida va a mostrar sobre todo conversaciones, asignaciones y citas.

**Next 16.2.12.** Las rutas dinámicas cambiaron respecto de versiones anteriores. Antes de escribir `contacts/[id]/page.tsx` hay que leer `node_modules/next/dist/docs/01-app/`.

## Goals / Non-Goals

**Goals:**
- Una ficha por contacto a pantalla completa, con URL propia y enlazable desde cualquier módulo.
- Que cualquier miembro de la cuenta vea la historia completa de cualquier contacto, sin huecos por asignación.
- Que nada cambie en lo que el asesor *atiende*: bandeja, embudo, Agenda, indicadores y toda escritura siguen igual.
- Registrar llamadas e interacciones, y a quién se le compró un vehículo.
- Que el costo de adquisición siga siendo inaccesible para quien no es admin, por cualquier vía.

**Non-Goals:**
- Captar llamadas automáticamente (WhatsApp Calling API, telefonía). El registro es manual.
- Que el asesor responda, reasigne o edite los datos de un contacto que no tiene asignado.
- El alta e importación de contactos por el rol `agent` (sigue oculta, ver `conversation-visibility`).
- Reconstruir los cambios de etapa anteriores a esta entrega, o completar el vendedor de compras viejas.
- Exportar la hoja de vida a PDF.
- Cambiar el panel de contacto de la bandeja más allá del enlace a la ficha.

## Decisions

### D1. Separar "ver" de "atender" sin tocar `conversation_visible` ni `contact_visible`

Las políticas `SELECT` de `contacts`, `contact_tags`, `contact_custom_values`, `contact_notes`, `documents`, `contact_channels` y `contact_links` pasan a usar `is_account_member(account_id)`. `contact_notes_insert` pasa a `is_account_member(account_id, 'agent')`. Todo lo demás queda igual:
- Las dos funciones de la 520.
- La RLS de `conversations`, `messages`, `deals`, `appointments` y `vehicle_acquisitions`.
- Las políticas de `UPDATE` y `DELETE` de los contactos.

Los hilos, negocios y citas de otros asesores se leen **solo** a través de las funciones de la hoja de vida (D2 y D3), que son `SECURITY DEFINER` y verifican la pertenencia a la cuenta.

*Alternativa descartada:* que `conversation_visible` y `contact_visible` devuelvan verdadero para cualquier miembro y filtrar por asignación en cada consulta. Por la forma en que está hecho el código, eso abre en silencio la bandeja, el embudo, la Agenda, los indicadores y los eventos en vivo del asesor, y además la *escritura*: `messages_modify`, `conversations_update` y `appointments_update` usan las mismas funciones. Habría que auditar y filtrar cada lectura, y si se olvida una, un asesor ve o modifica lo que no le toca. Con D1 el cambio queda acotado a la ficha.

*Consecuencia aceptada:* `deals_select` sigue usando `contact_visible`. El embudo del asesor muestra solo su cartera, aunque en la ficha vea los negocios de otros asesores con ese cliente. Es justo la separación que se pidió.

### D2. Hoja de vida calculada al consultar, en una función SQL

`get_contact_timeline(p_contact_id uuid, p_kinds text[] DEFAULT NULL, p_before timestamptz DEFAULT NULL, p_limit int DEFAULT 50)` es una función `SECURITY DEFINER` y `STABLE`:
1. Resuelve la cuenta del contacto y exige `is_account_member(account_id)`. Si no se cumple, devuelve cero filas, como la RLS.
2. Arma un `UNION ALL` de todas las fuentes. Cada fila tiene la misma forma: `occurred_at`, `kind`, `source_id`, `actor_user_id`, `title_data jsonb`, `link jsonb`.
3. Ordena por `occurred_at DESC, source_id`, aplica `p_before` (cursor por fecha más id para desempatar) y `p_limit`.

El texto visible se arma en el cliente con `next-intl`: la función devuelve datos, no frases, para mantener el español del producto y la interfaz en un solo lugar.

*Alternativa descartada:* una tabla `contact_events` llenada por triggers. Duplica datos, hay que mantenerla en sincronía con cada fuente (incluidas ediciones y borrados) y no muestra la historia anterior. La consulta por contacto es chica (decenas a cientos de filas) y todas las fuentes tienen índice por `contact_id`, o lo reciben en esta entrega.

*Excepción:* `deal_stage_events` (D5) sí es una tabla nueva, porque ese dato hoy no se guarda en ninguna parte.

**Tipos de evento (`kind`):** `first_contact`, `conversation`, `assignment`, `appointment`, `appointment_event`, `deal_created`, `deal_stage`, `deal_closed`, `inquiry`, `sale`, `consignment`, `acquisition`, `document`, `note`, `interaction`.

**Conversaciones resumidas.** Una fila por hilo con canal, primer y último mensaje, cantidad de mensajes, si hubo traspaso y quién atiende. No una fila por mensaje.

**Costo de adquisición.** El evento `acquisition` incluye el vehículo, la fecha y el tipo (compra o retoma). El costo se agrega a `title_data` solo si `is_account_member(account_id, 'admin')`. Lo controla la función, no la interfaz.

**Resumen.** `get_contact_summary(p_contact_id)` es una función hermana con la misma verificación. Devuelve cliente desde, asesor actual por canal, número de citas (y asistidas), vehículos comprados al negocio, vehículos vendidos al negocio, consignaciones y negocios abiertos.

### D3. Hilos en solo lectura desde la ficha

`get_contact_conversation_messages(p_conversation_id uuid, p_before timestamptz, p_limit int)` es `SECURITY DEFINER` y verifica `is_account_member` sobre la cuenta de la conversación. La ficha muestra el hilo con los mismos `message-bubble` y `message-media` de la bandeja, sin compositor ni acciones, con el aviso "Atiende: {asesor}" y, si quien mira es el asignado, un botón "Abrir en la bandeja".

Los adjuntos se cargan por el proxy de medios (`isProxiedMediaUrl` en `src/hooks/use-media-blob-url.ts`). Hay que verificar qué autorización aplica ese endpoint. Si exige ver la conversación por RLS, se amplía a pertenencia a la cuenta, solo para lectura.

### D4. Ficha en `/contacts/[id]` y retiro del `Sheet` de Contactos

`src/app/(dashboard)/contacts/[id]/page.tsx` sigue el patrón de las páginas del dashboard. Distribución:
- **Escritorio:** encabezado (nombre, teléfono, canales, asesor, etiquetas, acciones), columna izquierda de resumen editable (datos, campos personalizados, etiquetas) y columna principal con pestañas `Hoja de vida | Documentos`.
- **Celular:** las columnas se apilan.

Las partes reutilizables de `contact-detail-view.tsx` (formulario de datos, notas, campos, negocios, documentos) se extraen a componentes en `src/components/contacts/`, y el `Sheet` se elimina. La lista navega con `router.push` o `<Link>`.

Edición en la ficha: los campos son editables si quien mira tiene permiso según la RLS sin cambios (`contacts_update` usa `contact_visible`). Si no, se muestran en solo lectura. Es la regla de "la interfaz no ofrece lo que la base va a negar".

**Enlaces entrantes:**
- `contact-sidebar.tsx` de la bandeja: "Ver hoja de vida".
- El detalle de cita en la Agenda (`appointment-sheet.tsx`).
- Comprador, propietario y vendedor en el Inventario.
- Notificaciones con `contact_id`.

### D5. Historial de etapas: `deal_stage_events`

Tabla `(id, account_id, deal_id, contact_id, from_stage_id, to_stage_id, from_status, to_status, actor_user_id, created_at)`, llenada por un trigger `AFTER INSERT OR UPDATE OF stage_id, status ON deals`. `actor_user_id` es `auth.uid()`; queda en NULL si el cambio lo hizo una automatización con service-role. Política `SELECT` igual a `deals_select`; la hoja de vida la lee por D2. Lleva `GRANT SELECT` explícito a `authenticated`. No permite `INSERT` ni `UPDATE` desde el cliente: solo escribe el trigger (`SECURITY DEFINER`).

### D6. Interacciones: `contact_interactions`

Tabla `(id, account_id, contact_id, user_id, kind, outcome, duration_seconds, occurred_at, note, created_at, updated_at)`:
- `kind`: `call_outbound`, `call_inbound`, `walk_in` u `other`.
- `outcome`: `answered`, `no_answer`, `voicemail`, `wrong_number` o `NULL` (solo aplica a llamadas).
- `duration_seconds`: entero ≥ 0, opcional.
- `occurred_at`: por defecto ahora; se puede poner una fecha pasada para registrar después.

RLS:
- `SELECT` para cualquier miembro.
- `INSERT` con `is_account_member(account_id, 'agent')` y `user_id = auth.uid()`.
- `UPDATE` y `DELETE` para el autor o para admin.

`GRANT SELECT, INSERT, UPDATE, DELETE` explícito a `authenticated` (ver la memoria de GRANT en tablas nuevas). Se escribe por `src/app/api/contacts/[id]/interactions`, siguiendo el patrón de las rutas de API existentes, sin Server Actions.

*Alternativa descartada:* reutilizar `contact_notes` con un tipo. Las notas son texto libre. Una llamada tiene campos con los que se va a querer contar ("llamadas sin contestar esta semana"), y mezclarlas complicaría las dos cosas.

### D7. Vendedor y tipo de adquisición en `inventory_vehicles`

Columnas nuevas en `inventory_vehicles`:
- `seller_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL`.
- `acquisition_kind text CHECK (acquisition_kind IN ('purchase','trade_in'))`, anulable.

Se editan en el formulario del vehículo con el mismo selector de contactos que el propietario (`vehicle-owner`: búsqueda sin tildes, nombre más teléfono). Son legibles y editables con los permisos del inventario (`agent` o superior). El costo sigue en `vehicle_acquisitions`, solo para admin.

*Alternativa descartada:* agregar el vendedor en `vehicle_acquisitions`. Esa tabla es solo de admin, así que el asesor que recibe una retoma no podría registrar a quién se le recibió, y la hoja de vida tendría que leer una tabla reservada para mostrar un dato que no lo es. Lo reservado es el costo, no la contraparte.

El vendedor, el propietario y el comprador pueden ser el mismo contacto en vehículos distintos (por ejemplo, retoma y venta en la misma operación). No se valida ninguna relación entre ellos.

### D8. Registrar venta y compra desde la ficha

El cierre de venta vive hoy dentro de `src/app/(dashboard)/inventory/page.tsx`. Se extrae a un componente (`src/components/inventory/sell-vehicle-dialog.tsx`) que reciben el Inventario y la ficha:
- **Registrar venta:** desde la ficha abre el diálogo con el comprador fijo y un selector de vehículos en estado `available` o `reserved`. Escribe por la misma ruta `PATCH /api/inventory/[id]`, que conserva todas sus validaciones (`vehicle-sales-recording`).
- **Registrar compra:** navega a `/inventory` con el alta de vehículo abierta y el vendedor precargado (parámetro de búsqueda). Esto evita duplicar el formulario del vehículo.

## Risks / Trade-offs

- **[Ampliar la lectura de contactos cambia listados del asesor que hoy dependen de la RLS]** → El cambio se limita a las siete tablas de D1. Se revisa cada lectura de `contacts` y de sus tablas hijas en `src/`: la lista de Contactos (deseado), `contact-picker` (deseado), los selectores del Inventario (deseado), las automatizaciones (service-role, sin cambio) y cualquier otra que aparezca. Hay pruebas por rol: con un asesor, la bandeja, el embudo, la Agenda y los indicadores devuelven exactamente lo mismo antes y después.
- **[Funciones `SECURITY DEFINER` saltan la RLS: un error en la verificación expone otra cuenta]** → La verificación de cuenta va en la primera sentencia y hay una prueba SQL que la cubre con un usuario de otra cuenta. `SET search_path = public`, `OWNER postgres` y `GRANT EXECUTE` solo a `authenticated`, igual que las funciones de la 520.
- **[El costo de adquisición podría filtrarse por la hoja de vida]** → Lo resuelve la función según el rol, y hay una prueba con `agent` que verifica que `title_data` no tiene costo.
- **[Rendimiento del `UNION ALL` en contactos con mucha historia]** → Índices por `contact_id` (y por `(contact_id, created_at)` donde falten) en todas las fuentes, límite por página y conversaciones agregadas por hilo. Se mide con `EXPLAIN ANALYZE` sobre el contacto con más mensajes del VPS antes del despliegue.
- **[Nadie registra llamadas, ventas ni compras, y la hoja de vida sale pobre]** → No es técnico. Se le avisa a los dueños al entregar: la hoja de vida muestra lo que el equipo registra. Los botones quedan en la ficha, donde el asesor ya está.
- **[El proxy de medios podría negar los adjuntos de hilos ajenos]** → Se verifica en la tarea de D3 antes de dar la fase por terminada.
- **[Retirar el `Sheet` rompe flujos que lo abrían]** → Solo lo usa la lista de Contactos, según la búsqueda de `ContactDetailView`. Se confirma con una búsqueda antes de borrarlo.

## Migration Plan

1. Migraciones, verificando antes que nadie más tomó estos números:
   - `553_contact_visibility_business.sql` (D1 y `get_contact_assignees`).
   - `554_contact_history_tables.sql` (D5, D6, D7 e índices: todas las tablas y columnas nuevas).
   - `555_contact_timeline_functions.sql` (D2 y D3: las tres funciones de la hoja de vida).
   - *Cambio respecto del plan original:* las tablas van todas en la 554 y las funciones en la 555, para escribir `get_contact_timeline` una sola vez con todas sus fuentes, en vez de crearla en una migración y reemplazarla en la siguiente. Las tres se despliegan juntas.
2. En el VPS, confirmar que está en la 552 y aplicar 553 a 555 en orden. No hay backfill: el historial de etapas y el vendedor arrancan vacíos.
3. Desplegar el front: un solo despliegue cuando el usuario lo indique, desde `develop` → `main`.
4. **Reversión:**
   - 553 se revierte reponiendo las políticas de la 520, cuyo texto queda copiado en el `down` comentado de la migración.
   - 554 y 555 son aditivas: las funciones se pueden borrar y las tablas y columnas se pueden quedar sin uso.
   - El front se revierte con el commit anterior.
5. Las fases se pueden entregar por separado en el orden 1 → 2 → 3 → 4. La 3 necesita la 2, porque la ficha completa de un contacto ajeno no tiene sentido si el asesor no puede abrirlo.

## Open Questions

- Si los dueños quieren que el asesor vea el **precio de venta** en la hoja de vida. Hoy ya lo puede leer (`vehicle-sales-recording`), así que se muestra salvo que digan otra cosa.
- Si una retoma se vincula con la venta que la originó ("recibimos el Spark como parte de pago del CX-30"). Queda fuera; con `seller_contact_id` y `sold_to_contact_id` en el mismo contacto y la misma fecha se ve en la línea de tiempo.
- Si el rol `viewer` registra interacciones. Por ahora no: se mantiene la regla de que `viewer` no escribe.

## Notas de implementación

**1.1 — Rutas dinámicas en Next 16.2.** Sin diferencias con lo supuesto: `params` llega como `Promise`. En páginas cliente se usa `useParams()` (patrón de `broadcasts/[id]` y `flows/[id]`), y en rutas de API `{ params }: { params: Promise<{ id: string }> }` con `await params` (patrón de `api/ai/knowledge/[id]`).

**1.2 — Números de migración.** Ni `develop`, ni `origin/main`, ni `upstream/main` tienen 553–555. El VPS no se pudo leer por ssh desde esta sesión; según el despliegue del 2026-10-17 está en la 552. Se revalida antes de aplicar.

**1.3 — Lecturas que cambian de alcance para el `agent` con la 553.**

| Lectura | Cambio | ¿Deseado? |
|---|---|---|
| Lista de Contactos (`contacts/page.tsx`) | ve todos los contactos | Sí |
| Documentos (`documents/page.tsx`) | ve todos los documentos y su buscador de contactos | Sí (los documentos cuelgan del contacto) |
| `identity-links` (vínculos de identidad) | ve todos | Sí |
| Selector de propietario del Inventario y `lib/inventory/owner.ts` | ya era `admin`+ (ruta solo admin) | Sin cambio |
| Panel e informes (`lib/dashboard/queries.ts`), Difusiones | rutas solo admin | Sin cambio |
| Selector de contacto de `appointment-dialog.tsx` | ofrecería contactos ajenos, pero el `INSERT` de `appointments` los rechaza | **No**: se limita al `agent` a los contactos que atiende |
| `POST /api/whatsapp/send` con `contact_id` | dejaría abrir una conversación con un contacto ajeno | **No**: se exige `contact_visible` |
| Automatizaciones, bot, webhooks, cron, API v1 | service-role | Sin cambio |

**1.4 — Proxy de medios.** `GET /api/whatsapp/media/[mediaId]` solo exige sesión y pertenencia a la cuenta (lee `whatsapp_config` de la cuenta); no consulta la conversación. Los adjuntos de un hilo ajeno cargan sin cambios. Los adjuntos salientes son URLs públicas de Storage. No hace falta ampliar nada.

**Cursor de la hoja de vida.** `get_contact_timeline` recibe un quinto parámetro, `p_before_key`: el `sort_key` (`kind:source_id`) de la última fila recibida. El cursor es el par `(p_before, p_before_key)`, así que eventos con la misma fecha no se repiten ni se saltan (probado con tres notas empatadas).

**`get_contact_summary.can_edit`.** El resumen trae `can_edit` (`agent`+ y `contact_visible`), que es exactamente lo que exige `contacts_update`. La ficha lo usa para ofrecer la edición y "Agendar visita" sin repetir la regla en TypeScript.

**`get_contact_assignees` (553).** Con la 553, el asesor ve todos los contactos pero no las conversaciones ajenas por tabla, y la columna "Asesor" de la lista le saldría vacía. Esta función devuelve solo (contacto, asesor, último mensaje), de la cuenta de quien consulta.

**3.3 — No regresión, medida.** Sobre los datos locales, conteo por usuario (4 `agent`, 2 `admin`, 1 `viewer`) de `conversations`, `conversations` abiertas, `messages`, `deals`, `appointments`, `appointment_events`, `conversation_assignments` y `notifications`, antes y después de 553–555: idénticos. El panel (`lib/dashboard/queries.ts`) es solo de admin, que ya veía todo.

**4.11 — Rendimiento medido (stack local, volumen sintético).** Un contacto con 3 hilos (WhatsApp, Instagram, Messenger) y 2.400 mensajes, 40 notas, y 60.000 mensajes de ruido en otras 200 conversaciones de la cuenta, con `ANALYZE`, como `agent` que no lo atiende:
- `get_contact_timeline(…, 30)`: 22 ms en frío, 11 ms en caliente; filtrado a `conversation`: 5 ms.
- `get_contact_summary`: 3 ms. `get_contact_conversation_messages` (50 mensajes): 2 ms.
El conteo por hilo usa `idx_messages_conversation_created`. No hizo falta más índice que los de la 554. Conviene repetirlo con la copia del VPS si algún contacto real supera los 10.000 mensajes.

**Desvíos de la implementación respecto del diseño:**
- *D8 — el cierre de venta no era un diálogo.* En el Inventario la venta son campos del formulario del vehículo (estado vendido → precio, fecha y comprador). Se extrajeron a `src/components/inventory/sale-closing-fields.tsx`, que usan el formulario del Inventario (sin cambio de comportamiento) y el nuevo `sell-vehicle-dialog.tsx` de la ficha. Ambos escriben por `PATCH /api/inventory/[id]`.
- *"Registrar compra" solo para admin+.* `/inventory` está en `ADMIN_ONLY_ROUTES`, así que el botón que lleva al alta con el vendedor puesto (`/inventory?nuevo=1&vendedor=<id>`) solo se ofrece a quien puede abrir esa pantalla. La API sigue aceptando el vendedor desde `agent`.
- *Sin bloque de negocios aparte.* Los negocios aparecen en la hoja de vida (`deal_created`, `deal_stage`, `deal_closed`) y su conteo en el resumen; no se extrajo la lista de negocios del panel viejo.
- *La ficha se hizo directamente con la hoja de vida final* (2.2 pedía una versión intermedia con las pestañas viejas).
- *Ruta extra:* `GET /api/contacts/[id]/messages?conversation_id=…` para el visor de hilo. Verifica que la conversación sea del contacto antes de leerla.
- *Ajustes de 1.3 hechos:* el selector de contactos de la cita ofrece al `agent` solo los que atiende; `POST /api/whatsapp/send` con `contact_id` exige `contact_visible` (403 si no); la lista de Contactos muestra la columna "Asesor" a todos (vía `get_contact_assignees`) y oculta editar/borrar en los contactos que el asesor no atiende; los documentos de un contacto ajeno se muestran sin subir ni borrar.
