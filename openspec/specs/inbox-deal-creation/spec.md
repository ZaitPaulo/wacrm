# inbox-deal-creation Specification

## Purpose
TBD - created by archiving change crear-negocio-desde-bandeja-con-vehiculo. Update Purpose after archive.
## Requirements
### Requirement: Crear negocio desde el panel de la bandeja
La sección "Negocios" del panel lateral de la bandeja SHALL tener siempre un botón **+** para crear un negocio. Si el contacto no tiene negocios, SHALL mostrar un botón "Crear negocio" en lugar del texto "Sin negocios". Los dos SHALL abrir el formulario de negocio con el contacto de la conversación ya puesto y sin poder cambiarlo.

#### Scenario: Contacto sin negocios
- **WHEN** el asesor abre una conversación cuyo contacto no tiene negocios
- **THEN** la sección Negocios muestra el botón "Crear negocio"

#### Scenario: Contacto con negocios
- **WHEN** el contacto ya tiene un negocio
- **THEN** la sección muestra la tarjeta del negocio y el + del título sigue disponible para crear otro

#### Scenario: Contacto fijo
- **WHEN** se abre el formulario desde la bandeja
- **THEN** el contacto es el de la conversación y no se puede cambiar

### Requirement: Embudo y etapa por defecto
El formulario abierto desde la bandeja SHALL dejar elegir el embudo entre los de la cuenta. SHALL proponer el embudo llamado "Ventas" (sin distinguir mayúsculas ni espacios) o, si no existe, el primero por fecha de creación, y la etapa de menor posición de ese embudo. Al cambiar de embudo, la etapa SHALL pasar a la primera del nuevo embudo.

#### Scenario: Cuenta con Ventas
- **WHEN** se abre el formulario desde la bandeja en la cuenta de producción
- **THEN** quedan propuestos el embudo Ventas y la etapa Prospecto

#### Scenario: Cambio de embudo
- **WHEN** el asesor cambia a "Sales Pipeline"
- **THEN** la etapa pasa a la primera de "Sales Pipeline"

### Requirement: El negocio creado aparece sin recargar
Al guardar, el negocio SHALL crearse abierto (`status = open`) con la conversación vinculada, igual que desde el tablero, y SHALL aparecer en el panel de la bandeja sin recargar la página. Si falla, SHALL mostrarse un aviso de error y el formulario SHALL seguir abierto con lo escrito.

#### Scenario: Creación correcta
- **WHEN** el asesor guarda un negocio nuevo desde la bandeja
- **THEN** el formulario se cierra y la tarjeta del negocio aparece en la sección Negocios, con su selector de etapa

#### Scenario: Error al guardar
- **WHEN** la base rechaza el negocio
- **THEN** se muestra un aviso de error y el formulario conserva los datos
