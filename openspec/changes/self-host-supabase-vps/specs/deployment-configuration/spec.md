## ADDED Requirements

### Requirement: Dos nombres de host públicos con TLS válido

El despliegue SHALL publicar el app y el gateway de Supabase en dos nombres de host distintos, ambos por HTTPS con certificado de una autoridad reconocida, obtenido y renovado automáticamente.

El gateway de Supabase no puede quedar solo en la red interna: el navegador habla directo con él y Meta descarga imágenes de Storage desde internet.

#### Scenario: Ambos hosts responden con certificado válido

- **WHEN** se visita `https://crm.<dominio>` y `https://supabase.<dominio>` desde una red externa
- **THEN** ambos responden sin advertencia de certificado

#### Scenario: El certificado se renueva sin intervención

- **WHEN** un certificado se acerca a su vencimiento
- **THEN** el proxy lo renueva solo, sin que nadie ejecute un comando ni reinicie servicios

#### Scenario: Realtime funciona a través del proxy

- **WHEN** el navegador abre el WebSocket de Realtime contra `https://supabase.<dominio>`
- **THEN** la conexión se establece y se mantiene abierta

### Requirement: Separación entre configuración de build y de ejecución

Las variables `NEXT_PUBLIC_*` SHALL entregarse como argumentos de build, y todo secreto de servidor SHALL leerse en tiempo de ejecución y no quedar dentro de la imagen.

#### Scenario: Cambiar el dominio exige reconstruir

- **WHEN** se cambia `NEXT_PUBLIC_SUPABASE_URL` y solo se reinicia el contenedor
- **THEN** el app sigue usando el valor anterior
- **AND** la documentación advierte que hace falta reconstruir la imagen

#### Scenario: Los secretos no viajan en la imagen

- **WHEN** se inspeccionan las capas de la imagen construida
- **THEN** no contienen `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`, `META_APP_SECRET` ni `AUTOMATION_CRON_SECRET`

### Requirement: Los secretos se generan por instalación

Cada despliegue SHALL generar sus propios secretos —contraseña de Postgres, `JWT_SECRET`, claves `anon` y `service_role` derivadas de él, `ENCRYPTION_KEY`, `AUTOMATION_CRON_SECRET` y credenciales de Studio— con la longitud y el formato que cada uno exige. Ningún valor de ejemplo SHALL sobrevivir en una instalación en marcha.

#### Scenario: Las claves de Supabase son coherentes entre sí

- **WHEN** se generan `ANON_KEY` y `SERVICE_ROLE_KEY`
- **THEN** ambas están firmadas con el mismo `JWT_SECRET` que usa el stack
- **AND** el app autentica correctamente con la clave anónima

#### Scenario: La clave de cifrado tiene el formato exigido

- **WHEN** se genera `ENCRYPTION_KEY`
- **THEN** son 64 caracteres hexadecimales, como exige el cifrado AES-256-GCM de los tokens de Meta

#### Scenario: Un valor de ejemplo bloquea el arranque

- **WHEN** el archivo de configuración conserva un valor de plantilla sin reemplazar
- **THEN** la verificación previa al arranque lo detecta y avisa antes de levantar el stack

### Requirement: El panel de administración no queda abierto

Studio SHALL exigir autenticación en el proxy antes de llegar al servicio.

#### Scenario: Acceso sin credenciales

- **WHEN** alguien visita la URL de Studio sin credenciales
- **THEN** recibe 401 y no ve ningún dato

### Requirement: El servidor solo expone lo necesario

El servidor SHALL exponer a internet únicamente los puertos de HTTP, HTTPS y administración remota. Los puertos de Postgres, PostgREST, Realtime, Storage y el gateway SHALL ser alcanzables solo desde la red interna del stack o a través del proxy.

#### Scenario: Postgres no es alcanzable desde internet

- **WHEN** se intenta conectar al puerto de Postgres desde una IP externa
- **THEN** la conexión es rechazada

### Requirement: El app conoce su propia URL pública

La configuración SHALL fijar la URL canónica del despliegue, para que los enlaces generados sin petición entrante —invitaciones desde tareas de fondo, sitemap, imágenes OG— apunten al dominio correcto.

#### Scenario: Un enlace de invitación apunta al dominio propio

- **WHEN** se genera una invitación
- **THEN** el enlace usa `https://crm.<dominio>` y no un dominio de terceros
