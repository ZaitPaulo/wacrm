# Autoalojar el CRM completo

Guía de operación del despliegue en servidor propio: el app, Supabase entero
(base, auth, storage, realtime) y el reverse proxy, en una sola máquina.

Si lo que quieres es correr solo el app contra Supabase Cloud, esta guía no es
la tuya — eso está en [docker.md](./docker.md) y es más sencillo.

---

## Cómo está montado

```
                        internet
                            │
                    ┌───────┴────────┐
                    │  Caddy :80/443 │   único que publica puertos
                    └───────┬────────┘
          ┌─────────────────┼──────────────────┐
          │                 │                  │
   loramotors.co     www.loramotors.co   supabase.loramotors.co
   vitrina + CRM      redirige al apex    gateway + Studio
          │                                     │
     ┌────┴────┐                    ┌───────────┴────────────┐
     │   app   │                    │  api-gw (Envoy) :8000  │
     │ :3000   │───────────────────▶│  auth · rest · realtime│
     └─────────┘   red `loramotors` │  storage · meta · db   │
                                    └────────────────────────┘
```

Tres nombres de host sobre **una sola IP**. Caddy los separa por SNI y emite un
certificado para cada uno.

### Por qué la vitrina va en el dominio raíz

La vitrina pública **es** la raíz del app (`src/app/page.tsx`), no una sección
aparte: el CRM y el catálogo son la misma aplicación Next. Por eso el hostname
que la gente comparte e indexa Google es el de la marca, y el equipo entra por
`loramotors.co/login`.

### Por qué el gateway de Supabase tiene que ser público

Es lo que más sorprende de autoalojar, y no es opcional: **no basta con que el
app lo alcance por la red interna de Docker.**

- El navegador habla **directo** con Supabase. `src/lib/supabase/client.ts`
  corre en el cliente, y el WebSocket de Realtime también.
- Meta **descarga** las fotos de los vehículos desde las URLs públicas de
  Storage para publicarlas en Instagram (`src/lib/instagram/images.ts`).

---

## Requisitos

| Recurso | Mínimo | Por qué |
|---|---|---|
| vCPU | 4 | Son ~11 contenedores; Postgres y Realtime compiten por CPU |
| RAM | 8 GB | Con menos, el `npm run build` de Next muere por OOM |
| Disco | 80 GB **NVMe** | Postgres se limita por latencia de disco, no por capacidad |
| SO | Ubuntu 24.04 LTS | Donde Docker publica paquetes primero |
| IPv4 | Dedicada | Meta necesita alcanzar el webhook |

Preparar el servidor desde cero —usuario, SSH, firewall, Docker, DNS— está paso
a paso en
[`openspec/changes/self-host-supabase-vps/preparacion-del-vps.md`](../openspec/changes/self-host-supabase-vps/preparacion-del-vps.md).

---

## Instalación

Con el servidor ya preparado y el repo en `/opt/crm`:

```bash
cd /opt/crm

# 1. Red compartida entre el stack, el app y el proxy
docker network create loramotors

# 2. Secretos (pide dominio y correo para Let's Encrypt)
./scripts/generate-secrets.sh loramotors.co admin@loramotors.co
```

**Guarda una copia de `deploy/.env` fuera del servidor antes de seguir.**

```bash
# 3. Comprobar la configuración ANTES de levantar nada
./scripts/preflight.sh

# 4. Stack de Supabase
cd deploy/supabase && docker compose up -d && cd ../..

# 5. Base: publicación de Realtime + las 53 migraciones
./scripts/bootstrap-db.sh
./scripts/apply-migrations.sh

# 6. App, proxy y cron
docker compose -f docker-compose.yml -f deploy/docker-compose.app.yml \
  --env-file deploy/.env up -d --build

# 7. Respaldo diario
sudo mkdir -p /opt/crm-backups && sudo chown "$USER" /opt/crm-backups
./scripts/install-backup-cron.sh
```

El primer usuario: pon `DISABLE_SIGNUP=false` en `deploy/.env`, reinicia `auth`,
regístrate en `/signup` y vuelve a ponerlo en `true`.

---

## La regla que más cuesta aprender

> ### **Cambiar cualquier `NEXT_PUBLIC_*` exige RECONSTRUIR la imagen, no reiniciarla.**

Esos valores se hornean en el bundle del navegador **en tiempo de build**
(`Dockerfile:23-33`). Si cambias el dominio o la clave anónima y solo haces
`restart`, el app sigue usando el valor viejo y no hay ningún error que lo
delate: simplemente apunta a donde ya no está.

```bash
docker compose -f docker-compose.yml -f deploy/docker-compose.app.yml \
  --env-file deploy/.env up -d --build      # ← --build, siempre
```

Afecta a: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`NEXT_PUBLIC_SITE_URL` y `NEXT_PUBLIC_APP_LOCALE`.

---

## Operación

### Actualizar el CRM

```bash
cd /opt/crm
./scripts/backup.sh          # primero el respaldo, siempre
git pull
./scripts/apply-migrations.sh    # si el pull trajo migraciones nuevas
docker compose -f docker-compose.yml -f deploy/docker-compose.app.yml \
  --env-file deploy/.env up -d --build
```

El servidor sigue `main`, así que solo recibe lo que hayas promovido desde
`develop` — nunca trabajo a medias.

### Actualizar Supabase

Nunca sin respaldo previo y nunca a `latest`. El procedimiento completo está en
[`deploy/README.md`](../deploy/README.md); en resumen: traer el `docker/` del
commit nuevo sobre `deploy/supabase/`, leer el `git diff`, revisar si
`docker-compose.crm.yml` sigue encajando, y actualizar la tabla de versiones.

### Rotar secretos

Cada secreto tiene consecuencias distintas y conviene saberlas antes:

| Secreto | Qué pasa al rotarlo |
|---|---|
| **`ENCRYPTION_KEY`** | **Las credenciales de Meta guardadas quedan ILEGIBLES.** Hay que reconectar WhatsApp en cada cuenta. No se rota sin plan |
| `JWT_SECRET` | Hay que regenerar `ANON_KEY` y `SERVICE_ROLE_KEY` a la vez, y **reconstruir** el app (la anon es `NEXT_PUBLIC_*`). Todas las sesiones se cierran |
| `POSTGRES_PASSWORD` | Cambiarla en el `.env` no la cambia en la base ya inicializada; hay que hacerlo también con `ALTER ROLE` |
| `AUTOMATION_CRON_SECRET` | Reiniciar el app y el contenedor `cron`. Si solo cambias uno, los ticks empiezan a dar 401 |
| `DASHBOARD_PASSWORD` | Recrear Caddy: el hash bcrypt se calcula al arrancar |

Después de cualquier rotación: `./scripts/preflight.sh`.

### Respaldo y restauración

```bash
./scripts/backup.sh                              # manual
./scripts/restore.sh /opt/crm-backups/<fecha> --dry-run   # verificar sin tocar
./scripts/restore.sh /opt/crm-backups/<fecha>             # restaurar (destructivo)
```

Tres cosas que hay que tener claras:

1. **Lo que hay en `/opt/crm-backups` NO es una copia externa.** Está en el
   mismo disco y el mismo proveedor: si se pierde la cuenta, se pierden los dos
   a la vez. Súbelos a un almacenamiento de terceros.
2. **Define `BACKUP_PING_URL`** (Healthchecks.io o similar) en `deploy/.env`. El
   fallo que de verdad duele no es el respaldo que grita, es el que dejó de
   ejecutarse hace tres semanas sin que nadie lo notara — y eso ningún log lo
   detecta.
3. **`git clean -xdf` en este servidor borra la base de datos y todas las
   fotos.** Los datos viven en `deploy/supabase/volumes/`, dentro del árbol del
   repo pero ignorados por git.

### Correo saliente

El relay es Resend (`smtp.resend.com:587`). Tres trampas al configurarlo:

- `SMTP_USER` es literalmente **`resend`**, no tu dirección de correo.
- `SMTP_PASS` es la API key completa, con el prefijo `re_`.
- `SMTP_ADMIN_EMAIL` debe ser de un dominio **verificado** en Resend, o el
  envío se rechaza.

Sin relay configurado, `/forgot-password` **miente**: GoTrue responde éxito a
`resetPasswordForEmail` sin enviar nada —para no revelar qué correos existen— y
la página dice «revisa tu correo» ante uno que no llegará jamás. Mientras no
haya SMTP, las contraseñas se resetean desde Studio.

---

## Cuando algo falla

Síntomas reales de este despliegue, con su causa:

| Síntoma | Causa | Solución |
|---|---|---|
| Todo responde **401** sin explicación | `ANON_KEY`/`SERVICE_ROLE_KEY` no están firmadas con el `JWT_SECRET` actual | `./scripts/preflight.sh` lo detecta recalculando el HMAC |
| El build muere: `permission denied` en `volumes/db/data` | El build context incluía los datos de Postgres, que son del contenedor | Ya resuelto: `deploy` está en `.dockerignore` |
| El build muere: `supabaseKey is required` | Una ruta se prerenderiza y necesita el service-role, que no existe en build | Esa ruta necesita `export const dynamic = 'force-dynamic'` |
| **Ninguna foto** carga en la vitrina | El host de Storage no está en `remotePatterns` de `next/image` | Se deriva de `NEXT_PUBLIC_SUPABASE_URL`; si cambió el dominio, **reconstruir** |
| Caddy no emite certificado | DNS sin propagar, o algo ocupando el 80 | `dig +short loramotors.co` y `sudo ss -tlnp \| grep ':80'` |
| Una regla de Caddy «no hace nada» | Al mezclar `handle` con directivas sueltas, Caddy usa **su** orden, no el del archivo | Meter todo lo del host dentro de bloques `handle` |
| Los pasos Wait no avanzan | El cron no corre o su secreto no coincide | `docker logs crm-cron` — 401 es secreto distinto, 503 es que el app no lo tiene |
| Un contacto deja de disparar flujos | Su flow run abandonado bloquea `idx_one_active_run_per_contact` | Es lo que barre `/api/flows/cron`; comprobar que el cron corre |
| Fallos de auth intermitentes | Reloj desfasado: los JWT caducan por tiempo | `timedatectl status \| grep synchronized` |
| Un `.sh` da `Permission denied` | Perdió el bit ejecutable | `git ls-files -s scripts/` — debe decir `100755`, no `100644` |

### Comandos de diagnóstico

```bash
# Estado de todo
cd /opt/crm/deploy/supabase && docker compose ps
docker compose -f docker-compose.yml -f deploy/docker-compose.app.yml \
  --env-file deploy/.env ps

# Logs
docker logs crm-caddy --tail 50      # certificados, enrutado
docker logs crm-cron --tail 20       # tareas programadas
docker logs supabase-auth --tail 50  # login, correo
docker logs wacrm-app-1 --tail 50    # el CRM

# Nada debe estar publicado salvo 80/443
sudo ss -tlnp | grep -E ':(5432|8000|3000)\s'
```

---

## Lo que sigue dependiendo de terceros

Autoalojar mueve los datos a tu servidor, no elimina toda dependencia externa:

- **Graph API de Meta** — WhatsApp e Instagram no se pueden autoalojar.
- **Proveedores de IA** — opcionales, y ya son *bring-your-own-key* por cuenta.
- **DNS y Let's Encrypt** — el certificado se renueva solo, pero necesita que el
  dominio siga resolviendo a esta IP.
- **Resend** — solo para el correo saliente.
