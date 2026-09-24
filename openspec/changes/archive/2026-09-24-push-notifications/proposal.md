## Why

Los asesores de LoraMotors se enteran de un cliente nuevo o de un mensaje solo si tienen el CRM abierto y miran la campana: no suena, no hay aviso emergente y con el CRM cerrado no llega nada. El 2026-09 medimos que el 32 % de los traspasos del bot quedan sin atender, y el cuello de botella es justamente el asesor que no se entera a tiempo. El cliente pide un aviso sonoro que llegue aunque el CRM esté cerrado, por cada mensaje y por cada asignación.

## What Changes

- **Avisos del sistema operativo con el CRM cerrado (Web Push estándar).** El servidor envía un push cifrado (VAPID) a cada dispositivo que el asesor haya activado; un service worker lo muestra con sonido/vibración. Funciona en Chrome/Edge/Firefox de escritorio y en Chrome de Android sin instalar nada; en iPhone solo con el CRM agregado a la pantalla de inicio (iOS 16.4+).
- **El CRM se vuelve instalable (PWA).** Manifest propio, iconos y metadatos de Apple, enlazados solo desde las pantallas del CRM y el login, no desde la vitrina pública.
- **Nuevo tipo de notificación `new_message`.** Cada mensaje entrante de un cliente en una conversación asignada crea (o refresca) una notificación para el asesor asignado. Los mensajes de conversaciones sin asesor no avisan a nadie. Mientras el asesor no la lea, los mensajes siguientes de la misma conversación refrescan esa misma fila en vez de apilar una por mensaje.
- **Envío que cubre todos los caminos.** Un trigger sobre `notifications` pide el envío a una ruta interna de la app por `pg_net` (red interna de Docker, sin DNS externo). Así cualquier asignación o mensaje —bot, automatizaciones, flujos, bandeja, API v1, SQL, jobs futuros— dispara el push sin que ese camino lo sepa. Un barrido por el cron existente reintenta lo que se haya quedado sin enviar (app reiniciándose, etc.).
- **Una notificación por conversación.** El aviso del sistema usa `tag` por conversación con `renotify`, así los mensajes seguidos reemplazan el aviso y vuelven a sonar. Tocarlo abre la conversación en la bandeja o enfoca la pestaña que ya estaba abierta.
- **Con el CRM abierto y visible**, aviso emergente dentro de la app con un sonido corto, sin duplicar con el del sistema.
- **Suscripciones por dispositivo**: tabla nueva `push_subscriptions` con RLS; se borra sola cuando el servicio de push responde 404/410, y al cerrar sesión en ese dispositivo.
- **Tarjeta "Avisos en este dispositivo"** en la página de notificaciones: activar (el permiso se pide solo tras un clic), estado (activado / bloqueado con instrucciones / no compatible / iPhone sin instalar), "Enviar aviso de prueba" y desactivar.
- Al abrir una conversación en la bandeja se marcan leídos sus avisos de mensaje nuevo y se cierra el aviso del sistema de esa conversación.
- **Dependencia nueva**: `web-push` (cifrado RFC 8291 y firma VAPID RFC 8292).

## Capabilities

### New Capabilities

- `push-notification-delivery`: qué eventos generan aviso y para quién (asignaciones y mensajes entrantes de conversaciones asignadas), cómo se envían sin depender del camino que los originó, idempotencia, reintento y limpieza de suscripciones muertas.
- `push-notification-subscription`: registro de dispositivos, la tarjeta de activación con sus estados, el aviso de prueba, la instalación como PWA y las limitaciones por plataforma.
- `in-app-notification-alerts`: el comportamiento con el CRM abierto (aviso emergente y sonido, sin duplicar con el del sistema) y el comportamiento al tocar un aviso.

### Modified Capabilities

Ninguna: no hay spec previa de notificaciones en `openspec/specs/`.

## Impact

**Base de datos** (migraciones 540–542):
- `push_subscriptions` (nueva) con RLS, `REVOKE` y `GRANT` explícitos.
- `notifications.type` admite `new_message`; índice único parcial para una sola notificación de mensaje sin leer por asesor y conversación.
- Trigger `AFTER INSERT` en `messages` (entrantes de cliente) y trigger `AFTER INSERT OR UPDATE OF created_at` en `notifications` que llama a `pg_net`.
- `push_notification_dispatches` (registro de envíos, para idempotencia y barrido) y RPCs de reclamo solo para `service_role`.
- La URL y el secreto de la ruta interna viven en Supabase Vault, no en migraciones.

**Código**:
- Rutas nuevas bajo `src/app/api/push/` (config, suscripciones, prueba, despacho interno, barrido por cron).
- `src/lib/push/*` (armado del aviso, envío con `web-push`, secretos).
- `public/sw.js`, manifest `src/app/app.webmanifest/route.ts`, iconos en `public/icons/`.
- Página de notificaciones, shell del dashboard (avisos en la app), bandeja (marcar leídos), cierre de sesión.
- `next.config.ts` (cabeceras de `/sw.js`), `deploy/cron/crontab`, `.env.local.example`, `deploy/.env.example`.

**Configuración nueva**: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_DISPATCH_SECRET`, y dos secretos de Vault (`push_dispatch_url`, `push_dispatch_secret`).
