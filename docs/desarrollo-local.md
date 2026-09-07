# Entorno de desarrollo local

Levanta el stack completo de Supabase (Postgres, Auth, Storage, Realtime,
Studio) en Docker, con datos de prueba propios. Sirve para validar cambios
—sobre todo los de permisos por rol— **antes** de desplegar al VPS, sin
tocar la base de producción.

## Por qué existe

Por defecto `.env` apunta a `https://supabase.loramotors.co`, que es la
base **real**: el inventario cargado, las conversaciones de WhatsApp y los
miembros de verdad. El servidor de Next corre local, pero los datos no. Eso
significa que probar algo como "¿qué ve un usuario con rol agente?" implica
crear un miembro real en la cuenta.

Este entorno resuelve eso: base propia, usuarios desechables, un rol por
usuario y borrón y cuenta nueva con un comando.

## Requisitos

- **Docker Desktop** corriendo (el stack son ~10 contenedores).
- El CLI de Supabase, que se usa vía `npx` — no hace falta instalarlo.

## Arranque

```bash
# 1. Levantar el stack (la primera vez descarga ~2 GB de imágenes)
npx supabase start

# 2. Aplicar migraciones y sembrar datos de prueba
npx supabase db reset

# 3. Apuntar la app a la base local
mv .env.local.disabled .env.local     # o copiarlo, ver más abajo

# 4. Arrancar la app
npm run dev
```

La app queda en http://localhost:3000 y Supabase Studio —para mirar tablas
a mano— en http://localhost:54323.

> **Si ya tenías `npm run dev` corriendo**, reinicialo. Next lee las
> variables de entorno al arrancar, así que un servidor levantado antes
> de crear `.env.local` sigue hablando con producción. Y además no deja
> correr dos servidores desde la misma carpeta: falla con "Another next
> dev server is already running" e indica el PID a matar.

### Sobre `.env.local`

Next.js le da precedencia a `.env.local` sobre `.env`, y solo pisa las
claves que ese archivo define. O sea:

- **`.env.local` presente** → la app habla con la base local.
- **`.env.local` renombrado a `.env.local.disabled`** → vuelve a producción.

Ese renombre es todo el interruptor. `.gitignore` cubre `.env*`, así que
ninguno de los dos se comitea.

Si las claves del archivo quedaron viejas (el CLI puede rotarlas al
actualizarse), sacá las nuevas con:

```bash
npx supabase status
```

y copiá `API URL`, `anon key` y `service_role key` a las variables
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` y
`SUPABASE_SERVICE_ROLE_KEY`.

## Usuarios de prueba

`supabase/seed.sql` crea una cuenta —"LoraMotors (local)"— con un usuario
por cada rol. Todos con la contraseña **`local1234`**:

| Correo | Nombre | Rol |
|---|---|---|
| `owner@local.test` | Ana Owner | owner |
| `admin@local.test` | Beto Admin | admin |
| `agente@local.test` | Caro Agente | **agent** |
| `viewer@local.test` | Dani Viewer | viewer |

La forma cómoda de comparar permisos es abrir dos sesiones en paralelo:
una normal con `admin@local.test` y una de incógnito con
`agente@local.test`.

El seed también deja 6 vehículos (disponibles con distinta antigüedad, uno
reservado y dos vendidos dentro de los últimos 30 días), 4 contactos, un
embudo con tres etapas, negocios y costos de adquisición. Los vendidos y
los costos están puestos a propósito para que el tablero no salga en cero y
para que el panel de márgenes tenga algo real que mostrarle a un admin —
y nada a un agente.

Las fechas son relativas a `NOW()`, así que el rango de 30/60/90 días del
tablero siempre tiene datos, no importa cuándo se corra el seed.

## Volver a foja cero

```bash
npx supabase db reset
```

Reaplica todas las migraciones desde cero y vuelve a sembrar. Es el
comando a usar cuando ensuciaste los datos probando, o cuando agregaste una
migración nueva y querés verificar que corre limpia sobre una base vacía —
que es exactamente lo que le va a pasar al VPS cuando despliegues.

## Parar

```bash
npx supabase stop           # conserva los datos
npx supabase stop --no-backup   # los descarta
```

## Qué NO se puede probar acá

- **Envío real por WhatsApp / Instagram / Facebook.** No hay credenciales
  de Meta. `.env.local` trae `WHATSAPP_TEMPLATES_DRY_RUN=true`, así que el
  alta de plantillas guarda la fila sin llamar a Meta.
- **Webhooks entrantes de Meta**: necesitan una URL pública. Para eso hace
  falta un túnel (ngrok o similar) apuntando a `localhost:3000`.
- **Correo.** Auth usa el SMTP local del stack; los mensajes se ven en
  http://localhost:54324 (Mailpit), no llegan a ninguna bandeja real.

## Detalle de implementación: permisos de tabla

El seed arranca con un bloque de `GRANT`. No es decorativo: las imágenes
recientes del stack local ya no otorgan SELECT/INSERT/UPDATE/DELETE sobre
las tablas nuevas a `anon`/`authenticated`, cosa que Supabase alojado —y el
VPS, instalado cuando esa era la conducta por defecto— sí hace. Sin ese
bloque, toda consulta de la app muere con un `42501 permission denied`
antes siquiera de llegar a la RLS.

Está en el seed y no en una migración a propósito: `db reset` solo toca la
base local, mientras que una migración se aplicaría también al VPS, que no
lo necesita.
