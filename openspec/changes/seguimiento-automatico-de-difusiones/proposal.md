## Why

El 2026-09-14 el negocio necesita preguntarles a unos 90 dueños de vehículos en venta con LoraMotors si su carro sigue disponible —plantilla `consulta_vehiculo_disponible`, botones SI / NO— para depurar el inventario que ofrecen la vitrina y el bot. Parte no va a contestar, y hoy el CRM no tiene cómo recordárselo solo: ninguna automatización se dispara cuando sale una difusión, y aunque se disparara, su paso "enviar plantilla" exige una conversación que la difusión no crea (`/api/whatsapp/broadcast` no escribe en la base). Justo quien nunca respondió es quien no tiene conversación.

La alternativa manual —una segunda difusión a los 2 o 3 días excluyendo a quien ya contestó— depende de que alguien se acuerde y de haber etiquetado a todo el que respondió. Es el tipo de tarea que se olvida, y un recordatorio que sale una semana tarde ya no sirve.

## What Changes

- Una difusión puede llevar un **seguimiento**: una plantilla aprobada y un plazo en días. Vencido el plazo, a cada destinatario al que le llegó el mensaje y que no ha respondido se le envía esa plantilla **una sola vez**.
- "No ha respondido" significa que el contacto no escribió nada después del envío original. Se comprueba contra sus mensajes, no solo contra el estado `replied` del destinatario, porque ese estado se marca únicamente en la difusión más reciente del contacto.
- Los recordatorios salen del servidor, por el cron que ya corre en el VPS; no dependen de que alguien tenga abierta la pestaña del asistente.
- Son envíos por iniciativa propia, así que **respetan el horario de atención** de la cuenta: fuera de horario esperan a la próxima apertura.
- El último paso del asistente de difusión permite activar el seguimiento (plantilla y plazo). El detalle de la difusión muestra cuántos recordatorios faltan, cuántos salieron y cuántos contactos respondieron después, y permite **cancelar** los que faltan.
- La respuesta a un recordatorio cuenta como respuesta a la difusión original: sus métricas no se parten en dos.

**Fuera de alcance**

- Más de un recordatorio por difusión (cadenas de seguimiento).
- Seguimiento en difusiones creadas por la API pública (`/api/v1/broadcasts`).
- Que los envíos de difusión aparezcan como mensajes en la bandeja. Es una limitación que ya tienen las difusiones y este cambio no la resuelve.
- Plantillas de seguimiento con encabezado multimedia o con botones que piden valores al enviar.

## Capabilities

### New Capabilities

- `broadcast-follow-up`: el recordatorio automático de una difusión — cómo se configura, a quién le llega y a quién no, cuándo sale, cuántas veces, cómo se cancela y cómo se refleja en las métricas de la difusión.

### Modified Capabilities

Ninguna. No existe una spec de difusiones, y las capacidades vecinas (`inbound-response-ownership`, `ai-reply-gating`) no cambian sus requisitos: la respuesta a un recordatorio es un entrante más, sujeto a las mismas reglas.

## Impact

- **Migración nueva**: columnas de configuración del seguimiento en `broadcasts` y de estado del recordatorio en `broadcast_recipients`, con un índice para encontrar los que vencen. El número debe ser uno que no exista ni en `develop` ni en `main` (dos migraciones con el mismo número se saltan en silencio al desplegar).
- **Módulo nuevo** en `src/lib/whatsapp/` que elige, reclama y envía los recordatorios, reutilizando el envío con variantes de teléfono de `broadcast-core.ts` y la resolución de destino de `resolveRecipientId`.
- **Ruta de cron nueva** para los recordatorios, y su línea en `deploy/cron/crontab` (mismo `tick.sh`, mismo `AUTOMATION_CRON_SECRET`). Desplegar exige recrear el contenedor del cron para que lea el crontab nuevo.
- `src/lib/outbound/`: la comprobación de horario de atención que ya usan las automatizaciones.
- `src/hooks/use-broadcast-sending.ts`: guarda la configuración del seguimiento al crear la difusión.
- `src/components/broadcasts/step4-schedule-send.tsx` y `src/app/(dashboard)/broadcasts/new/page.tsx`: la opción en el asistente.
- `src/app/(dashboard)/broadcasts/[id]/page.tsx`: el estado del seguimiento y el botón de cancelar.
- `src/types/index.ts` y los mensajes de traducción (es / en).
- **Meta**: la plantilla del recordatorio tiene que estar aprobada antes de crear la difusión. Para que las respuestas se clasifiquen igual que las de la plantilla original, conviene que use los mismos botones.
