## Why

Hoy el CRM corre contra la nube de Supabase: `NEXT_PUBLIC_SUPABASE_URL` apunta a `*.supabase.co` y ahí viven la base, la autenticación, los archivos y el realtime. Eso significa que los datos de clientes reales, las conversaciones de WhatsApp y las credenciales cifradas de Meta están en infraestructura de un tercero, con su facturación, sus límites de plan y su disponibilidad.

Queremos operar el sistema completo en un servidor propio. La buena noticia es que el proyecto ya está casi listo para eso, y lo verificamos leyendo el código antes de proponer nada:

- **No hay Edge Functions.** `supabase/functions/` no existe. Ninguna lógica vive en Deno; todo el servidor es Next.js.
- **No hay extensiones exclusivas de la nube.** Las migraciones solo piden `uuid-ossp` (001) y `vector` (030), ambas incluidas en la imagen `supabase/postgres`. No se usa `pg_cron`, ni `pg_net`, ni Vault.
- **El cron ya es externo.** `/api/automations/cron` y `/api/flows/cron` esperan que alguien de afuera las llame con `x-cron-secret`; nunca dependieron de un scheduler de Supabase.
- **El app ya está contenedorizado.** Hay `Dockerfile` multi-etapa con salida standalone y `docker-compose.yml`, aunque hoy `docs/docker.md` dice explícitamente: _"Supabase is external — no database container is included"_.

Lo que falta, entonces, no es reescribir el proyecto: es el stack de infraestructura que hoy no existe en el repo.

## What Changes

- **Un stack de Supabase autoalojado** con los servicios que el código realmente usa: Postgres 17, PostgREST, GoTrue (auth), Storage, Realtime y el gateway. Se descartan los que el proyecto no toca (Edge Runtime) y se documenta por qué.
- **Un despliegue de un solo comando** en un VPS Ubuntu/Debian: el app Next.js, el stack de Supabase y un reverse proxy con TLS automático, en una red Docker compartida.
- **Dos nombres de host públicos, no uno.** El app en `crm.<dominio>` y el gateway de Supabase en `supabase.<dominio>`, ambos con certificado válido de Let's Encrypt. Esto no es opcional: el navegador habla directo con Supabase, y Meta descarga las fotos de los vehículos desde las URLs públicas de Storage para publicarlas en Instagram.
- **Aplicación reproducible de las 53 migraciones** sobre una base limpia, sin depender de que el CLI de Supabase esté instalado en el servidor.
- **Un scheduler propio** que golpea `/api/automations/cron` y `/api/flows/cron` con el secreto compartido, para que los pasos Wait de automatizaciones y los flows dejen de quedarse colgados.
- **Respaldo y restauración verificados**: dump de Postgres y de los archivos de Storage, con una prueba de restauración documentada. Sin esto, autoalojar es solo mover el riesgo, no reducirlo.
- **Documentación de operación** en `docs/`: instalar, actualizar, rotar secretos, diagnosticar. `docs/docker.md` se reescribe, porque su premisa actual ("Supabase es externo") deja de ser cierta.

**Qué NO cambia**

- **El código del app.** Ni una línea de `src/`. Todo el cambio es configuración e infraestructura. Si algo obliga a tocar `src/`, es señal de que el diseño está mal.
- **Los datos actuales.** Se arranca con base limpia. La migración de la cuenta de producción colombiana es una decisión aparte, posterior a que este stack esté validado.
- **La dependencia de Meta.** WhatsApp e Instagram son APIs de Meta; no se pueden autoalojar. Igual con los proveedores de IA (OpenAI/Anthropic), que además ya son bring-your-own-key por cuenta.

## Capabilities

### New Capabilities
- `self-hosted-stack`: qué servicios componen el despliegue, qué garantiza cada uno, cuáles son obligatorios y cuáles se apagan a propósito.
- `deployment-configuration`: cómo se configuran dominios, certificados y secretos, y la distinción entre lo que se hornea en la imagen y lo que se lee en tiempo de ejecución.
- `stack-operations`: aplicar migraciones, ejecutar el cron, respaldar, restaurar y actualizar el stack sin perder datos.

### Modified Capabilities
<!-- Ninguna. Las capacidades de producto (mensajería, inventario, vitrina, flows) no cambian
     de comportamiento: el mismo código corre contra un Supabase distinto. -->

## Impact

**Archivos nuevos** — todo bajo `deploy/` y `docs/`, más scripts:
- `deploy/` con el compose del stack de Supabase, el overlay del app + proxy, y la configuración del reverse proxy.
- `scripts/` para migraciones, respaldo y restauración.
- `docs/self-hosting.md` nuevo; `docs/docker.md` reescrito.

**Archivos tocados**: `.env.local.example` gana una sección de self-host; `docker-compose.yml` raíz se ajusta para poder unirse a la red del stack.

**Sistemas externos que siguen siendo externos**: Graph API de Meta (obligatoria), proveedores de IA (opcional, BYOK), y el DNS del dominio. El correo saliente de GoTrue queda pendiente de decisión (ver `design.md`): un VPS nuevo no tiene reputación de envío, así que autoalojar SMTP es la peor opción de las disponibles.

**Riesgo principal**: el webhook de Meta. Hoy entrega en la URL de la nube; al mover el app hay que reapuntarlo y volver a verificarlo. Entre el corte y la verificación, los mensajes entrantes se pierden — Meta reintenta, pero no indefinidamente.
