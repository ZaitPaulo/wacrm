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

### Copia externa a Google Drive

Los respaldos de `/opt/crm-backups` viven en el mismo disco que la base que
protegen. `backup.sh` los sube a un destino externo si `RCLONE_REMOTE` está
configurada, y **falla el respaldo entero si la subida falla**: un respaldo
local que nunca salió del servidor es justo la ilusión que esto elimina.

#### Configurar rclone (una vez)

Google Drive necesita autorización por navegador, y el servidor no tiene. Se
resuelve con un túnel SSH: autorizas en **tu** navegador y el token queda en el
servidor.

**1.** Instala rclone en el servidor:

```bash
ssh loramotors
sudo -v && curl https://rclone.org/install.sh | sudo bash
```

**2.** Desde tu PC, abre el túnel y déjalo abierto:

```
ssh -L localhost:53682:localhost:53682 loramotors
```

**3.** En esa misma sesión:

```bash
rclone config
```

- `n` (new remote) → nombre: **`gdrive`**
- Tipo: **`drive`** (Google Drive)
- `client_id` y `client_secret`: los tuyos (ver más abajo). Dejarlos en blanco
  usa el `client_id` compartido de rclone, que **Google retira durante 2026** —
  el propio rclone lo avisa y te pide confirmar. Sirve para salir del paso, no
  para dejarlo así.
- Scope: **`1`** (acceso completo)
- `service_account_file`: en blanco
- Advanced config: **`n`**
- Use web browser: **`y`** ← el túnel hace que se abra en tu PC
- Configure as Shared Drive: **`n`** (salvo que uses Google Workspace)
- `y` para confirmar, `q` para salir

Tras autorizar en el navegador puede aparecer `channel N: open failed: connect
failed: Connection refused`, mezclado con el siguiente prompt. **Es ruido del
túnel, no un error**: el navegador intenta una conexión más al 53682 cuando
rclone ya cerró su listener. Si antes salió `NOTICE: Got code`, la autorización
funcionó; sigue respondiendo.

**4.** Comprueba que habla con Drive y crea la carpeta:

```bash
rclone lsd gdrive:
rclone mkdir gdrive:crm-backups
```

**5.** Apúntalo en el `.env` y prueba:

```bash
cd /opt/crm
echo "RCLONE_REMOTE=gdrive:crm-backups" >> deploy/.env
./scripts/backup.sh
```

Debe terminar con `archivo(s) confirmado(s) en el remoto` y la ruta de la copia.

#### Crear un client_id propio de Google

No es opcional a medio plazo: el `client_id` compartido de rclone deja de
funcionar durante 2026, y cuando lo haga la subida empezará a fallar.

1. [Google Cloud Console](https://console.cloud.google.com) → crea un proyecto.
2. **APIs y servicios → Biblioteca** → busca *Google Drive API* → **Habilitar**.
3. **Pantalla de consentimiento de OAuth** → tipo **External** → rellena nombre
   de la app y tu correo.
4. **Credenciales → Crear credenciales → ID de cliente de OAuth** → tipo
   **Aplicación de escritorio**. Copia el *client ID* y el *client secret*.
5. En el servidor:

   ```bash
   rclone config update gdrive client_id TU_CLIENT_ID client_secret TU_CLIENT_SECRET
   rclone config reconnect gdrive:      # vuelve a autorizar, con el túnel abierto
   rclone lsd gdrive:                   # comprobar
   ```

> ### **Publica la app: en modo «Testing» el token caduca a los 7 días**
>
> Con la pantalla de consentimiento en **External + Testing**, Google expira
> todos los refresh tokens a los **7 días exactos**. El respaldo subiría bien
> una semana y luego empezaría a fallar con `invalid_grant`, sin que nada haya
> cambiado en el servidor.
>
> En la pantalla de consentimiento, pulsa **PUBLICAR APLICACIÓN** («In
> production»). Saldrá un aviso de verificación que puedes ignorar: como la app
> es tuya y solo la usas tú, no hace falta pasar la revisión de Google — el
> token deja de caducar igualmente.

#### Recuperar desde Drive

```bash
rclone copy gdrive:crm-backups/20260821-031500 /tmp/bak
./scripts/restore.sh /tmp/bak --dry-run
./scripts/restore.sh /tmp/bak
```

#### Lo que conviene tener presente

- **Los archivos van sin cifrar**, por decisión explícita: se prioriza poder
  recuperarlos desde cualquier sitio sin depender de otra contraseña. La
  contrapartida es que quien entre a esa cuenta de Google —o a un dispositivo
  con la sesión abierta— se lleva la base de clientes. Ponle verificación en dos
  pasos a esa cuenta y no la compartas.
- **Retención separada**: 14 días en local, 30 en el remoto (`REMOTE_RETENTION_DAYS`).
  El disco del servidor y la cuota de Drive no tienen por qué aguantar lo mismo.
- **El token OAuth puede caducar o revocarse** —cambio de contraseña de Google,
  inactividad larga— y entonces la subida empieza a fallar. Como la subida es
  parte del respaldo, `BACKUP_PING_URL` te avisa; sin esa comprobación te
  enterarías el día que necesites restaurar.
- **15 GB gratis** incluyen Gmail y Fotos. Vigila el espacio cuando el inventario
  acumule fotos.

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
| El webhook **no recibe nada**, pero el botón «Probar» de Meta sí llega | Meta todavía no propagó el enrutamiento de eventos de la WABA | Esperar ~1 h antes de tocar nada — ver la sección siguiente |

### Cuando el webhook de WhatsApp no entrega

Le pasó a este despliegue el 2026-08-24, al tomar un número que venía reclamado
por otro proveedor: la configuración estaba correcta en los cinco niveles y aun
así no llegaba **ni un solo evento**. No había nada que arreglar.

**El primer entrante disparó webhook 57 minutos después del `/register`.** Si
acabas de tomar un número, espera una hora antes de cambiar nada. Rehacer la
suscripción en ese rato «arregla» algo que solo necesitaba tiempo, y te deja
creyendo que la causa era otra.

Ojo con el botón **«Probar»** de la consola de Meta: prueba la suscripción a
nivel de aplicación y llega aunque los eventos reales no se estén enrutando. Que
funcione **no** significa que el webhook esté operativo.

Para saber de qué lado está el fallo, en este orden. Todas las consultas usan el
token guardado en `whatsapp_config`, que hay que descifrar con `ENCRYPTION_KEY`
— hazlo dentro del contenedor y no lo imprimas:

| Qué preguntar | Endpoint | Respuesta sana |
|---|---|---|
| Estado del número | `GET /{phone_number_id}?fields=status,platform_type,code_verification_status` | `CONNECTED` y `CLOUD_API` |
| Quién recibe los eventos de la WABA | `GET /{waba_id}/subscribed_apps` | **solo** tu app; si sale otra, ese es el ladrón |
| URL y campos suscritos | `GET /{app_id}/subscriptions` (token `app_id\|app_secret`) | `active: true`, tu URL, campo `messages` |
| URL sobrescrita en el número | `GET /{phone_number_id}?fields=webhook_configuration` | tu propia URL — Meta permite sobrescribirla por número, y un proveedor anterior puede haber dejado la suya |
| Salud de la cuenta | `GET /{waba_id}?fields=status,account_review_status,health_status` | `ACTIVE`, `APPROVED`, todo `AVAILABLE` |

Si todo eso está bien, queda una prueba que separa «Meta no vio el mensaje» de
«Meta lo vio y no lo reenvió»: **manda un texto libre** al número que escribió.
Meta solo lo permite dentro de la ventana de 24 h.

- Error **131047** → Meta nunca registró el entrante. El problema está antes del
  webhook.
- **HTTP 200 con `wamid`** → Meta sí lo registró y la ventana está abierta. El
  fallo está aislado en la entrega del webhook, y con eso el reporte a soporte
  va con evidencia en vez de con sospechas.

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
