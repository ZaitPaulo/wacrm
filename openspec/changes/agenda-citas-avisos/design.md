## Context

`agenda-citas` (migración 548) dejó tres cosas en las que este cambio se apoya:

- **Trigger `appointments_after_write` (`SECURITY DEFINER`)**: escribe el historial y crea `appointment_assigned`. Cuando el cambio lo hizo una persona, el actor es `auth.uid()`; si lo hizo el cron o el cliente con un botón, es NULL.
- **Cron por minuto (`/api/appointments/cron`)**: tiene tres pasadas aisladas entre sí y usa RPC con `FOR UPDATE SKIP LOCKED` para reclamar las citas.
- **Destino del aviso**: `notificationHref` lleva los tipos `appointment_*` a `/agenda?cita=<id>`, y el push sale solo por el trigger de despacho de `notifications` (542).

Datos de producción (2026-10-08) que condicionan el diseño:

- Hay **0 vehículos vendidos** y 2 ocultos. Nadie marca ventas en el CRM, así que el aviso 1 se disparará casi siempre por ocultar o borrar.
- El indicador de ventas va a mostrar 0 hasta que el equipo marque los carros como vendidos y vincule al comprador.
- `appointment_vehicles` borra en cascada al borrar un vehículo, y hoy la cita pierde el carro sin que nadie se entere.

## Goals / Non-Goals

**Goals:**
- Siete avisos que la base genera sola, sin depender de la pantalla que originó el cambio.
- No avisarle a nadie lo que acaba de hacer él mismo.
- Indicadores honestos, que no inventen ventas que no están registradas.

**Non-Goals:** el bot, el embudo, mensajes al cliente y preferencias de aviso por usuario.

## Decisions

### 1. Siete tipos nuevos de notificación

`appointment_vehicle_unavailable`, `appointment_pre_visit`, `appointment_customer_confirmed`, `appointment_updated` (movida o cancelada por otro), `appointment_unassigned` `appointment_attendance_pending` y `appointment_no_show`, este último para la gerencia. Cada uno tiene su ícono en la campana y en la Agenda.

El CHECK se reescribe **con todos los tipos anteriores**. En la 548 casi se pierden `handoff_reminder` y `handoff_unattended`; la migración trae un comentario que lo advierte y una prueba SQL que inserta un aviso de cada tipo.

*Alternativa descartada*: un solo tipo `appointment_event` con un subtipo en `body`. La campana no podría distinguirlos y el push no podría elegir el destino.

### 2. Avisos 3, 4, 5 y 7 en el trigger que ya existe

Se amplía `appointments_after_write`, que ya conoce al actor y la fila anterior y nueva:

| Condición | Aviso | Destinatario | Excepción |
|---|---|---|---|
| `customer_response` pasa a `confirmed` | 3 confirmó | asesor | — (el actor es siempre el sistema) |
| cambia `starts_at` o la duración, o `status` pasa a `cancelled`, y **no** cambia el asesor | 4 tu cita cambió | asesor | el actor es el asesor |
| cambia `assigned_agent_id` | 5 te la quitaron | asesor anterior | el actor es el asesor anterior |
| `status` pasa a `no_show` | 7 no asistió | cada owner y admin de la cuenta | quien la marcó |

Si una sola edición reasigna **y** mueve la cita, el asesor nuevo recibe «nueva cita» (ya existe) y el anterior recibe «te la quitaron». No se manda además «tu cita cambió»: ya no es suya.

Un fallo al crear un aviso no bloquea la cita (`EXCEPTION … RAISE WARNING`), igual que en la 548.

### 3. Aviso 1: dos triggers sobre `inventory_vehicles`

- `AFTER UPDATE OF status`: cuando el vehículo pasa de `available` o `reserved` a `sold` o `hidden`.
- `BEFORE DELETE`: se ejecuta **antes** del borrado en cascada de `appointment_vehicles`, así que todavía se pueden leer las citas afectadas. Así se resuelve el agujero de la fase 2.

En los dos casos, por cada cita **activa y futura** que tenga ese vehículo, se avisa al asesor. La excepción es que `sold_to_contact_id` sea el contacto de la cita: si lo compró el mismo cliente, no se avisa. El texto es «Se vendió / Se ocultó / Se borró la Chevrolet Tracker 2021 · Jorge Castro viene el jueves 9, 3:00 p. m.».

`reserved` no dispara el aviso: un carro reservado puede estar reservado para el mismo cliente. Si lo reservan para otro, el asesor lo verá como «Reservado» en la cita (queda como tarea de UI menor: mostrar el estado del vehículo en el detalle de la cita).

### 4. Aviso 2: pasada nueva del cron

- Columna `appointments.pre_visit_alerted_at`. El trigger de reagendado de la 548 la limpia, igual que hace con el recordatorio.
- Ajuste `appointment_settings.pre_visit_alert_minutes`: entero, 60 por defecto, entre 15 y 240, o NULL si el aviso está apagado.
- RPC `claim_due_pre_visit_alerts(p_account_id, p_minutes, p_limit)`: reclama, con `SKIP LOCKED`, las citas activas con `starts_at` dentro de `(now, now + minutos]` y sin `pre_visit_alerted_at`, y la fija en la misma sentencia.
- **No respeta el horario de atención.** El aviso va al teléfono del asesor, no al cliente, y la visita ya está dentro del horario. Para una cita a las 8:00 el aviso sale a las 7:00, que es justo cuando sirve. Esto corrige lo que se dijo de pasada en la exploración («nunca fuera de horario»): aplicado, haría inútil el aviso de la primera cita del día.
- Una cita creada con menos de X minutos de anticipación recibe el aviso en la siguiente pasada, y queda fuera si ya empezó.

### 5. Aviso 6: pasada nueva del cron, agrupada por asesor y día

- Columna `appointments.attendance_reminded_at`.
- Cuándo: el día D, después del **cierre** del horario de ese día (`openingOf(D)` de `slots.ts`, o 18:00 si no hay horario configurado). También, en la primera pasada de los días siguientes, para lo que quedó atrás (por ejemplo, si el servidor estaba caído). Solo cuenta lo de los últimos 7 días, para no revivir lo viejo.
- Qué: las citas `scheduled` o `confirmed` con `ends_at < now()` y sin `attendance_reminded_at`.
- Una notificación **por asesor**: «Tienes 2 citas de hoy sin marcar asistencia», con destino `/agenda?vista=dia&fecha=<D>`. Se reclaman en una sentencia con `RETURNING`, igual que las otras.
- El resumen diario de la fase 2 sigue nombrando las de ayer. Se superponen a propósito: este aviso llega la misma tarde y el resumen sirve de segundo recordatorio.

### 6. Indicadores: RPC con período

`appointment_attendance_metrics(p_from timestamptz, p_to timestamptz)` es `SECURITY DEFINER`, responde vacío si quien llama no es admin u owner de su cuenta y devuelve una fila por asesor que tuvo citas en el período:

| Columna | Cálculo |
|---|---|
| `appointments` | citas con `starts_at` en el período, sin contar las canceladas |
| `attended`, `no_show` | por estado |
| `unmarked` | activas cuyo `ends_at` ya pasó |
| `cancelled` | aparte, informativo |
| `attendance_rate` | `attended / (attended + no_show)`, NULL si el divisor es 0 |
| `sales_from_visit` | vehículos con `sold_at` en el período cuyo `sold_to_contact_id` tuvo una cita `attended` entre 0 y 30 días antes de `sold_at`, atribuidos al asesor de la cita asistida **más reciente** anterior a la venta; cada vehículo cuenta una vez |

El porcentaje no cuenta las citas sin marcar: mezclarlas castigaría al asesor por un dato que falta, no por un cliente que faltó. Las sin marcar se muestran al lado, para que se vea la deuda.

**UI**: tarjeta «Citas y asistencia» en `dashboard/page.tsx`, junto a la tabla de rendimiento. Es visible con el mismo permiso (`edit-settings`) y usa el `range` del selector de período que ya existe. Lleva una nota fija bajo la columna de ventas: «Cuenta solo carros marcados como vendidos con el comprador vinculado».

*Alternativa descartada*: sumar columnas a la tabla de rendimiento. Esa tabla no tiene período a propósito (spec `agent-performance-metrics`), y la asistencia sin período no dice nada.

## Risks / Trade-offs

- [Demasiados avisos] → No se avisa al propio actor. El 6 va agrupado por asesor y día. El 2 se puede apagar en Ajustes. Sin preferencias por usuario por ahora.
- [El CHECK de tipos pierde alguno al reescribirse] → La lista completa va en la migración, con un comentario y una prueba SQL.
- [`BEFORE DELETE` en inventario frena un borrado] → El aviso va dentro de `EXCEPTION`: el borrado sigue aunque falle.
- [Ventas siempre en 0] → La nota en la tarjeta lo explica. Es un dato que el cliente tiene que empezar a registrar.
- [Zona horaria] → El cierre del día y los textos usan la hora local, igual que el resto de la Agenda.

## Migration Plan

1. Desplegar después de la 548 (o en el mismo despliegue). Confirmar contra el VPS que el número 549 sigue libre.
2. No hay línea nueva en el crontab: las pasadas nuevas van en `/api/appointments/cron`.
3. Rollback: `DROP` de los triggers, de las RPC y de las columnas nuevas, y volver el CHECK de tipos a la lista de la 548 (borrando antes los avisos nuevos).

## Open Questions

- El texto exacto de cada aviso: hay propuestas en los specs y el cliente puede ajustarlas.
- ¿El aviso de «no asistió» debe ir a todos los admin, o solo a quien tenga un rol comercial? Hoy son todos los owner y admin.
