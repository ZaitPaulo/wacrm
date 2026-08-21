# deploy/

Infraestructura del despliegue autoalojado: el stack de Supabase, el reverse
proxy y lo que hace falta para que el CRM corra en un servidor propio.

Para instalar desde cero, sigue `docs/self-hosting.md`. Este archivo explica
**cómo está organizado** y por qué, que es lo que necesitas saber antes de
tocar algo aquí.

## La regla que ordena todo: upstream intacto

```
deploy/
├── supabase/                      ← upstream de Supabase, SIN MODIFICAR
│   ├── docker-compose.yml
│   ├── volumes/                   (configs de Envoy, semillas SQL de la base)
│   ├── .env.example
│   └── docker-compose.crm.yml     ← lo ÚNICO nuestro en esta carpeta
└── README.md
```

Todo lo que hay bajo `supabase/` viene de
[`supabase/supabase@04ddc6b`](https://github.com/supabase/supabase/tree/04ddc6bef8bc585f2fdcdb42c502200a4d6c1782/docker),
descargado tal cual y pineado a ese commit. **No se edita nunca.** Los ajustes
de este despliegue viven en `docker-compose.crm.yml`.

La razón es lo que pasa al actualizar. Con el upstream intacto, subir de
versión es traer el `docker/` nuevo, hacer `git diff` para ver qué cambió
realmente y revisar si nuestro overlay sigue teniendo sentido. Si en cambio
editáramos el compose original, cada actualización sería un merge a mano
entre los cambios de Supabase y los nuestros, sin forma de distinguirlos.

### Por qué el overlay no se llama `docker-compose.override.yml`

Ese sería el nombre que Docker Compose carga automáticamente, y fue la primera
opción. Pero el `.gitignore` que trae upstream ignora exactamente ese nombre,
así que el archivo no quedaría versionado — y el despliegue depende de él.

Se llama `docker-compose.crm.yml` y se activa por `COMPOSE_FILE` en el `.env`:

```
COMPOSE_FILE=docker-compose.yml:docker-compose.crm.yml
```

Es el mismo mecanismo que usa upstream para sus propios overlays.

## Qué cambia el overlay

| Ajuste | Por qué |
|---|---|
| `api-gw` deja de publicar el 8000 | Docker se salta UFW: un puerto publicado queda expuesto a internet aunque el firewall diga lo contrario. Solo Caddy publica puertos |
| `functions` apagado | No existe `supabase/functions/` en el repo; toda la lógica de servidor es Next.js |
| `supavisor` apagado | Es un pooler para conexiones externas a Postgres. El app entra por PostgREST, no por el 5432 |
| Red `default` → `loramotors` (externa) | Una sola red para el stack, el app y el proxy, sin añadir una segunda red a cada servicio |

Los dos servicios se apagan con un perfil que nunca se activa, no borrándolos:
borrarlos obligaría a editar el compose de upstream. Nadie declara
`depends_on` sobre ellos, así que no arrancar no rompe el orden del stack.

**Overlays de upstream que NO usamos:** `docker-compose.envoy.yml` (upstream lo
marca deprecado y no-op: Envoy ya es el gateway por defecto) y
`docker-compose.pg17.yml` (redundante: PG 17 ya es el default).

## Los datos viven dentro de esta carpeta

Postgres y Storage escriben en bind mounts de upstream, así que en el
servidor acabas con:

```
deploy/supabase/volumes/db/data/     ← la base de datos entera
deploy/supabase/volumes/storage/     ← las fotos de los vehículos
```

Están en el `.gitignore` de upstream, así que no ensucian `git status`. Pero
hay dos consecuencias que conviene tener presentes:

- **`git clean -xdf` en el servidor borra la base de datos y todos los
  archivos subidos.** Es un comando que la gente ejecuta sin pensar para
  limpiar un árbol; aquí destruye producción. Si necesitas limpiar, hazlo con
  rutas explícitas.
- **El build del app no debe ver esta carpeta.** Los datos los crea el
  contenedor con su propio UID, y el `docker build` fallaría con
  `permission denied` al leerlos. Por eso `deploy` está en `.dockerignore`.

## Versiones

Todas las imágenes vienen pineadas desde upstream — ninguna usa `latest`, y
esa es una condición del despliegue, no una casualidad. Esta tabla es el
registro de la decisión; **la fuente de verdad es el compose pineado.**

| Servicio | Imagen | Estado |
|---|---|---|
| `db` | `supabase/postgres:17.6.1.136` | Activo — coincide con `major_version = 17` de `supabase/config.toml` |
| `api-gw` | `envoyproxy/envoy:v1.39.0` | Activo — gateway, único acceso al stack |
| `auth` | `supabase/gotrue:v2.189.0` | Activo |
| `rest` | `postgrest/postgrest:v14.12` | Activo — todo el acceso a datos del app |
| `realtime` | `supabase/realtime:v2.102.3` | Activo — `postgres_changes` de la bandeja |
| `storage` | `supabase/storage-api:v1.60.4` | Activo — backend `file`, sin S3 |
| `imgproxy` | `darthsim/imgproxy:v3.30.1` | Activo pero ocioso — `storage` lo declara como dependencia |
| `meta` | `supabase/postgres-meta:v0.96.6` | Activo — solo porque Studio lo necesita |
| `studio` | `supabase/studio:2026.08.03-sha-022b374` | Activo, detrás de Basic Auth |
| `functions` | `supabase/edge-runtime:v1.74.0` | **Apagado** |
| `supavisor` | `supabase/supavisor:2.9.5` | **Apagado** |

`imgproxy` queda corriendo aunque el app nunca pida transformación de imágenes
(solo llama `getPublicUrl()`): quitarlo obligaría a editar el compose de
upstream para romper la dependencia de `storage`, y es liviano.

## Actualizar Supabase

Nunca sin respaldo previo, y nunca a `latest`:

1. `scripts/backup.sh` y comprobar que el dump se escribió.
2. Descargar el `docker/` del commit nuevo sobre `deploy/supabase/`.
   **Comprueba los modos de archivo**: upstream tiene los `*-entrypoint.sh`
   como `100755`, y una descarga por HTTP no trae el bit ejecutable. Se
   restaura con `git update-index --chmod=+x`. Un `git diff` normal no
   enseña esa diferencia; `git ls-files -s` sí.
3. `git diff deploy/supabase/` — leer qué cambió de verdad.
4. Revisar si `docker-compose.crm.yml` sigue encajando (¿siguen existiendo
   `functions` y `supavisor`? ¿`api-gw` sigue publicando puerto?).
5. Actualizar la tabla de versiones de arriba.
6. `docker compose up -d` y verificar servicio por servicio.
