## ADDED Requirements

### Requirement: Las migraciones se aplican de forma repetible e idempotente

El despliegue SHALL aplicar las migraciones de `supabase/migrations/` en orden numérico ascendente, registrando cada versión aplicada en `supabase_migrations.schema_migrations`. Volver a ejecutar el proceso SHALL omitir las ya aplicadas. La operación SHALL funcionar sin el CLI de Supabase instalado en el servidor.

#### Scenario: Primera aplicación sobre base limpia

- **WHEN** se ejecuta la aplicación de migraciones sobre una base recién creada
- **THEN** las 53 migraciones quedan aplicadas
- **AND** cada versión queda registrada en `supabase_migrations.schema_migrations`

#### Scenario: Segunda ejecución sin cambios

- **WHEN** se vuelve a ejecutar el proceso sin migraciones nuevas
- **THEN** no se aplica ninguna y el esquema queda intacto

#### Scenario: Una migración falla

- **WHEN** una migración falla a mitad de camino
- **THEN** esa migración se revierte por completo
- **AND** no queda registrada como aplicada
- **AND** el proceso se detiene informando cuál falló

#### Scenario: Se agrega una migración nueva más adelante

- **WHEN** se añade una migración con número mayor y se vuelve a ejecutar el proceso
- **THEN** solo se aplica la nueva

### Requirement: El estado inicial queda verificado tras migrar

Tras aplicar las migraciones, el despliegue SHALL permitir comprobar que los objetos de los que depende el app existen.

#### Scenario: Los buckets quedan creados

- **WHEN** se consultan los buckets tras migrar
- **THEN** existen `avatars`, `flow-media`, `chat-media`, `contact-documents` y `showcase-media`

#### Scenario: Se puede crear el primer usuario y entrar

- **WHEN** se crea un usuario y se inicia sesión en el app
- **THEN** la sesión se establece y el panel carga

### Requirement: Las tareas programadas se ejecutan solas

El despliegue SHALL invocar periódicamente `GET /api/automations/cron` y `GET /api/flows/cron` con el secreto compartido en la cabecera `x-cron-secret`. Ambas rutas devuelven 503 mientras `AUTOMATION_CRON_SECRET` no esté definido, así que el despliegue SHALL exigir esa variable.

#### Scenario: Un paso Wait avanza sin intervención

- **WHEN** una automatización con un paso Wait cumple su tiempo de espera
- **THEN** la ejecución continúa sin que nadie llame manualmente a ninguna URL

#### Scenario: Falta el secreto

- **WHEN** el stack se levanta sin `AUTOMATION_CRON_SECRET`
- **THEN** la verificación previa lo señala como error de configuración

#### Scenario: Las rutas de cron no se exponen a internet

- **WHEN** el programador invoca las rutas
- **THEN** lo hace por la red interna del stack, sin pasar por el proxy público

### Requirement: Existe un respaldo completo y automático

El despliegue SHALL producir, de forma programada y sin intervención, un respaldo que incluya tanto el volcado de la base como los archivos de Storage, con una política de retención definida.

#### Scenario: El respaldo diario se genera

- **WHEN** transcurre el intervalo programado
- **THEN** queda un volcado de la base y una copia de los archivos de Storage, fechados

#### Scenario: Se aplica la retención

- **WHEN** un respaldo supera la antigüedad de retención
- **THEN** se elimina automáticamente

#### Scenario: Un respaldo fallido no pasa desapercibido

- **WHEN** el proceso de respaldo falla
- **THEN** el fallo queda registrado de forma visible y no se reporta como exitoso

### Requirement: La restauración está probada, no solo escrita

El despliegue SHALL incluir un procedimiento de restauración ejecutado y verificado al menos una vez antes de considerar el stack listo para producción.

#### Scenario: Restauración sobre un stack vacío

- **WHEN** se restaura un respaldo sobre un stack recién levantado
- **THEN** el app arranca, los usuarios pueden entrar, las conversaciones están y los archivos se descargan

### Requirement: El stack se actualiza de forma controlada

Las imágenes SHALL estar fijadas a versiones explícitas, nunca a una etiqueta móvil. Actualizar SHALL exigir un respaldo previo.

#### Scenario: Ninguna imagen usa etiqueta móvil

- **WHEN** se revisa la configuración del stack
- **THEN** ninguna imagen usa `latest` ni una etiqueta equivalente

#### Scenario: Actualización con red de seguridad

- **WHEN** se actualiza una versión del stack
- **THEN** existe un respaldo inmediatamente anterior al que volver

### Requirement: La documentación de operación acompaña al despliegue

El repositorio SHALL documentar cómo instalar desde cero, cómo actualizar, cómo rotar secretos, cómo restaurar y cómo diagnosticar los fallos frecuentes. La documentación existente que afirma que Supabase es externo SHALL actualizarse.

#### Scenario: Un operador nuevo despliega desde cero

- **WHEN** alguien que no participó en este trabajo sigue la documentación en un servidor limpio
- **THEN** llega a un CRM funcionando sin tener que leer el código ni preguntar

#### Scenario: La documentación no se contradice

- **WHEN** se lee `docs/docker.md` tras el cambio
- **THEN** ya no afirma que no se incluye un contenedor de base de datos
