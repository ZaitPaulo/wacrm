## 1. Base de datos (`supabase/migrations/548_appointments.sql`)

- [x] 1.1 Confirmar el último número de migración en `develop`, `main` y el VPS (`SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 1`) y que `btree_gist` está disponible (`pg_available_extensions`); renumerar si 548 está tomado
- [x] 1.2 `CREATE EXTENSION IF NOT EXISTS btree_gist` y la tabla `appointments` con sus columnas, CHECK de `status`, `purpose`, `duration_minutes` (15–480), `confirmation_status` y `customer_response`, e índices por `(account_id, starts_at)`, `(assigned_agent_id, starts_at)`, `contact_id` y el parcial `confirmation_status = 'pending'`
- [x] 1.3 Restricción de exclusión `appointments_no_overlap` (asesor `=`, `tstzrange(starts_at, ends_at)` `&&`, solo `scheduled`/`confirmed`)
- [x] 1.4 Tablas `appointment_vehicles`, `appointment_events`, `appointment_settings` y `appointment_digests`, con FK y `ON DELETE CASCADE` según el diseño; trigger que exige que el vehículo sea de la misma cuenta que la cita
- [x] 1.5 Trigger `BEFORE INSERT OR UPDATE` en `appointments`: calcular `ends_at`; `scheduled_at` al crear y al cambiar la hora; al reagendar volver a `scheduled` y limpiar `reminder_sent_at` y `customer_response`; rechazar cambio de hora en estados finales; rechazar salir de un estado final si el actor no es admin (sin `auth.uid()` = sistema, permitido); validar que el asesor sea miembro con rol `agent` o superior; `updated_at`
- [x] 1.6 Trigger `AFTER INSERT OR UPDATE` (`SECURITY DEFINER`) que escribe `appointment_events` (`created`, `rescheduled`, `reassigned`, `status_changed`, `customer_confirmed`, `customer_change_requested`, `confirmation_sent`, `reminder_sent`) y crea la notificación `appointment_assigned` cuando el asesor nuevo es distinto del actor
- [x] 1.7 `notifications`: columna `appointment_id` (FK con `ON DELETE CASCADE`) y CHECK de `type` con `appointment_assigned`, `appointment_change_requested` y `appointment_digest`; verificar que el trigger de despacho de push (542) y el barrido no filtran por tipo
- [x] 1.8 Privilegios: `REVOKE ALL … FROM PUBLIC, anon, authenticated` y luego los GRANT concretos (sin DELETE en `appointments`; `appointment_events` solo SELECT; `appointment_digests` solo service_role)
- [x] 1.9 RLS: `appointments` con `conversation_visible` en SELECT; INSERT/UPDATE con rol `agent`, asesor propio o admin, y `EXISTS` del contacto en la misma cuenta; tablas hijas por `EXISTS` sobre la cita; `appointment_settings` con SELECT para miembros y escritura para admin
- [x] 1.10 RPCs para el cron (`SECURITY DEFINER`, solo service_role): `claim_pending_appointment_confirmations(p_limit)`, `claim_due_appointment_reminders(p_today_start, p_tomorrow_start, p_tomorrow_end, p_limit)` con `FOR UPDATE SKIP LOCKED`
- [x] 1.11 Habilitar Realtime para `appointments` y aplicar la migración en el stack local; probar con SQL la RLS por rol, la exclusión de cruces y el historial

## 2. Lógica pura (`src/lib/appointments/`) con pruebas Vitest

- [x] 2.1 `types.ts` (fila, estados, motivos y sus etiquetas) y `format.ts` (fecha y hora en español: «martes 7 de octubre, 2:00 p. m.»)
- [x] 2.2 `slots.ts`: franjas libres por asesor, día y duración, con `parseHorario`, festivos y el horario por defecto L–S 08:00–18:00. Pruebas: día con citas, cita que no cabe antes del cierre, domingo cerrado, festivo, sin horario configurado
- [x] 2.3 `status.ts`: acciones disponibles según estado y rol (agent, admin, viewer). Pruebas para cada estado
- [x] 2.4 `templates.ts`: validación de las plantillas de confirmación y recordatorio (aprobada, sin encabezado multimedia ni con variable, variables 1..N consecutivas ≤ 4, recordatorio con exactamente dos QUICK_REPLY). Pruebas por cada motivo de rechazo
- [x] 2.5 `messages.ts`: texto libre de confirmación, acuses (confirmó, pidió cambio, recordatorio vigente o no), variables de plantilla en orden y payloads `cita:<id>:<accion>:<epoch>` con su parser. Pruebas

## 3. Agenda (UI)

- [x] 3.1 Agregar `/agenda` a `canAccessPath` (todos los roles) y la entrada «Agenda» con ícono de calendario después de «Bandeja» en `sidebar.tsx`; actualizar `route-access.test.ts`
- [x] 3.2 `src/app/(dashboard)/agenda/page.tsx` + `agenda-view.tsx`: estado en la URL (`vista`, `fecha`, `asesor`, `cita`), navegación anterior/hoy/siguiente, filtro de asesor (no para agent), carga por rango y Realtime
- [x] 3.3 `day-view.tsx` (columna por asesor, franjas de 30 min dentro del horario, línea de hora actual), `week-view.tsx` y `month-view.tsx` (conteo por día; tocar un día lleva a la vista Día)
- [x] 3.4 `appointment-card.tsx`, con el color del asesor y la etiqueta de estado
- [x] 3.5 `appointment-dialog.tsx` (crear y editar): buscador de contacto (si no viene precargado), asesor (fijo para agent), fecha, franjas libres, duración, motivo, vehículos con `vehicle-picker` y sugeridos, notas, casilla «Avisar al cliente» (solo si los mensajes están activos), y el error `23P01` traducido a «Esa hora ya está ocupada» con recarga de franjas
- [x] 3.6 `appointment-sheet.tsx`: detalle, enlace a la conversación, respuesta del cliente, historial (`appointment_events`) y acciones según `status.ts`
- [x] 3.7 Arrastrar con `@dnd-kit/core` en las vistas Día y Semana: tarjeta entera con cursor de mano, columnas de otros asesores bloqueadas para agent, estados finales no arrastrables, y confirmación con hora nueva y «Avisar al cliente del cambio»
- [x] 3.8 Clic en franja libre para crear con fecha, hora y asesor precargados
- [x] 3.9 Botón «Agendar visita» en la cabecera de `message-thread.tsx` (oculto para viewer), que abre el diálogo con contacto, conversación, asesor y vehículos consultados
- [x] 3.10 `contact-appointments.tsx` en `contact-sidebar.tsx`: próxima cita y anteriores, con enlace a la Agenda
- [x] 3.11 Textos en `messages/es.json`, `en.json` y `ko.json` (Sidebar, Agenda, estados, motivos, errores y Ajustes)

## 4. Mensajes al cliente y respuesta a botones

- [x] 4.1 `appointment-settings.tsx` en Ajustes (sección `adminOnly` en `settings-sections.ts`): activar mensajes, elegir plantillas con la validación de `templates.ts`, horas de recordatorio y resumen, y duración por defecto; actualizar `settings-sections.test.ts`
- [x] 4.2 Al guardar una cita nueva o reagendada con «Avisar al cliente», dejar `confirmation_status = 'pending'`; sin aviso, `none`
- [x] 4.3 `cron.ts`, pasada de confirmaciones: reclamar, decidir entre texto libre y plantilla según `evaluateWindow`, respetar el horario en las plantillas, `skipped` en IG/FB con ventana cerrada, y registrar `sent`, `skipped` o `failed` con su evento. Pruebas con dependencias inyectadas
- [x] 4.4 `cron.ts`, pasada de recordatorios: límites del día con el reloj del proceso, solo desde `reminder_time` y dentro del horario, plantilla con payloads por botón (`template-send-builder`) y `reminder_sent_at` con su evento. Pruebas: normal, agendada hoy, fuera de horario, no WhatsApp, reagendada
- [x] 4.5 Verificar en `webhook/route.ts` que el toque de un botón QUICK_REPLY de plantilla deja `button.payload` en `interactiveReplyId`; ajustar si hoy se usa el texto. Prueba del webhook
- [x] 4.6 `customer-reply.ts` (`handleAppointmentReply`): validar cuenta, contacto, estado y `<epoch>`; confirmar o pedir cambio; notificación `appointment_change_requested`; acuse por texto libre. Pruebas: confirma, pide cambio, recordatorio viejo, cita cancelada, payload ajeno
- [x] 4.7 Engancharlo en `inbound/core.ts` antes de `dispatchInboundToFlows`: si consume el mensaje, no corren flujos, disparadores de contenido ni bot. Prueba en el test del núcleo de entrada
- [x] 4.8 `src/app/api/appointments/cron/route.ts` con `x-cron-secret` (igual que `/api/handoff/sla/cron`) y las tres pasadas aisladas entre sí; pruebas de 401, 503 y éxito

## 5. Avisos al asesor

- [x] 5.1 `cron.ts`, pasada del resumen diario: desde `digest_time`, una vez por asesor y día con `appointment_digests`, con las citas de hoy y las de ayer sin marcar; sin notificación si no hay nada. Pruebas
- [x] 5.2 `buildPushPayload` y `PushableNotification` con `appointment_id`: URL `/agenda?cita=<id>` o `/agenda?vista=dia`; actualizar la ruta de despacho, el barrido para que seleccionen la columna y `payload.test.ts`
- [x] 5.3 Campana (`notifications/page.tsx`) y aviso emergente: íconos y destino de los tipos `appointment_*`; tipos en `NotificationType`
- [x] 5.4 Revisar `public/sw.js`: que el clic use `payload.url` también para la Agenda

## 6. Despliegue y verificación

- [x] 6.1 Agregar `* * * * * /tick.sh /api/appointments/cron` a `deploy/cron/crontab`, con su comentario y el aviso de reiniciar el contenedor
- [x] 6.2 `npm run lint`, `npx tsc --noEmit` y la suite completa de tests en verde
- [x] 6.3 Prueba manual local con los cuatro roles: crear desde el chat y desde el calendario, ocupar la misma franja desde dos sesiones, arrastrar, cambiar estados, ficha del contacto y avisos en la campana
- [x] 6.4 Prueba manual del cron en local llamando a la ruta con el secreto: confirmación con ventana abierta y cerrada, recordatorio y resumen; simular el toque de los botones con un webhook de prueba
- [x] 6.5 Redactar el texto de las dos plantillas para Meta (confirmación con variables 1–4, recordatorio con «Confirmo» y «Necesito cambiar la hora») y dejarlo en el resumen de despliegue
