## Why

Lora Motors pidió ver en un calendario las visitas al concesionario que tiene agendadas cada asesor. Hoy el bot traspasa al asesor cuando el cliente quiere ir (`motivo=visita`), pero el día y la hora quedan sueltos en el chat: nadie sabe quién viene mañana ni con qué asesor, y no se puede medir cuántos de los que agendan llegan. El cliente aprobó la propuesta enviada el 2026-10-07; esta rama implementa sus fases 1 y 2.

## What Changes

**Fase 1: Agenda**
- Tabla nueva de citas (`appointments`): contacto, conversación, asesor, inicio, duración (30 min por defecto, editable), motivo, vehículos de interés del inventario, notas y estado.
- Estados: `scheduled` (programada), `confirmed` (confirmada), `attended` (asistió), `no_show` (no asistió), `cancelled` (cancelada). Una cita reagendada vuelve a `scheduled` con fecha nueva y deja el cambio en su historial.
- Sección nueva **Agenda** en el menú lateral, con vista Día (una columna por asesor), Semana y Mes, navegación por fechas y filtro por asesor. Las franjas son de 30 minutos y respetan el horario de atención de la cuenta.
- Crear citas de dos maneras: con el botón «Agendar visita» en la conversación (cliente, asesor y vehículos precargados) o con un clic en una franja libre del calendario. El formulario solo ofrece las horas libres del asesor.
- Mover una cita arrastrándola a otra hora, o a otro asesor si quien la mueve es admin u owner.
- La ficha del contacto en la bandeja muestra su próxima cita y las anteriores.
- Permisos con la misma regla de visibilidad que las conversaciones: el asesor ve y edita solo sus citas; owner y admin ven, editan y reasignan todas; viewer ve todas sin editar.

**Fase 2: Recordatorios y avisos**
- Confirmación por WhatsApp al crear o reagendar la cita: texto libre si la ventana de 24 h está abierta y, si no, una plantilla configurada.
- Recordatorio el día anterior con una plantilla de botones «Confirmo» y «Necesito cambiar la hora». Sale dentro del horario de atención, a la hora configurada.
- Tocar «Confirmo» pasa la cita a `confirmed` sin intervención del asesor y responde con un acuse. Tocar «Necesito cambiar la hora» avisa al asesor para que la reagende. Ninguno de los dos botones pasa por el bot de IA.
- Avisos al asesor dentro del CRM y por push: cuando se le asigna una cita, cuando el cliente pide cambiarla y, cada mañana, la lista de sus visitas del día.
- En Ajustes, una sección de Agenda para activar los mensajes al cliente, elegir las dos plantillas y la hora del recordatorio y del resumen diario.

**Fuera de alcance (fase 3 u otros cambios):** que el bot agende solo, mover el negocio a una etapa de «Visita agendada», el aviso de carro vendido antes de la visita, los indicadores de asistencia y la sincronización con Google Calendar u Outlook.

## Capabilities

### New Capabilities
- `appointment-scheduling`: modelo de cita, estados y transiciones, franjas libres por asesor dentro del horario de atención, creación, reagendado, reasignación y permisos por rol.
- `appointment-calendar`: sección Agenda con vistas Día, Semana y Mes, filtro por asesor, arrastrar para mover, botón «Agendar visita» en la conversación y citas en la ficha del contacto.
- `appointment-customer-messages`: confirmación y recordatorio por WhatsApp, botones de respuesta del cliente y su efecto sobre la cita, y la configuración de plantillas y horas.
- `appointment-agent-alerts`: notificaciones y push al asesor por cita asignada, por pedido de cambio y por el resumen diario de visitas.

### Modified Capabilities
- `in-app-notification-alerts`: tocar un aviso de cita lleva a la Agenda en la fecha de la cita, no a la bandeja.

## Impact

- **Base de datos**: migración `548_appointments.sql` (hay que confirmar el número contra el VPS antes de aplicarla), con las tablas `appointments`, `appointment_events` y `appointment_settings`, la RLS basada en `conversation_visible`, los GRANT y REVOKE explícitos, tipos nuevos en el CHECK de `notifications.type` y las RPC de reclamo para los crons.
- **API**: rutas de cron nuevas `/api/appointments/reminders/cron` y `/api/appointments/digest/cron`, y una ruta server-only para enviar la confirmación.
- **Entrada de mensajes**: `src/lib/inbound/core.ts` atiende los botones con payload `cita:` antes de flujos, automatizaciones y bot.
- **UI**: página `src/app/(dashboard)/agenda`, entrada en el sidebar, `contact-sidebar.tsx`, `message-thread.tsx` (botón), una sección en Ajustes y textos en `messages/{es,en,ko}.json`.
- **Push**: `src/lib/push/payload.ts` (URL de los avisos de cita) y `public/sw.js` si hiciera falta.
- **Despliegue**: dos líneas nuevas en `deploy/cron/crontab`, con reinicio del contenedor del cron. Las dos plantillas tienen que estar aprobadas por Meta antes de activar los mensajes al cliente.
- **Dependencias**: ninguna nueva. Se reutilizan `@dnd-kit/core`, `date-fns`, `vehicle-picker.tsx` y `src/lib/outbound/business-hours.ts`.
