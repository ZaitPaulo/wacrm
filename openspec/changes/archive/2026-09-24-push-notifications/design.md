## Context

Hoy la tabla `notifications` (027) tiene un solo tipo, `conversation_assigned`, que llena el trigger `notify_conversation_assigned` (redefinido en 521 y 527) en **todo** cambio de `conversations.assigned_agent_id`, venga de donde venga. La campana del sidebar y `/notifications` la leen por Realtime. No hay sonido, ni aviso emergente, ni service worker, ni manifest.

Restricciones que condicionan el diseño:

- Las asignaciones ocurren por muchos caminos (traspaso de la IA, automatizaciones, flujos, bandeja, API v1, SQL a mano y un job programado que está construyendo otro equipo en paralelo). Cualquier solución que dependa de que cada camino "se acuerde" de enviar el push se rompe con el próximo camino.
- Producción es un VPS con Supabase autoalojado; app, base y cron son contenedores vecinos en la red Docker `loramotors`. El DNS externo del contenedor ya falló una vez y perdió mensajes (ver memoria `perdida-de-mensajes-whatsapp-2026-09`).
- En el VPS `pg_default_acl` concede todos los privilegios a `anon` en toda tabla nueva: la seguridad descansa en RLS y en `REVOKE` explícitos.
- Los asesores trabajan sobre todo desde el celular (Android con Chrome, algunos iPhone).
- `NEXT_PUBLIC_*` se hornea en la imagen en tiempo de compilación.

## Goals / Non-Goals

**Goals:**
- Aviso con sonido en el sistema operativo aunque el CRM esté cerrado, por cada asignación y por cada mensaje entrante de conversaciones asignadas al destinatario.
- Latencia < 5 s entre el evento y la entrega al servicio de push.
- Cobertura de todos los caminos sin tocarlos uno por uno.
- Un aviso por conversación, que vuelve a sonar con cada mensaje.
- Con el CRM visible: aviso dentro de la app con sonido, sin duplicar.
- Interfaz de activación honesta sobre las limitaciones de cada plataforma.

**Non-Goals:**
- Preferencias por tipo de aviso, horarios de silencio o sonidos personalizados.
- Avisos a supervisores por conversaciones de otros; avisos por conversaciones sin asesor.
- Funcionamiento sin conexión (caché offline) de la PWA: el service worker no intercepta `fetch`.
- Apps nativas (FCM/APNs directos).

## Decisions

### D1. Web Push estándar con VAPID (Push API + service worker)

Es el único mecanismo que entrega con el navegador cerrado sin una app nativa. Chrome/Edge (FCM), Firefox (Mozilla autopush) y Safari/iOS 16.4+ (Apple Web Push) aceptan el mismo protocolo: RFC 8030 + cifrado RFC 8291 + VAPID RFC 8292. Alternativas descartadas: FCM directo (atado a Google, iOS no lo recibe en web), apps nativas (fuera de alcance y de presupuesto).

### D2. Mecanismo de envío: trigger en `notifications` + `pg_net` hacia una ruta interna

**Evidencia (VPS, solo lectura, 2026-09-23):**
- `pg_net` 0.20.3 instalado en el esquema `extensions`, en `shared_preload_libraries`, y su proceso `pg_net 0.20.3 worker` corriendo (`pg_stat_activity`).
- `supabase_vault` 0.3.1 instalado; `postgres` tiene `EXECUTE` sobre `net.http_post`.
- `supabase-db`, `wacrm-app-1` y `crm-cron` están en la misma red Docker `loramotors`; desde el contenedor de la base `getent hosts app` resuelve `172.18.0.2` y `curl http://app:3000/login` responde **200 en 0,02 s**. El camino no toca DNS externo, TLS ni Caddy.
- En el stack local también están `pg_net` 0.20.3 y `supabase_vault` 0.3.1.

**Cómo funciona:** un trigger `AFTER INSERT OR UPDATE OF created_at ON notifications` llama a `net.http_post(<url>, {notification_id}, {x-push-secret})`. `pg_net` encola la petición en una tabla dentro de la transacción y su worker la envía **después del commit** (si la asignación hace rollback, no sale nada) sin bloquear la transacción. La ruta `/api/push/dispatch` reclama la notificación y envía con `web-push`. Latencia esperada: el worker drena la cola continuamente, típicamente < 1 s; más el envío a FCM/Apple.

**Por qué sobre las alternativas:**
- *Enviar desde el código de la app*: exige tocar cada camino (y el job del otro equipo, y el SQL a mano nunca pasaría). Justo lo que el requerimiento prohíbe.
- *Drenado periódico por cron*: el cron del VPS tiene resolución de 1 minuto (busybox crond); latencia media 30 s, máxima 60 s. No cumple < 5 s. Un bucle en el proceso Node con `LISTEN/NOTIFY` o sondeo cada segundo sí cumpliría, pero añade un proceso de larga vida que la app Next no tiene hoy y que muere con cada despliegue.
- *Realtime escuchado por el servidor*: mismo problema de proceso de larga vida, y Realtime no garantiza entrega.

**Complemento — barrido de respaldo:** `pg_net` es "dispara y olvida": si la app se está reiniciando (despliegue) la petición falla y nadie reintenta. Por eso `/api/push/cron` (cada minuto en el cron existente) reclama las versiones de notificación sin envío registrado con antigüedad entre 20 s y 15 min. El piso de 20 s evita competir con el despacho normal; el techo de 15 min evita que un despliegue largo termine sonando con avisos viejos.

**Configuración sin secretos en migraciones:** la URL y el secreto de despacho viven en Supabase Vault con los nombres `push_dispatch_url` y `push_dispatch_secret`, cargados con la función `configure_push_dispatch(url, secret)` (solo `postgres`/`service_role`). Sin ellos el trigger no hace nada y el barrido por cron sigue entregando con ≤ 1 min: la degradación es de latencia, no de pérdida.

### D3. Idempotencia por "versión" de notificación, en una tabla aparte

Una notificación `new_message` se refresca (UPDATE de `title`, `body`, `created_at`) con cada mensaje mientras siga sin leer; cada refresco es una nueva **versión** `(id, created_at)` que merece su push. `push_notification_dispatches (notification_id, notified_at)` con clave primaria compuesta registra qué versiones se enviaron: reclamar = `INSERT … ON CONFLICT DO NOTHING`. Si el despacho llega repetido o el barrido coincide, solo gana uno.

Se descartó una columna `push_sent_at` en `notifications`: cada reclamo sería un UPDATE que Realtime reenvía a la campana y a la página, y el contador interpreta los UPDATE como "marcar leído".

Los RPCs `claim_notification_push(uuid)` y `claim_pending_notification_pushes(int)` son `SECURITY INVOKER`, con `EXECUTE` revocado a `PUBLIC`, `anon` y `authenticated` y concedido solo a `service_role`. El barrido usa `FOR UPDATE SKIP LOCKED` y poda registros de más de 2 días.

### D4. `new_message` nace en un trigger sobre `messages`, con una fila por conversación sin leer

`AFTER INSERT ON messages FOR EACH ROW WHEN (NEW.sender_type = 'customer')`. Busca el asesor asignado; si no hay, no hace nada. Hace un upsert contra un índice único parcial `(user_id, conversation_id) WHERE type = 'new_message' AND read_at IS NULL`: la primera vez inserta y las siguientes refrescan la misma fila. Así la campana cuenta conversaciones con mensajes pendientes, no mensajes. El guardado del mensaje es idempotente (índice único de la 037), así que una reentrega de Meta no duplica avisos. Todo el cuerpo del trigger va en `EXCEPTION WHEN OTHERS → WARNING`: un aviso nunca puede costar un mensaje.

El título es "Mensaje de <contacto>" y el cuerpo, el texto recortado a 140 caracteres o la etiqueta del adjunto ("Foto", "Audio", …).

### D5. Payload y reemplazo

- `tag = conversation-<id>` + `renotify: true`: los mensajes seguidos reemplazan el aviso del sistema y vuelven a sonar/vibrar. Asignación y mensajes de la misma conversación comparten `tag` (una notificación por conversación, como pidió el Tech Lead).
- Cabecera `Topic` = id de la conversación sin guiones (32 caracteres, alfabeto válido): el servicio de push reemplaza los avisos aún no entregados de la misma conversación (celular apagado).
- `Urgency: high` y `TTL` de 1 hora: un aviso de hace más de una hora ya no sirve como alarma.
- El payload lleva `title`, `body`, `tag`, `url`, `notificationId`, `type`.

### D6. Sin duplicados con el CRM abierto

- El aviso emergente de la app nace de **Realtime** (el mismo canal que ya usa la campana), no del push: funciona aunque el dispositivo no haya activado los avisos del sistema.
- El service worker no muestra el aviso del sistema si hay una ventana del CRM **visible**. Chrome no penaliza omitirlo en ese caso; con la ventana oculta siempre lo muestra.
- **Excepción WebKit** (Safari de macOS, todo iOS): Apple revoca la suscripción si un push no muestra aviso. Allí el service worker siempre lo muestra, y la app, si detecta WebKit con este dispositivo suscrito, se abstiene de su aviso emergente y su sonido.
- El sonido de la app es un tono corto generado con Web Audio (sin archivo). Si el navegador bloquea el audio por falta de gesto previo, se omite en silencio.

### D7. Clave pública por API, no por `NEXT_PUBLIC_*`

`GET /api/push/config` devuelve `{ enabled, publicKey }` leyendo `VAPID_PUBLIC_KEY` en ejecución. Así rotar las claves solo requiere reiniciar la app, no recompilar la imagen (mismo criterio que `SUPABASE_INTERNAL_URL`).

### D8. Dependencia nueva: `web-push`

Cifrar un payload de Web Push exige ECDH P-256 + HKDF + AES-128-GCM con el formato `aes128gcm` de RFC 8188/8291 y firmar un JWT ES256 para VAPID. Implementarlo a mano sería código criptográfico propio, justo lo que no conviene escribir. `web-push` es la implementación de referencia (la usa la guía oficial de PWAs de Next.js), madura, sin dependencias nativas y solo corre en el servidor. Se añade también `@types/web-push` como dependencia de desarrollo.

### D9. Manifest solo en el CRM

`src/app/manifest.ts` (la convención de Next) enlaza el manifest en **todas** las páginas, vitrina pública incluida, y Chrome podría ofrecerle "instalar el CRM" a un comprador de autos. Por eso el manifest se sirve desde un route handler en `/app.webmanifest` y se enlaza con `metadata.manifest` solo en los layouts `(dashboard)` y `(auth)`. `start_url: /inbox`, `scope: /`, `display: standalone`. Iconos 192/512 (y 512 `maskable`) y `apple-touch-icon` de 180 generados desde `src/app/icon.png`.

`/sw.js` se sirve con `Cache-Control: no-cache` y alcance `/`: la cabecera general de páginas (`s-maxage=300`) retrasaría 5 min cada actualización del service worker.

### D10. Suscripciones y privacidad

`push_subscriptions (id, user_id, account_id, endpoint UNIQUE, p256dh, auth, user_agent, created_at, updated_at, last_success_at)`. `REVOKE ALL FROM anon, authenticated`, luego `GRANT SELECT, DELETE` a `authenticated` y `ALL` a `service_role`, RLS con políticas `user_id = auth.uid()`. La escritura va por `POST /api/push/subscriptions` con service-role tras validar la sesión, porque re-registrar un endpoint que estaba a nombre de otro usuario (navegador compartido) exige tocar una fila ajena, que la RLS impediría. Cerrar sesión borra la suscripción del dispositivo: los avisos traen texto de clientes.

### D11. Lista blanca de servicios de push (anti-SSRF)

El servidor hace un POST al `endpoint` que manda el navegador. Sin control, un usuario con sesión podría registrar `http://api-gw:8000/...` o `http://app:3000/...` y usar el servidor para golpear la red interna. `POST /api/push/subscriptions` solo acepta `https` sin puerto hacia FCM (`fcm.googleapis.com`, `android.googleapis.com`), Mozilla (`*.push.services.mozilla.com`), Apple (`*.push.apple.com`) y WNS (`*.notify.windows.com`), que son los únicos que entregan los navegadores reales.

### D12. La bandeja no se toca

Marcar leídos los `new_message` de la conversación abierta y cerrar su aviso del sistema se hace en `InAppNotificationAlerts` (montado en el shell), que lee la conversación abierta de `?c=`. La bandeja ya refleja la selección en la URL, así que no hace falta modificar `inbox/page.tsx`, que otro equipo está cambiando en paralelo.

## Variables de entorno

| Variable | Dónde | Para qué |
|---|---|---|
| `VAPID_PUBLIC_KEY` | app | Clave pública VAPID (base64url). La recibe el navegador por `/api/push/config`. |
| `VAPID_PRIVATE_KEY` | app | Clave privada VAPID. Secreta. |
| `VAPID_SUBJECT` | app | Contacto para los servicios de push: `mailto:…` o `https://…`. |
| `PUSH_DISPATCH_SECRET` | app + Vault | Secreto de la ruta interna `/api/push/dispatch`. |
| `AUTOMATION_CRON_SECRET` | app + cron | Ya existía; protege también `/api/push/cron`. |

Vault (en la base): `push_dispatch_url` = `http://app:3000/api/push/dispatch` en el VPS; `push_dispatch_secret` = el mismo valor de `PUSH_DISPATCH_SECRET`.

## Migration Plan

1. Generar claves de producción en el VPS (no reutilizar las de desarrollo):
   `docker exec wacrm-app-1 node -e "console.log(require('web-push').generateVAPIDKeys())"` y `openssl rand -hex 32` para el secreto. Añadir `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:<correo del negocio>` y `PUSH_DISPATCH_SECRET` a `deploy/.env` (y a la copia en `Secretos`).
2. Respaldo, `git pull`, aplicar migraciones 540–542 (`./scripts/apply-migrations.sh --dry-run` antes: confirmar que las tres aparecen como pendientes).
3. Configurar Vault una vez, como `postgres`:
   `select configure_push_dispatch('http://app:3000/api/push/dispatch', '<PUSH_DISPATCH_SECRET>');`
4. Reconstruir la app y reiniciar `cron` (el crontab cambió).
5. Verificar: activar avisos desde un celular, "Enviar aviso de prueba", asignarse una conversación de prueba desde otra cuenta; en la base, `select status_code, count(*) from net._http_response group by 1` debe mostrar 200.

**Rollback:** `select configure_push_dispatch(null, null)` apaga el despacho inmediato; quitar la línea de `/api/push/cron` del crontab apaga el barrido. Las migraciones son aditivas (el tipo `new_message` puede quedarse; para dejar de generarlo, `DROP TRIGGER on_customer_message_notify ON messages`).

**Rotación de claves VAPID:** invalida todas las suscripciones (los servicios de push rechazan con 403/410 lo firmado con otra clave). Tras rotar, cada asesor debe reactivar los avisos en su dispositivo; las viejas se limpian solas con los 410.

## Risks / Trade-offs

- **[iPhone sin instalar no recibe nada]** → la tarjeta lo explica con los pasos para agregar a inicio; es una limitación de Apple, no del CRM.
- **[El asesor bloquea el permiso por error]** → el navegador no deja volver a preguntar; la tarjeta explica cómo desbloquear desde los ajustes del sitio.
- **[Android con ahorro de batería agresivo retrasa FCM]** → fuera de nuestro control; `Urgency: high` ayuda.
- **[pg_net pierde la petición si la app está caída]** → barrido cada minuto hasta 15 min.
- **[Ráfagas grandes de mensajes]** → una fila por conversación y `Topic` en el servicio de push; el despacho es una petición HTTP interna por mensaje, barata.
- **[Duplicado en WebKit con el CRM abierto sin suscripción en ese dispositivo]** → no aplica: si no hay suscripción no hay push; si la hay, la app se abstiene.
- **[Autoplay bloquea el sonido de la app]** → se intenta y se omite en silencio; el aviso emergente se ve igual.
- **[`net._http_response` guarda las respuestas]** → `pg_net.ttl` es 6 h en el VPS; no crece sin límite.

## Open Questions

- ¿El dueño/admin quiere recibir también avisos de conversaciones que no tiene asignadas? Hoy no (decisión del Tech Lead). Se podría añadir como preferencia.
- ¿Silenciar fuera del horario de atención (523 `business_hours`)? No pedido.
