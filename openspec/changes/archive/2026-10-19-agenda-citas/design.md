## Context

El CRM ya tiene casi todas las piezas que la Agenda necesita, pero nada guarda una cita:

- **Visibilidad por rol**: `conversation_visible(account_id, assigned_agent_id)` (migración 520) decide qué ve cada miembro. Owner, admin y viewer ven todo; el agent ve solo lo que tiene asignado. Es exactamente la regla que el Director pidió para las citas («el asesor ve solo las suyas»).
- **Horario de atención**: `accounts.business_hours`, `holiday_calendar` y `src/lib/outbound/business-hours.ts` (`parseHorario`, `dentroDeHorario`, `proximaApertura`), con los festivos colombianos calculados. Todo se compara contra el reloj del proceso (`TZ=America/Bogota` en el contenedor).
- **Envíos por iniciativa del sistema**: el recordatorio de difusiones (`broadcast-follow-up.ts`, migración 524) es el precedente directo. Un cron reclama filas con una RPC transaccional, filtra por horario y envía una plantilla con `sendTemplateWithVariants`.
- **Botones de plantilla**: el webhook ya convierte el toque de un botón QUICK_REPLY (`message.type = 'button'`, `button.payload`) en `interactiveReplyId`, y `inbound/core.ts` no le pasa al bot de IA los mensajes con `interactiveReplyId`. `template-send-builder.ts` ya permite fijar el payload de cada botón al enviar.
- **Avisos**: la tabla `notifications`, con un CHECK de tipos (migración 541), y el push despachado desde la base con `pg_net`, más un barrido cada minuto (542). El payload del push solo sabe abrir una conversación o `/notifications`.
- **Cron**: `deploy/cron/crontab` llama rutas internas con `x-cron-secret` (patrón `/api/handoff/sla/cron`).
- **UI**: `@dnd-kit/core` y `date-fns` ya están instalados; `vehicle-picker.tsx` busca vehículos y sugiere primero los que el contacto consultó (`vehicle_inquiries`).

La memoria del proyecto fija las restricciones: nada de Server Actions; CRUD desde el cliente con Supabase bajo RLS y rutas `/api` para lo que es server-only; migraciones `NNN_` idempotentes; toda tabla nueva con `REVOKE ALL … FROM anon, authenticated` y luego GRANT explícitos.

## Goals / Non-Goals

**Goals:**
- Que cada cita viva en la base con asesor, cliente, hora, motivo, vehículos y estado, y que no pueda haber dos citas activas del mismo asesor que se crucen.
- Que la Agenda (día, semana y mes) y el botón «Agendar visita» funcionen para los cuatro roles con la regla de visibilidad que ya existe.
- Confirmación y recordatorio por WhatsApp sin que nadie tenga la app abierta, respetando la ventana de 24 h y el horario de atención.
- Que los botones del recordatorio cambien la cita de forma determinista, sin pasar por el bot.
- Avisos al asesor por los mismos canales que ya usa (campana y push).

**Non-Goals:**
- Que el bot agende (fase 3), la etapa automática del embudo, el aviso de carro vendido, los indicadores y la sincronización con calendarios externos.
- Varias sedes o zonas horarias por cuenta.
- Capacidad configurable de varias citas simultáneas por asesor (ver Open Questions).

## Decisions

### 1. Tres tablas nuevas, más una de vehículos por cita

- `appointments`: `id`, `account_id`, `contact_id` (NOT NULL), `conversation_id` (opcional), `assigned_agent_id`, `starts_at`, `duration_minutes` (15–480, 30 por defecto), `ends_at`, `purpose` (`view_vehicle`, `test_drive`, `appraisal`, `signing`, `delivery`), `notes`, `status`, `scheduled_at` (cuándo se fijó la hora vigente), `confirmation_status` (`none`, `pending`, `sent`, `skipped`, `failed`), `reminder_sent_at`, `customer_response` (`confirmed`, `change_requested`), `customer_responded_at`, `created_by`, `created_at` y `updated_at`.
- `appointment_vehicles(appointment_id, vehicle_id)`, con FK a `inventory_vehicles` y `ON DELETE CASCADE` desde la cita (`ON DELETE CASCADE` también desde el vehículo: si se borra el vehículo, la cita queda sin él).
- `appointment_events`: historial de solo inserción (`kind`, `actor_user_id`, `data jsonb`, `created_at`).
- `appointment_settings`: una fila por cuenta con `customer_messages_enabled`, `confirmation_template_id`, `reminder_template_id`, `reminder_time` (10:00 por defecto), `digest_time` (07:30) y `default_duration_minutes` (30).
- `appointment_digests(account_id, user_id, day)`: deja constancia de qué resumen diario ya salió, para que salga una sola vez.

*Alternativa descartada*: guardar los vehículos en un `uuid[]`. Un arreglo no admite FK, así que un vehículo borrado dejaría ids colgando.

### 2. Estados: cinco guardados y el reagendado como evento

Estados guardados: `scheduled`, `confirmed`, `attended`, `no_show` y `cancelled`. «Reagendada» no es un estado: es el cambio de `starts_at`. Un trigger `BEFORE UPDATE` aplica las reglas en la base, para que valgan por cualquier camino:

- Si cambia `starts_at` o `duration_minutes`: recalcula `ends_at`, fija `scheduled_at = now()`, vuelve a `scheduled` (aunque estuviera `confirmed`), limpia `reminder_sent_at` y `customer_response`.
- `attended`, `no_show` y `cancelled` son finales. Salir de ellos solo se permite a admin y owner (para corregir un error), y una cita cancelada no puede moverse de hora.
- `ends_at` lo calcula siempre el trigger (`starts_at + duration`) y lo que mande el cliente se ignora. No puede ser columna generada porque `timestamptz + interval` no es inmutable.

Un trigger `AFTER INSERT OR UPDATE` (`SECURITY DEFINER`) escribe `appointment_events`: `created`, `rescheduled`, `reassigned`, `status_changed`, `customer_confirmed`, `customer_change_requested`, `confirmation_sent` y `reminder_sent`. El actor es `auth.uid()`, o NULL si la acción vino del sistema. Con el trigger, el historial de la ficha del contacto no depende de que cada pantalla se acuerde de registrarlo.

*Alternativa descartada*: un estado `rescheduled`. Mezcla «qué le pasó» con «en qué está»; la vista tendría que tratarlo igual que `scheduled`, y el recordatorio se saltaría las citas reagendadas.

### 3. Sin cruces por asesor: restricción de exclusión

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE appointments ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (assigned_agent_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
  WHERE (status IN ('scheduled','confirmed'));
```

La base es el árbitro final: dos asesores creando la misma franja al mismo tiempo, o un arrastre sobre otra cita, terminan en el error `23P01`, y la UI lo traduce a «Esa hora ya está ocupada». Las franjas libres del formulario se calculan en el cliente (decisión 5) solo para guiar; no garantizan nada.

*Alternativa descartada*: comprobar el cruce en una RPC. Funciona, pero hay que serializar a mano (bloqueo por asesor) y cualquier escritura directa de la tabla se lo saltaría.

### 4. Permisos: la misma regla que las conversaciones

- `SELECT`: `conversation_visible(account_id, assigned_agent_id)`.
- `INSERT` y `UPDATE`: miembro con al menos el rol `agent`, la fila visible y `WITH CHECK (assigned_agent_id = auth.uid() OR is_account_member(account_id, 'admin'))`. Así un asesor no puede crearle ni pasarle una cita a un compañero, y viewer no escribe. Además, `EXISTS` sobre `contacts` del mismo `account_id`: como la RLS de contactos aplica dentro de la política, un asesor tampoco puede citar a un cliente que no ve.
- Un trigger valida que `assigned_agent_id` sea miembro de la cuenta con rol `agent` o superior.
- Sin `DELETE` para nadie: las citas se cancelan, no se borran.
- `appointment_events` y `appointment_vehicles` heredan la visibilidad de su cita con `EXISTS`. `appointment_settings` la leen todos los miembros (el asesor necesita la duración por defecto y saber si hay mensajes al cliente) y solo la escribe admin.

### 5. Franjas libres: función pura en el cliente

`src/lib/appointments/slots.ts` recibe el día, el horario de la cuenta (`parseHorario` y festivos), la duración y las citas activas del asesor. Devuelve inicios cada 30 minutos que caben enteros dentro del horario y no cruzan otra cita. Si la cuenta no tiene horario, usa L–S de 08:00 a 18:00. Es pura y se prueba con Vitest, sin base.

La hora se maneja en la zona del navegador, que para Lora Motors es la misma del servidor (Bogotá). Los crons usan el reloj del proceso, igual que `business-hours.ts`.

### 6. Calendario propio, sin librería de calendario

La cuadrícula es CSS grid (franjas de 30 minutos y posición absoluta por cita), con `date-fns` (locale `es`) para las fechas y `@dnd-kit/core` para arrastrar. En la vista Día, la columna destino define el asesor (solo admin y owner pueden soltar en otra columna). Siguiendo la regla del proyecto, la tarjeta entera es arrastrable, sin asa, con cursor de mano. Soltar no guarda de una vez: abre una confirmación con la hora nueva y la casilla «Avisar al cliente del cambio» (marcada si los mensajes están activos), para evitar mover una cita sin querer.

*Alternativa descartada*: FullCalendar o react-big-calendar. Son una dependencia grande con su propio sistema de estilos, chocan con shadcn y el tema oscuro, y la vista Día por asesor exige su versión premium («resource timeline») o un parche.

La página es `src/app/(dashboard)/agenda/page.tsx`, un client component con consultas Supabase por rango de fechas y Realtime sobre `appointments` para refrescar, igual que la bandeja. El estado de la vista va en la URL (`?vista=dia&fecha=2026-10-07&asesor=…&cita=…`), para que los avisos puedan enlazar a una cita.

### 7. Mensajes al cliente: un solo cron que drena una cola en la base

El cliente nunca envía nada directamente. Al crear o reagendar con «Avisar al cliente», la fila queda con `confirmation_status = 'pending'`. La ruta `/api/appointments/cron`, llamada **cada minuto**, hace tres pasadas independientes (si una falla, las otras siguen):

1. **Confirmaciones**: reclama las `pending` con `claim_pending_appointment_confirmations()` (`FOR UPDATE SKIP LOCKED`). Si la ventana de 24 h está abierta (`evaluateWindow`), manda texto libre armado en `src/lib/appointments/messages.ts`. Si no, y el canal es WhatsApp, manda la plantilla de confirmación, solo dentro del horario de atención (si está fuera, la deja `pending` hasta la apertura). Si la conversación no es de WhatsApp, marca `skipped`: la puerta de salida (`resolveOutboundTarget`) hoy solo envía por WhatsApp. Cada resultado queda en `confirmation_status` y en el historial.
2. **Recordatorios**: el día anterior, desde `reminder_time` y dentro del horario. Reclama con `claim_due_appointment_reminders(p_tomorrow_start, p_tomorrow_end, p_today_start)`; los límites del día los calcula Node con su reloj. Solo salen citas `scheduled` o `confirmed` del día siguiente, sin `reminder_sent_at`, y cuyo `scheduled_at` sea anterior a hoy: una cita creada o movida hoy para mañana ya recibió su confirmación y no necesita recordatorio. Va siempre por plantilla y solo por WhatsApp.
3. **Resumen diario**: desde `digest_time`, una vez por asesor y día (`INSERT … ON CONFLICT DO NOTHING RETURNING` en `appointment_digests`). Lleva sus citas activas de hoy y cuántas de ayer quedaron sin marcar asistencia. Si no tiene ninguna de las dos, no se crea notificación.

*Por qué una cola y no un `fetch` desde el navegador*: el asesor puede cerrar la pestaña justo después de agendar; la cola sobrevive y cada intento queda registrado. El costo es hasta un minuto de demora en la confirmación. *Por qué un solo cron*: las tres pasadas comparten configuración y credenciales de Meta, y al desplegar se agrega una sola línea al crontab.

### 8. Contrato de las plantillas

Las variables del cuerpo se llenan por posición, siempre en este orden: `{{1}}` nombre del cliente, `{{2}}` fecha y hora («martes 7 de octubre, 2:00 p. m.»), `{{3}}` nombre completo del asesor, `{{4}}` vehículo(s). Una plantilla puede usar de 0 a 4 variables, pero siempre las primeras N; se valida en Ajustes al elegirla, como hace `checkFollowUpTemplate`. La de recordatorio, además, tiene que tener exactamente dos botones QUICK_REPLY: el primero confirma y el segundo pide cambiar. No se admiten encabezados con multimedia ni con variable.

Al enviar el recordatorio se fija el payload de cada botón como `cita:<id>:confirmar:<epoch>` y `cita:<id>:cambiar:<epoch>`, donde `<epoch>` es `starts_at` en segundos.

### 9. Respuesta del cliente: antes de flujos, automatizaciones y bot

En `inbound/core.ts`, justo después de guardar el mensaje y antes de `dispatchInboundToFlows`, si `interactiveReplyId` empieza con `cita:`, `handleAppointmentReply` (en `src/lib/appointments/customer-reply.ts`, con service role) hace lo siguiente:

- Verifica que la cita sea de esa cuenta y de ese contacto, que siga activa y que `<epoch>` coincida con su `starts_at` actual. Si no coincide (una cita movida después del recordatorio, o cancelada), responde «Esa cita cambió; tu asesor te confirmará los detalles» y no toca nada.
- **Confirmar**: `status = 'confirmed'` y `customer_response = 'confirmed'`, y responde con el acuse.
- **Cambiar**: `customer_response = 'change_requested'`, crea la notificación `appointment_change_requested` para el asesor y responde «Tu asesor X te escribirá para buscar otra hora».
- Devuelve «consumido»: no corren flujos ni los disparadores de contenido de las automatizaciones (igual que cuando un flujo consume el mensaje), y el bot ya no responde porque el mensaje trae `interactiveReplyId`.

El acuse va como texto libre: el cliente acaba de escribir, así que la ventana de 24 h está abierta.

### 10. Avisos al asesor: tres tipos nuevos en `notifications`

Se agregan al CHECK `appointment_assigned`, `appointment_change_requested` y `appointment_digest`, y una columna `appointment_id` (FK con `ON DELETE CASCADE`). `appointment_assigned` lo crea el trigger de `appointments` cuando se asigna o reasigna una cita a alguien distinto de quien la creó. Los otros dos los crean el manejador de respuestas y el cron. El push sale solo, por el trigger de despacho que ya existe sobre `notifications` (542).

`buildPushPayload` usa `/agenda?cita=<id>` como URL de los tipos `appointment_*` (`/agenda?vista=dia` para el resumen), y la campana y el aviso emergente usan la misma regla. Por eso se modifica `in-app-notification-alerts`.

### 11. Código nuevo

- `src/lib/appointments/`: `types.ts`, `slots.ts`, `status.ts` (qué acciones ofrece cada estado según el rol), `messages.ts` (textos y variables), `templates.ts` (validación de plantillas), `customer-reply.ts`, `cron.ts` (las tres pasadas, con dependencias inyectables para las pruebas) y `format.ts` (fecha en español).
- `src/components/agenda/`: `agenda-view.tsx`, `day-view.tsx`, `week-view.tsx`, `month-view.tsx`, `appointment-card.tsx`, `appointment-dialog.tsx` (crear y editar), `appointment-sheet.tsx` (detalle y acciones de estado) y `contact-appointments.tsx` (para `contact-sidebar.tsx`).
- `src/components/settings/appointment-settings.tsx`.
- `src/app/api/appointments/cron/route.ts`.

## Risks / Trade-offs

- [Meta tarda en aprobar las plantillas o las rechaza] → Los mensajes al cliente nacen apagados (`customer_messages_enabled = false`). La Agenda funciona sin ellos y se activan en Ajustes cuando las plantillas estén aprobadas.
- [Dos asesores toman la misma franja] → La restricción de exclusión rechaza la segunda y la UI muestra «Esa hora ya está ocupada», con las franjas recargadas.
- [El cliente toca un botón viejo después de que la cita se movió] → El `<epoch>` del payload no coincide y se responde sin cambiar nada.
- [Zona horaria] → Navegador y servidor están en Bogotá. Si algún día hay cuentas en otro huso, habrá que guardar la zona por cuenta, igual que con el horario de atención; queda documentado y no se resuelve ahora.
- [`btree_gist` no disponible en el VPS] → Es una extensión estándar de Postgres que Supabase trae incluida. Igual se verifica con `SELECT * FROM pg_available_extensions WHERE name = 'btree_gist'` antes de aplicar la migración.
- [Un cron por minuto más] → Cada pasada consulta con índices parciales (`confirmation_status = 'pending'`, citas activas por `starts_at`) y termina en milisegundos si no hay trabajo.
- [Arrastrar una cita sin querer] → Soltar siempre pide confirmación.

## Migration Plan

1. Antes de crear la migración, confirmar que el último número aplicado en el VPS sigue siendo el 547; si no, renumerar.
2. Desplegar con el procedimiento de siempre (develop → main, respaldo, `apply-migrations.sh --dry-run` para confirmar que la 548 aparece, aplicar, reconstruir el app).
3. Agregar `* * * * * /tick.sh /api/appointments/cron` a `deploy/cron/crontab` y **reiniciar el contenedor del cron**.
4. Crear en Meta las dos plantillas desde Ajustes → Plantillas (categoría Utilidad, idioma español) y esperar la aprobación. Texto propuesto:
   - **`cita_confirmada`**: «Hola {{1}}, tu visita a Lora Motors quedó agendada para el {{2}}. Te atenderá {{3}}. Vehículo de interés: {{4}}. Si necesitas cambiar la hora, respóndenos por aquí.» Ejemplos: Jorge · miércoles 7 de octubre, 2:00 p. m. · Angélica Rodríguez · Chevrolet Tracker 2021.
   - **`recordatorio_cita`**: «Hola {{1}}, te recordamos tu visita a Lora Motors mañana, {{2}}, con {{3}}. ¿Nos confirmas?», con dos botones de respuesta rápida, en este orden: «Confirmo» y «Necesito cambiar la hora».
5. En Ajustes → Agenda, elegir las plantillas y las horas, y activar los mensajes al cliente.

**Rollback**: quitar la línea del crontab y reiniciar el cron, revertir el commit del app y, si hace falta, `DROP` de las tablas nuevas y volver el CHECK de `notifications.type` a sus dos valores (borrando antes las notificaciones `appointment_*`).

## Open Questions

Son las preguntas que el cliente todavía no responde. Ninguna bloquea la implementación, porque cada una tiene un valor por defecto fácil de cambiar:

- **Horario y duración**: se usa el horario de atención de la cuenta y 30 minutos por defecto.
- **Citas simultáneas por asesor**: una sola. Si el cliente pide dos, hay que reemplazar la restricción de exclusión por un conteo en un trigger.
- **Asesor por defecto al agendar desde el chat**: el asignado a la conversación; si no tiene, quien agenda.
- **Hora del recordatorio y del resumen**: 10:00 y 07:30, configurables.
- **Recordatorio adicional el mismo día**: no entra en esta fase.
- **Lista de motivos**: los cinco propuestos, fijos en el código. Si el cliente quiere otros, se agregan al CHECK.
