## ADDED Requirements

### Requirement: Un vehículo puede registrar a quién se le compró

Un vehículo del inventario SHALL poder tener como máximo un vendedor: el contacto de la misma cuenta a quien el negocio le compró el vehículo o de quien lo recibió en retoma. También SHALL poder registrar el tipo de adquisición: compra o retoma. Ambos datos SHALL ser opcionales y distintos del propietario (consignación) y del comprador. Los vehículos cargados antes de esta entrega quedan sin vendedor hasta que alguien lo complete.

#### Scenario: Registrar una retoma
- **WHEN** un asesor edita un Chevrolet Spark 2015, elige como vendedor a "Juan Pérez" y como tipo "Retoma"
- **THEN** el vehículo queda con ese vendedor y ese tipo, y la hoja de vida de Juan muestra "Nos entregó en retoma Chevrolet Spark 2015"

#### Scenario: Vehículo sin vendedor
- **WHEN** un vehículo no tiene vendedor registrado
- **THEN** no aparece en la hoja de vida de ningún contacto como compra

#### Scenario: Mismo contacto, varios papeles
- **WHEN** "Juan Pérez" es vendedor de un Spark recibido en retoma y comprador de una CX-30 el mismo día
- **THEN** ambos vehículos se guardan sin error y los dos eventos aparecen en su hoja de vida

### Requirement: El vendedor se elige sin ambigüedad y pertenece a la cuenta

El vendedor SHALL elegirse con el mismo selector de contactos que el propietario: búsqueda por nombre (sin distinguir mayúsculas ni tildes) o por teléfono, mostrando nombre y teléfono, y sobre todos los contactos de la cuenta. El sistema MUST rechazar como vendedor un contacto de otra cuenta.

#### Scenario: Contacto de otra cuenta
- **WHEN** una llamada a la API intenta poner como vendedor un contacto de otra cuenta
- **THEN** la operación es rechazada y el vehículo no cambia

### Requirement: El vendedor es visible para el equipo, el costo sigue reservado

El vendedor y el tipo de adquisición SHALL ser legibles y editables con los mismos permisos que el resto del vehículo (escritura para `agent` o superior). El costo de adquisición SHALL seguir legible solo por `admin` u `owner`, sin cambios.

#### Scenario: El asesor registra la retoma sin ver costos
- **WHEN** un `agent` registra el vendedor de un vehículo
- **THEN** el cambio se guarda y el formulario no le muestra el costo de adquisición

### Requirement: Borrar el contacto no borra la compra

Si se borra el contacto vendedor, el vehículo y su tipo de adquisición SHALL conservarse y solo perder el vínculo con el vendedor.

#### Scenario: Se elimina el vendedor
- **WHEN** se elimina el contacto que figuraba como vendedor de un vehículo
- **THEN** el vehículo sigue en el inventario con su tipo de adquisición y sin vendedor
