## Context

El repo trae un `Dockerfile` y un `docker-compose.yml` que solo levantan el app. `docs/docker.md` lo dice sin rodeos: _"Supabase is external — point the app at your hosted (or self-hosted) Supabase project via env vars; no database container is included."_ Este cambio construye ese "self-hosted Supabase project" que la documentación da por supuesto.

**Lo que el app le pide a Supabase** (verificado en el código, no asumido):

| Servicio | Dónde se usa | ¿Obligatorio? |
|---|---|---|
| Postgres 17 | 53 migraciones en `supabase/migrations/`, extensiones `uuid-ossp` y `vector` | Sí |
| PostgREST | `src/lib/supabase/{client,server}.ts` — todo el acceso a datos | Sí |
| GoTrue (Auth) | login email/password; `auth.users` referenciado por FKs de `profiles` | Sí |
| Storage | 5 buckets: `avatars` (008), `flow-media` (016), `chat-media` (023), `contact-documents` (501), `showcase-media` (506) | Sí |
| Realtime | `postgres_changes` en `use-realtime.ts`, `use-presence.ts`, `use-total-unread.ts`, `use-unread-notifications.ts`, `use-pending-posts.ts`, `notifications/page.tsx`, `message-thread.tsx` | Sí |
| Edge Functions | — no existe `supabase/functions/` | **No** |
| Transformación de imágenes | solo se llama `getPublicUrl()`; nunca `transform` ni `createSignedUrl` | **No** |
| pg_cron / pg_net / Vault | ninguna migración los menciona | **No** |

**Restricciones que no negociamos:**

1. **Meta exige HTTPS público con certificado válido** para entregar webhooks y para descargar las imágenes que publica en Instagram.
2. **`NEXT_PUBLIC_*` se hornea en el bundle en tiempo de build** (`Dockerfile:23-33`). El dominio de Supabase se decide antes de construir la imagen, no después.
3. **La base arranca limpia.** No hay que preservar nada, lo que elimina la parte más delicada de una migración (usuarios de `auth.users`, hashes de contraseña, objetos de Storage).

## Goals / Non-Goals

**Goals:**

- Que `docker compose up -d` en un VPS limpio deje el CRM funcionando y accesible por HTTPS.
- Que ninguna línea de `src/` cambie. Si el diseño obliga a tocar el código del app, está mal.
- Que aplicar las 53 migraciones sea repetible y no requiera el CLI de Supabase en el servidor.
- Que exista un respaldo probado — probado de verdad, restaurándolo — antes de considerar el stack listo para producción.
- Que actualizar el stack de Supabase sea un cambio de tag, no una arqueología de diffs.

**Non-Goals:**

- Alta disponibilidad, réplicas o failover. Un VPS, un Postgres.
- Migrar los datos de la cuenta de producción. Es un cambio aparte, después de validar este.
- Autoalojar lo que no se puede: Graph API de Meta y los proveedores de IA.
- Kubernetes, Swarm o cualquier orquestador. Docker Compose alcanza y sobra para un nodo.

## Decisions

### 1. Dos subdominios públicos, no uno

`crm.<dominio>` → app Next.js. `supabase.<dominio>` → gateway de Supabase (Envoy, puerto 8000).

Ambos tienen que ser **públicos y con TLS válido**, y esto sorprende a mucha gente que autoaloja: no basta con que el app alcance a Supabase por la red interna de Docker.

- El navegador del usuario habla **directo** con Supabase. `src/lib/supabase/client.ts` corre en el cliente, y el WebSocket de Realtime también. Un `NEXT_PUBLIC_SUPABASE_URL` apuntando a `http://db:8000` no resuelve fuera del VPS.
- Meta **descarga** las fotos desde Storage. `src/lib/instagram/images.ts:119` genera un `getPublicUrl()` y se lo entrega a Graph API para que Meta lo busque. Si esa URL no es públicamente alcanzable por HTTPS, la publicación en Instagram falla.

*Alternativa descartada:* montar Supabase bajo un path de `crm.<dominio>` (`/supabase/...`). El gateway asume que vive en la raíz (`/rest/v1`, `/auth/v1`, `/storage/v1`, `/realtime/v1`) y reescribir todo eso en el proxy es frágil. Un subdominio cuesta un registro DNS.

### 2. Caddy como reverse proxy

TLS automático de Let's Encrypt con dos líneas de configuración, renovación incluida, sin certbot ni cron de renovación ni recarga de nginx.

*Alternativas:* Nginx + certbot (tres piezas móviles y un cron propio que falla en silencio) o Traefik (potente, pero su configuración por labels es más superficie de la que este despliegue necesita). El compose oficial de Supabase trae un perfil con certbot; lo dejamos apagado y usamos un único proxy para todo.

Caddy también resuelve dos cosas gratis: proxy del WebSocket de Realtime (lo hace por defecto) y protección de Studio con Basic Auth.

### 3. El compose de Supabase se toma tal cual de upstream, con overlay propio

`deploy/supabase/` contiene el `docker-compose.yml` oficial de `supabase/supabase@docker` **sin modificar**, pineado a un commit concreto. Los ajustes propios van en `deploy/supabase/docker-compose.override.yml`.

Actualizar Supabase pasa a ser: traer el compose nuevo del upstream, comparar con el anterior, y revisar si el override sigue teniendo sentido. Si editáramos el archivo original, cada actualización sería un merge a mano.

Servicios del stack oficial (versiones al día de hoy) y qué hacemos con cada uno:

| Servicio | Imagen | Decisión |
|---|---|---|
| `db` | `supabase/postgres:17.6.1.136` | **Se usa.** Coincide con `major_version = 17` de `supabase/config.toml:42` |
| `api-gw` | `envoyproxy/envoy:v1.39.0` | **Se usa.** Único puerto expuesto (8000) |
| `auth` | `supabase/gotrue:v2.189.0` | **Se usa** |
| `rest` | `postgrest/postgrest:v14.12` | **Se usa** |
| `realtime` | `supabase/realtime:v2.102.3` | **Se usa** |
| `storage` | `supabase/storage-api:v1.60.4` | **Se usa**, backend `file` sobre volumen local |
| `imgproxy` | `darthsim/imgproxy:v3.30.1` | **Se deja aunque no se use.** `storage` lo declara como dependencia; quitarlo obliga a editar el compose de upstream, que es justo lo que evitamos. Es liviano y queda ocioso |
| `meta` | `supabase/postgres-meta:v0.96.6` | **Se usa**, solo porque Studio lo necesita |
| `studio` | `supabase/studio` | **Se usa**, detrás de Basic Auth. Es la forma práctica de crear el primer usuario e inspeccionar datos |
| `functions` | `supabase/edge-runtime:v1.74.0` | **Se apaga.** No hay `supabase/functions/` |
| `supavisor` | `supabase/supavisor:2.9.5` | **Se apaga.** Es un pooler para conexiones externas; el app se conecta por PostgREST, no por Postgres directo |

Las versiones se anotan aquí porque los tags de upstream se mueven; el compose pineado es la fuente de verdad, esta tabla es el registro de la decisión.

### 4. Storage sobre volumen local, sin MinIO

Backend `file`, montado en un volumen Docker. Los archivos son fotos de vehículos y avatares: decenas de MB, no terabytes. Añadir MinIO agrega un servicio, un juego de credenciales y una fuente más de fallos a cambio de una compatibilidad S3 que nadie está usando.

*Consecuencia asumida:* el respaldo de Storage es un tar del volumen, no un `aws s3 sync`. Está contemplado en el plan de respaldo.

### 5. Claves JWT legacy (`ANON_KEY` / `SERVICE_ROLE_KEY`)

Supabase ya ofrece claves opacas (`sb_publishable_…` / `sb_secret_…`), pero el app lee `NEXT_PUBLIC_SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` y las pasa a `@supabase/ssr`. Las claves JWT firmadas con `JWT_SECRET` funcionan sin tocar una línea de código, y el objetivo explícito es no tocar `src/`.

*A futuro:* migrar a claves asimétricas es un cambio aparte, con su propia rotación.

### 6. Las migraciones se aplican con `psql`, no con el CLI de Supabase

Un script recorre `supabase/migrations/*.sql` en orden numérico, ejecuta cada uno dentro de una transacción y registra la versión aplicada en `supabase_migrations.schema_migrations` — la misma tabla que usa el CLI, para que `supabase db push` siga siendo utilizable desde una máquina de desarrollo.

Dos razones:

1. **No instalar Deno ni el CLI en el VPS.** El script corre dentro del contenedor `db`, que ya tiene `psql`.
2. **Los nombres de las migraciones no son estándar.** Son `001_…`, `030_…`, `514_…`, no los `20240115123045_…` de 14 dígitos que genera el CLI. Funciona hoy, pero es una suposición sobre el parser de versiones del CLI que no quiero en el camino crítico de un despliegue.

**Guarda previa necesaria:** `001_initial_schema.sql:413` hace `ALTER PUBLICATION supabase_realtime ADD TABLE messages`. En la nube esa publicación viene creada; en el stack autoalojado hay que **verificar en el primer arranque** que exista y crearla si no (`CREATE PUBLICATION supabase_realtime;`). El script de bootstrap la crea de forma idempotente, lo que es correcto en ambos casos. Sin esto, la migración 001 falla y no arranca nada.

### 7. Un contenedor de cron dentro del compose

Un contenedor mínimo (`alpine` + `crond`) que hace `curl` a `/api/automations/cron` y `/api/flows/cron` cada minuto por la red interna, con el header `x-cron-secret`.

*Alternativa descartada:* un systemd timer en el host. Funciona, pero vive fuera del compose: se pierde al reinstalar el servidor y no aparece en `docker compose ps` cuando algo dejó de correr.

Al ir por la red interna, estas rutas no necesitan salir a internet. `AUTOMATION_CRON_SECRET` sigue siendo obligatorio: ambas rutas devuelven 503 si no está definido.

### 8. Correo saliente: autoconfirmación ahora, SMTP externo después

GoTrue con `ENABLE_EMAIL_AUTOCONFIRM=true`, coherente con `supabase/config.toml:226` (`enable_confirmations = false`). Los usuarios se crean desde Studio o por el flujo de invitaciones del propio app (`/api/account/invitations`, que genera un link — no manda correo).

Esto deja **sin funcionar el reseteo de contraseña por correo**, y hay que mirarlo de frente porque no es solo una función ausente: `src/app/(auth)/forgot-password/page.tsx:32` llama a `resetPasswordForEmail`, y GoTrue responde éxito aunque no envíe nada — no revela qué correos existen. La página diría "revisa tu correo" y el correo no llegaría nunca. Un fallo silencioso para el usuario final.

Por eso, mientras no haya relay SMTP, la página `/forgot-password` SHALL quedar deshabilitada o mostrar el procedimiento manual, en lugar de fingir que envió algo. La contraseña se resetea desde Studio.

Autoalojar SMTP en un VPS nuevo es la peor opción disponible — sin reputación de IP, sin SPF/DKIM establecidos, el correo va directo a spam o se rechaza. Cuando haga falta, se conecta un relay externo (el propio del dominio, o cualquier proveedor transaccional). Es una decisión de una variable de entorno, no de arquitectura, y por eso no bloquea este cambio.

### 9. El app se construye en el servidor

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL` y `NEXT_PUBLIC_APP_LOCALE` se inyectan como build args (`docker-compose.yml:9-14`) y quedan dentro del bundle. Como esos valores solo se conocen cuando ya existen el dominio y las claves, la imagen se construye en el VPS.

*Consecuencia:* cambiar el dominio exige `--build`, no un restart. Va en la documentación, en negrita, porque es la trampa más fácil de pisar.

*Nota:* el `Dockerfile` usa `npm ci` con `package-lock.json`. El repo tiene además `pnpm-lock.yaml`; los dos lockfiles conviven y el build usa npm. No lo cambiamos aquí — es ruido para otro momento —, pero conviene saberlo si el build se comporta distinto al `pnpm` de desarrollo.

### 10. Dimensionamiento y proveedor

Mínimo: **4 vCPU, 8 GB de RAM, 80 GB NVMe**. El stack son ~10 contenedores; Postgres, Realtime (BEAM) y Studio son los que pesan. Con 4 GB arranca pero queda al filo, y el `npm run build` de Next.js es lo primero que muere por OOM.

**Contratado:** Contabo **Cloud VPS Plus 6** — 6 vCPU AMD EPYC, 12 GB RAM, 300 GB NVMe, US East (Nueva York), 5 snapshots, ~$18.40/mes.

*Un solo servidor, no dos.* Se evaluó separar el app de la base en dos VPS y se descartó: no da alta disponibilidad (sin réplica ni failover son dos puntos de fallo en vez de uno), y **`src/lib/supabase/server.ts:8` usa `NEXT_PUBLIC_SUPABASE_URL`** — la URL pública — igual que el cliente. En una máquina eso es un hairpin por loopback; en dos, cada consulta del servidor cruzaría internet con handshake TLS, multiplicado por las varias consultas de cada pantalla. Además obligaría a exponer Postgres, GoTrue, Storage y Realtime entre máquinas, que es justo lo que evita la regla de "ningún servicio publica puertos al host".

*Por qué 12 GB y no 8 ni 24.* Contabo no ofrece 16 GB: el salto es 8 → 12 → 24. Con 8 GB el build de Next solo sobrevive gracias al swap, y swap en caliente sobre Postgres degrada todo. Los 24 GB cuestan casi el doble por memoria que este stack no toca.

*Complementos descartados a propósito:* red privada (un solo servidor), Object Storage de Contabo y Auto Backup. Los dos últimos por el mismo motivo: un respaldo alojado en el proveedor que estás respaldando no protege contra un fallo de cuenta. El respaldo externo va a un tercero, y el monitoreo también (UptimeRobot para el app, Healthchecks.io para el cron — un cron muerto no tira ninguna página abajo, simplemente deja los pasos Wait colgados en silencio).

## Risks / Trade-offs

**[El webhook de Meta se corta durante la migración]** → Verificar la nueva URL (`https://crm.<dominio>/api/whatsapp/webhook`) en el panel de Meta como último paso, con el stack ya probado. Meta reintenta las entregas fallidas por un tiempo, pero no para siempre: la ventana de corte debe ser de minutos, y conviene hacerla fuera de horario comercial.

**[Todo en un solo servidor: sin réplica, sin failover]** → Aceptado explícitamente. La mitigación es el respaldo: dump diario de Postgres + tar del volumen de Storage, **con una restauración probada** antes de declarar el stack listo. Un respaldo que nunca se restauró no es un respaldo.

**[La publicación `supabase_realtime` puede no existir y romper la migración 001]** → Bootstrap idempotente antes de migrar (decisión 6). Se verifica en el primer arranque, no se asume.

**[Perder `ENCRYPTION_KEY` deja ilegibles las credenciales de Meta]** → Ya es cierto hoy y `.env.local.example:23-24` lo advierte: rotarla obliga a reconectar WhatsApp. En self-host el riesgo sube, porque ahora también somos responsables del respaldo del `.env`. Va guardado fuera del servidor, en el gestor de secretos que use el equipo.

**[La `SERVICE_ROLE_KEY` salta todo el RLS]** → El gateway de Supabase queda expuesto en internet. Solo el servidor Next.js debe tener esa clave; nunca en el cliente. Ya se respeta en el código, pero el riesgo crece cuando el gateway es público y el firewall del VPS debe cerrar todo salvo 80/443 y SSH.

**[Studio expuesto en internet]** → Basic Auth en Caddy y, si el equipo tiene IPs fijas, restricción por IP. Studio da acceso total a la base: es el punto más goloso del despliegue.

**[Actualizar Supabase rompe algo]** → Tags pineados y `pg_dump` antes de cada actualización. Nunca `latest`.

**[La CSP tiene el dominio de la nube codificado a mano]** → `next.config.ts:54,58` fija `https://*.supabase.co` y `wss://*.supabase.co` en `media-src` y `connect-src`. Hoy no rompe nada porque la cabecera es `Report-Only`, pero el propio comentario del archivo anuncia la intención de pasarla a modo bloqueo tras dos despliegues limpios. Si alguien hace ese cambio sin actualizar los orígenes, el Realtime y todas las llamadas a Supabase se cortan de golpe. Se corrige derivando los orígenes de `NEXT_PUBLIC_SUPABASE_URL` (tarea 4.9). Es `next.config.ts`, no `src/`.

**[Sin reseteo de contraseña por correo]** → Documentado como limitación conocida (decisión 8), con el procedimiento manual desde Studio mientras no haya relay SMTP.

## Migration Plan

1. **Provisionar** el VPS, DNS de los dos subdominios, firewall (solo 22/80/443), Docker.
2. **Levantar el stack** con claves generadas y verificar salud servicio por servicio.
3. **Bootstrap + migraciones** sobre la base limpia; comprobar que los tres buckets y la publicación de Realtime quedaron creados.
4. **Construir y levantar** el app y el proxy; crear el primer usuario y validar login, inbox y subida de archivos.
5. **Activar el cron** y verificar que un paso Wait de automatización efectivamente avanza.
6. **Respaldar y restaurar** en un entorno de prueba. Este paso no se salta.
7. **Reapuntar el webhook de Meta** y confirmar con un mensaje real de WhatsApp entrante.

**Rollback:** hasta el paso 6, el sistema en la nube sigue intacto y sirviendo — no hay nada que revertir, solo se descarta el VPS. Después del paso 7, revertir es volver a apuntar el webhook a la URL anterior; los mensajes recibidos en el VPS durante ese lapso quedan solo ahí.

## Open Questions

- ~~**¿Dónde se hospeda el VPS y con qué proveedor?**~~ **Resuelto:** Contabo Cloud VPS Plus 6, US East (Nueva York). Ver decisión 10. El respaldo externo va fuera de Contabo, a un proveedor de object storage de terceros.
- **¿Habrá relay SMTP, y cuál?** No bloquea el despliegue (decisión 8), pero define si el reseteo de contraseña queda manual de forma permanente.
- **¿Qué se hace con la cuenta de producción actual?** Este cambio arranca limpio; queda pendiente decidir si esa base se migra, se archiva o convive.
- **¿Quién tiene acceso SSH y a Studio?** Hoy hay un solo operador; conviene definirlo antes de que sean varios.
