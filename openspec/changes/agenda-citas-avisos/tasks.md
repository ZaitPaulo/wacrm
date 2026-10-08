## 1. Base de datos (`supabase/migrations/549_appointment_alerts.sql`)

- [x] 1.1 Confirmar que la 548 está aplicada (local) y que 549 está libre en `develop`, `main` y el VPS
- [x] 1.2 CHECK de `notifications.type` con TODOS los tipos (los 4 anteriores a la 548, los 3 de la 548 y los 7 nuevos), con un comentario de advertencia
- [x] 1.3 Columnas `appointments.pre_visit_alerted_at` y `appointments.attendance_reminded_at`, y `appointment_settings.pre_visit_alert_minutes` (60 por defecto, CHECK 15–240 o NULL); limpiar `pre_visit_alerted_at` en el reagendado (`appointments_before_write`) y proteger las dos columnas de escrituras con sesión de usuario
- [x] 1.4 Ampliar `appointments_after_write`: avisos 3 (confirmó por botón), 4 (movida o cancelada por otro, sin cambio de asesor), 5 (asesor anterior al reasignar, salvo que sea el actor) y 7 (no asistió a owner y admin, salvo el actor), cada uno dentro de su `EXCEPTION`
- [x] 1.5 Triggers en `inventory_vehicles`: `AFTER UPDATE OF status` (available/reserved → sold/hidden) y `BEFORE DELETE`, que avisan por cada cita activa futura con ese vehículo, salvo que `sold_to_contact_id` sea el contacto de la cita
- [x] 1.6 RPC `claim_due_pre_visit_alerts(p_account_id, p_minutes, p_limit)` y `claim_pending_attendance_reminders(p_account_id, p_until, p_since, p_limit)` con `FOR UPDATE SKIP LOCKED`, solo para service_role
- [x] 1.7 RPC `appointment_attendance_metrics(p_from, p_to)` (`SECURITY DEFINER`, vacía si quien llama no es admin u owner de su cuenta) con la atribución de ventas a la cita asistida más reciente dentro de 30 días
- [x] 1.8 Aplicar en local y probar con SQL: un aviso de cada tipo insertado sin violar el CHECK, cada aviso del trigger con y sin actor propio, el borrado de vehículo que avisa antes de la cascada, el comprador igual al cliente que no avisa, y las métricas con un caso armado a mano (incluida la atribución entre dos visitas)

## 2. Cron (`src/lib/appointments/cron.ts`)

- [x] 2.1 Pasada de visita próxima: lee `pre_visit_alert_minutes`; si es NULL no hace nada; reclama y crea `appointment_pre_visit` con el texto armado (cliente, motivo, vehículos). Pruebas: aviso normal, apagado, cita ya empezada, agendada con poca anticipación
- [x] 2.2 Pasada de asistencia sin marcar: calcula el cierre del día con `openingOf` de `slots.ts` (18:00 si no hay horario), reclama hasta 7 días atrás y crea un aviso por asesor y fecha con destino `/agenda?vista=dia&fecha=`. Pruebas: antes del cierre no hace nada, agrupa por asesor, no repite, ignora las de más de 7 días
- [x] 2.3 Mantener las pasadas aisladas entre sí (un fallo queda en `errors`) y sumar sus conteos al resultado de la ruta

## 3. Avisos en la interfaz

- [x] 3.1 `NotificationType` con los 7 tipos nuevos; íconos en la campana (`notifications/page.tsx`)
- [x] 3.2 `notificationHref`: `appointment_attendance_pending` → `/agenda?vista=dia&fecha=<D>` (la fecha viaja en el aviso; definir dónde: columna o `body`); los demás `appointment_*` → `/agenda?cita=<id>`. Pruebas en `payload.test.ts`
- [x] 3.3 Detalle de la cita: mostrar el estado del vehículo cuando no está disponible (vendido, oculto o reservado)

## 4. Ajustes

- [x] 4.1 Campo «Aviso de visita próxima» en `appointment-settings.tsx`: apagado / 15 / 30 / 60 / 90 / 120 / 240 minutos, 60 por defecto; textos en es, en y ko

## 5. Indicadores en el panel

- [x] 5.1 `loadAppointmentMetrics(db, from, to)` en `src/lib/dashboard/queries.ts`, con tipos y pruebas del mapeo
- [x] 5.2 Componente `appointment-metrics-card.tsx`: tabla por asesor con citas, asistió, no asistió, sin marcar, canceladas, porcentaje («—» sin datos) y ventas de visita, más la nota sobre ventas sin comprador; estados de carga, error con reintento y vacío
- [x] 5.3 Montarlo en `dashboard/page.tsx` con el mismo permiso que la tabla de rendimiento y el `range` del selector de período; textos en es, en y ko

## 6. Verificación

- [x] 6.1 `npx tsc --noEmit`, lint de los archivos tocados y la suite completa de Vitest en verde
- [x] 6.2 Prueba manual local: disparar cada aviso (ocultar y borrar un carro con cita, mover y cancelar como admin, reasignar, marcar no asistió, confirmar con un webhook simulado, correr el cron para visita próxima y asistencia) y revisar la campana y el destino de cada uno
- [x] 6.3 Ver el bloque de indicadores en el panel con los datos de prueba y el selector de 7, 30 y 90 días
