## ADDED Requirements

### Requirement: El stack provee los servicios de Supabase que el app usa

El despliegue SHALL incluir, corriendo en el mismo servidor, un Postgres 17, un servidor PostgREST, GoTrue, Storage, Realtime y un gateway HTTP que los publique bajo un único origen. El app SHALL funcionar contra ese origen sin ningún cambio en `src/`.

#### Scenario: Todos los servicios obligatorios quedan sanos

- **WHEN** se ejecuta el arranque del stack en un servidor limpio
- **THEN** los servicios `db`, `api-gw`, `auth`, `rest`, `realtime`, `storage` y `meta` reportan estado saludable
- **AND** ningún servicio queda en reinicio cíclico

#### Scenario: El app no requiere cambios de código

- **WHEN** se apunta `NEXT_PUBLIC_SUPABASE_URL` al gateway autoalojado
- **THEN** el app arranca, autentica y lee datos sin modificar ningún archivo bajo `src/`

### Requirement: Postgres provee las extensiones que exigen las migraciones

La base SHALL tener disponibles las extensiones `uuid-ossp` y `vector`, porque las migraciones 001 y 030 las crean explícitamente.

#### Scenario: Las extensiones se crean sin error

- **WHEN** se aplican las migraciones sobre la base limpia
- **THEN** `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"` y `CREATE EXTENSION IF NOT EXISTS vector` completan sin error

### Requirement: La publicación de Realtime existe antes de migrar

El stack SHALL garantizar que la publicación `supabase_realtime` exista antes de aplicar las migraciones, de forma idempotente. La migración `001_initial_schema.sql` hace `ALTER PUBLICATION supabase_realtime ADD TABLE` y falla si la publicación no está creada.

#### Scenario: La publicación falta en el arranque inicial

- **WHEN** se ejecuta el bootstrap sobre una base donde `supabase_realtime` no existe
- **THEN** el bootstrap la crea
- **AND** las migraciones se aplican completas

#### Scenario: La publicación ya existe

- **WHEN** se ejecuta el bootstrap sobre una base donde `supabase_realtime` ya existe
- **THEN** el bootstrap termina sin error y sin alterarla

### Requirement: Realtime entrega cambios al navegador

Los canales `postgres_changes` a los que se suscribe el app SHALL entregar eventos a los clientes conectados, atravesando el reverse proxy por WebSocket.

#### Scenario: Un mensaje nuevo aparece sin recargar

- **WHEN** se inserta una fila en `messages` mientras un usuario tiene la bandeja abierta
- **THEN** el mensaje aparece en su pantalla sin recargar la página

#### Scenario: Las tablas publicadas son las que el código espera

- **WHEN** se inspecciona la publicación `supabase_realtime` tras aplicar las migraciones
- **THEN** incluye `messages`, `conversations`, `message_reactions`, `flow_runs`, `member_presence` y `notifications`

### Requirement: Storage sirve los cinco buckets por URL pública

Storage SHALL persistir los archivos en almacenamiento local del servidor y servir los buckets `avatars`, `flow-media`, `chat-media`, `contact-documents` y `showcase-media` por una URL pública HTTPS alcanzable desde fuera de la red del servidor.

#### Scenario: Una imagen subida se descarga desde internet

- **WHEN** se sube una foto de vehículo y se toma su `getPublicUrl()`
- **THEN** esa URL responde 200 desde una red externa al servidor, con certificado TLS válido

#### Scenario: Los archivos sobreviven al reinicio

- **WHEN** se reinicia el stack completo
- **THEN** los archivos subidos antes siguen descargándose

### Requirement: Los servicios no usados quedan apagados

El stack SHALL dejar deshabilitados los servicios que el proyecto no utiliza, y la razón SHALL estar documentada.

#### Scenario: Edge Runtime y pooler no corren

- **WHEN** se listan los contenedores del stack en marcha
- **THEN** no hay ningún contenedor de Edge Functions ni de Supavisor

### Requirement: El stack se recupera solo tras un reinicio del servidor

Todos los contenedores SHALL tener política de reinicio automático, y el stack SHALL volver a estar operativo tras reiniciar el servidor sin intervención manual.

#### Scenario: Reinicio del servidor

- **WHEN** el servidor se reinicia
- **THEN** el app responde por HTTPS sin que nadie ejecute ningún comando
