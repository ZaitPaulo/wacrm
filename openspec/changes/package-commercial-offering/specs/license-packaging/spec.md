## ADDED Requirements

### Requirement: La instalación en infraestructura del cliente está documentada y es reproducible

El modelo de licencia única implica desplegar en servidores del cliente. SHALL existir un procedimiento documentado que lleve de una máquina limpia a un sistema operando, y ese procedimiento SHALL haberse ejecutado completo al menos una vez sobre un entorno nuevo antes de ofrecerse a un cliente.

La documentación SHALL cubrir requisitos previos, variables de entorno necesarias, aplicación de migraciones, creación de la primera cuenta y verificación de que el despliegue quedó bien.

#### Scenario: Instalación desde cero

- **WHEN** alguien sigue el procedimiento sobre una máquina sin nada preinstalado
- **THEN** obtiene un sistema funcionando, con su primera cuenta creada y capaz de iniciar sesión

#### Scenario: Verificación posterior

- **WHEN** termina la instalación
- **THEN** el procedimiento indica cómo comprobar que la base, la aplicación y la conexión de WhatsApp responden

### Requirement: La entrega no arrastra credenciales del proveedor

El paquete entregado NO SHALL contener claves, tokens ni cadenas de conexión del entorno de desarrollo o de otros clientes. El procedimiento SHALL exigir que cada instalación genere sus propias credenciales.

#### Scenario: Revisión del paquete de entrega

- **WHEN** se prepara la entrega para un cliente
- **THEN** no incluye ningún archivo de configuración con valores reales, sólo plantillas de ejemplo

#### Scenario: Puesta en marcha

- **WHEN** el cliente instala el sistema
- **THEN** el procedimiento le hace generar sus propias credenciales antes del primer arranque

### Requirement: Las actualizaciones son aplicables sin perder datos

SHALL documentarse cómo llevar una instalación existente a una versión posterior, incluyendo la aplicación de migraciones pendientes y cómo respaldar antes de empezar.

#### Scenario: Actualización de una instalación en uso

- **WHEN** se actualiza una instalación con datos de producción
- **THEN** el procedimiento indica cómo respaldar, cómo aplicar las migraciones pendientes y cómo verificar que la información quedó intacta
