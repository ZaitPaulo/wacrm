## 1. Base de datos

- [x] 1.1 Prueba SQL (RLS con usuario real) para `push_subscriptions`: aislamiento por usuario, `anon` rechazado
- [x] 1.2 Migración 540 `push_subscriptions`: tabla, índices, `REVOKE`/`GRANT`, RLS y políticas
- [x] 1.3 Prueba SQL de `new_message`: entrante asignado crea aviso, ráfaga refresca la misma fila, sin asesor/saliente no crea, adjunto sin texto
- [x] 1.4 Migración 541: tipo `new_message`, índice único parcial, trigger `on_customer_message_notify` en `messages`
- [x] 1.5 Prueba SQL del despacho: reclamo idempotente por versión, barrido con ventana 20 s–15 min, trigger llama a `pg_net` solo con Vault configurado
- [x] 1.6 Migración 542: `push_notification_dispatches`, RPCs de reclamo (solo `service_role`), `configure_push_dispatch`, trigger `pg_net` en `notifications`
- [x] 1.7 Aplicar 540–542 en el stack local y correr las pruebas SQL

## 2. Servidor

- [x] 2.1 Dependencia `web-push` (+ `@types/web-push`)
- [x] 2.2 `src/lib/push/payload.ts` con pruebas: tag, renotify, url, topic, recorte
- [x] 2.3 `src/lib/push/config.ts` y `secret.ts` con pruebas: VAPID desde env, comparación en tiempo constante
- [x] 2.4 `src/lib/push/send.ts` con pruebas: envío a las suscripciones del destinatario, borrado en 404/410, registro de éxito
- [x] 2.5 `GET /api/push/config` con prueba
- [x] 2.6 `POST`/`DELETE /api/push/subscriptions` con pruebas (validación, reasignación de endpoint, borrado propio)
- [x] 2.7 `POST /api/push/test` con pruebas (solo el endpoint propio)
- [x] 2.8 `POST /api/push/dispatch` con pruebas (401/503, reclamo idempotente, envío)
- [x] 2.9 `GET /api/push/cron` con pruebas (secreto de cron, barrido)
- [x] 2.10 Tipos: `NotificationType` con `new_message`, `PushSubscriptionRow`

## 3. PWA y service worker

- [x] 3.1 Iconos 192/512/maskable/apple-touch generados desde `src/app/icon.png`
- [x] 3.2 Manifest en `/app.webmanifest` enlazado solo desde `(dashboard)` y `(auth)`, con metadatos de Apple
- [x] 3.3 `public/sw.js`: push (visible → omitir salvo WebKit o prueba), notificationclick (enfocar/abrir), install/activate; lógica pura probada en `src/lib/push/sw-logic`
- [x] 3.4 Cabeceras de `/sw.js` en `next.config.ts` (no-cache)

## 4. Interfaz

- [x] 4.1 `src/lib/push/client.ts` con pruebas: detección de soporte (no compatible / iOS sin instalar / WebKit), conversión de clave
- [x] 4.2 Hook `usePushSubscription` (estado, activar, desactivar, prueba)
- [x] 4.3 Tarjeta `PushNotificationsCard` móvil primero con todos sus estados y prueba de render
- [x] 4.4 Página de notificaciones: tarjeta, icono de `new_message`
- [x] 4.5 Avisos dentro de la app: lógica pura `shouldAlertInApp` con pruebas, hook en el shell, sonido Web Audio, toast con "Abrir"
- [x] 4.6 Bandeja: al abrir una conversación marcar leídas sus `new_message` y cerrar su aviso del sistema (implementado en `InAppNotificationAlerts`, leyendo `?c=`, sin tocar `inbox/page.tsx`)
- [x] 4.7 Cerrar sesión borra la suscripción del dispositivo
- [x] 4.8 Textos en `messages/es.json`, `en.json`, `ko.json`

## 5. Despliegue y documentación

- [x] 5.1 `.env.local.example` y `deploy/.env.example` con las variables VAPID y `PUSH_DISPATCH_SECRET`
- [x] 5.2 `deploy/cron/crontab`: barrido `/api/push/cron` cada minuto
- [x] 5.3 Paso de despliegue (Vault, claves de producción) documentado en design

## 6. Verificación

- [x] 6.1 `npx vitest run --no-file-parallelism` en verde
- [x] 6.2 `npx tsc --noEmit` limpio
- [x] 6.3 Prueba de punta a punta en local: asignación y mensaje entrante → pg_net → despacho → push recibido y descifrado por un receptor simulado (11/11) y barrido por cron (4/4)
- [ ] 6.4 Pendiente: push real en un navegador (Chrome Android / iPhone instalado), requiere que una persona conceda el permiso
