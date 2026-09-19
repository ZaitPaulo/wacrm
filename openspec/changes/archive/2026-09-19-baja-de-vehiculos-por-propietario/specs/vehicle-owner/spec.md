## ADDED Requirements

### Requirement: Un vehículo puede tener un propietario

Un vehículo del inventario SHALL poder tener como máximo un propietario, que es un contacto de la misma cuenta. El propietario SHALL ser opcional y distinto del comprador (`sold_to_contact_id`): el propietario es quien lo pone en venta, el comprador es quien lo compra. Un vehículo sin propietario MUST NOT verse afectado por ninguna baja automática.

#### Scenario: Asignar el propietario desde el formulario
- **WHEN** un agente edita el Mazda 2 `KQS325` y elige como propietario a "Royse Salas"
- **THEN** el vehículo queda con ese contacto como propietario y su estado no cambia

#### Scenario: Quitar el propietario
- **WHEN** un agente elige "Sin propietario" en un vehículo que tenía uno
- **THEN** el vehículo queda sin propietario

#### Scenario: Vehículo sin propietario
- **WHEN** un vehículo no tiene propietario
- **THEN** ninguna respuesta ni ningún silencio de ningún contacto lo oculta

### Requirement: El propietario se elige sin ambigüedad

El propietario SHALL elegirse en la ficha del vehículo, de una lista de los contactos de la cuenta que se puede buscar por nombre (sin distinguir mayúsculas ni tildes) o por teléfono, y que muestra el nombre y el teléfono de cada contacto para distinguir homónimos. La lista MUST incluir todos los contactos de la cuenta, aunque sean más de los que devuelve una sola consulta. El sistema MUST rechazar como propietario un contacto que no pertenezca a la cuenta del vehículo.

#### Scenario: Buscar por teléfono
- **WHEN** el agente escribe `4445896` en el buscador del propietario
- **THEN** la lista muestra a "Royse Salas", cuyo teléfono lo contiene

#### Scenario: Dos contactos con el mismo nombre
- **WHEN** existen dos contactos "Alberto Barros" con teléfonos distintos
- **THEN** el selector los muestra con su teléfono y el agente puede elegir el correcto

#### Scenario: Contacto de otra cuenta
- **WHEN** una petición intenta asignar como propietario un contacto de otra cuenta
- **THEN** la petición se rechaza y el vehículo no cambia

### Requirement: Borrar el contacto no borra el vehículo

Si se borra el contacto propietario, el vehículo SHALL quedar sin propietario y MUST conservar todos sus demás datos y su estado.

#### Scenario: Se borra el propietario
- **WHEN** se borra el contacto propietario de un vehículo disponible
- **THEN** el vehículo sigue disponible, sin propietario

### Requirement: Carga inicial del propietario desde la lista del cliente

El sistema SHALL ofrecer una forma de asignar el propietario de los vehículos existentes a partir de la lista del cliente, emparejando la placa del vehículo con el teléfono del contacto. La carga MUST asignar propietario solo a vehículos que no tengan uno, MUST comparar el teléfono en su forma normalizada, y SHALL informar qué filas de la lista no encontraron vehículo o contacto.

#### Scenario: Placa y teléfono encontrados
- **WHEN** la lista trae `KQS325` con el teléfono `573244445896` y existen ese vehículo sin propietario y ese contacto
- **THEN** el vehículo queda con ese contacto como propietario

#### Scenario: Un dueño con dos vehículos
- **WHEN** el teléfono `573054505585` aparece con `KQU991` y con `JVS212`
- **THEN** los dos vehículos quedan con ese contacto como propietario

#### Scenario: Placa que no está en el inventario
- **WHEN** la lista trae una placa que no existe en el inventario de la cuenta
- **THEN** esa fila no asigna nada y aparece en el informe de lo no encontrado

#### Scenario: El vehículo ya tiene otro propietario
- **WHEN** un vehículo de la lista ya tiene un propietario asignado a mano
- **THEN** la carga no lo cambia
