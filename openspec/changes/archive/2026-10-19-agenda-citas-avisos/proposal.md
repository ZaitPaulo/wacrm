## Why

Las fases 1 y 2 de la Agenda (`agenda-citas`) dejan las citas registradas, pero el asesor solo se entera de tres cosas: que le asignaron una cita, que el cliente pidió cambiarla y su resumen diario. Lo demás pasa sin que nadie lo sepa:

- el carro por el que viene el cliente se vende, se oculta o se borra;
- falta una hora para la visita;
- el cliente confirmó por WhatsApp;
- un admin movió, canceló o reasignó la cita;
- la cita pasó y nadie marcó si el cliente vino.

La gerencia, además, no tiene cómo medir la asistencia por asesor.

El Director decidió el 2026-10-08 que la fase 3 sean avisos e indicadores, sin que el bot agende y sin mover el embudo.

## What Changes

**Avisos al asesor de la cita**
1. **Carro no disponible**: el vehículo de una cita activa futura pasa a vendido u oculto, o se borra del inventario. No se avisa si el comprador registrado es el mismo cliente de la cita.
2. **Visita próxima**: X minutos antes de cada cita activa. Por defecto son 60, se configuran en Ajustes → Agenda y se pueden apagar.
3. **El cliente confirmó** con el botón del recordatorio.
4. **Tu cita cambió**: otra persona la movió de hora o la canceló.
5. **Te quitaron una cita**: se reasignó a otro asesor (aviso al asesor anterior).
6. **Asistencia sin marcar**: al cierre del horario del día, un solo aviso con las citas de ese día que siguen sin marcar.

**Aviso a la gerencia**
7. **No asistió**: cuando una cita se marca como «no asistió», aviso a owner y admin, salvo a quien la marcó.

**Indicadores**
- Bloque nuevo en el panel, visible para owner y admin, que usa el selector de período del panel (7, 30 y 90 días). Muestra por asesor: citas, asistió, no asistió, sin marcar, porcentaje de asistencia y ventas que vinieron de una visita.

**Fuera de alcance**: que el bot agende, mover etapas del embudo y mensajes nuevos al cliente.

## Capabilities

### New Capabilities
- `appointment-lifecycle-alerts`: los avisos 1 y 3 a 7. Cuándo se crea cada uno, para quién, a quién no se avisa y a dónde lleva el aviso.
- `appointment-pre-visit-alert`: el aviso de visita próxima y su ajuste.
- `appointment-attendance-metrics`: los indicadores de asistencia y ventas de visita por asesor y período.

### Modified Capabilities
Ninguna. Este cambio se monta sobre `agenda-citas`, que todavía no está archivado, y le agrega requisitos en capacidades propias en vez de modificar las suyas.

## Impact

- **Dependencia**: requiere `agenda-citas` (migración 548). Se despliegan juntos o este va después.
- **Base de datos**: migración `549_appointment_alerts.sql`, que incluye:
  - siete tipos nuevos en el CHECK de `notifications.type`, conservando todos los anteriores;
  - columnas `pre_visit_alerted_at` y `attendance_reminded_at` en `appointments`, y `pre_visit_alert_minutes` en `appointment_settings`;
  - triggers sobre `appointments` e `inventory_vehicles`;
  - las RPC de reclamo y la RPC de indicadores `appointment_attendance_metrics`.
- **Código**: dos pasadas nuevas en `src/lib/appointments/cron.ts` (no hace falta una línea nueva en el crontab), el campo en `appointment-settings.tsx`, los íconos y destinos en `notificationHref` y en la campana, y un componente nuevo en el panel.
- **Sin** plantillas de Meta ni mensajes al cliente.
