# deal-vehicle-link Specification

## Purpose
TBD - created by archiving change crear-negocio-desde-bandeja-con-vehiculo. Update Purpose after archive.
## Requirements
### Requirement: Un negocio puede tener un vehículo vinculado
Un negocio SHALL poder tener como máximo un vehículo del inventario vinculado, y el vínculo es opcional. El vehículo MUST pertenecer a la misma cuenta que el negocio. Si el vehículo se borra, el negocio SHALL conservarse sin vehículo.

#### Scenario: Negocio con vehículo
- **WHEN** se guarda un negocio con un vehículo de la misma cuenta
- **THEN** el negocio queda vinculado a ese vehículo

#### Scenario: Negocio sin vehículo
- **WHEN** se guarda un negocio sin elegir vehículo
- **THEN** el negocio se guarda igual que hoy

#### Scenario: Vehículo de otra cuenta
- **WHEN** se intenta vincular un negocio a un vehículo de otra cuenta
- **THEN** la base rechaza el cambio

#### Scenario: Se borra el vehículo
- **WHEN** se borra un vehículo vinculado a un negocio
- **THEN** el negocio sigue existiendo, sin vehículo

### Requirement: Selector de vehículo con sugeridos
El formulario de negocio SHALL ofrecer un selector de vehículo que busque por marca, modelo, año o placa entre los vehículos disponibles y reservados de la cuenta. Cuando el negocio tiene contacto, el selector SHALL mostrar primero, como sugeridos, los vehículos que ese contacto consultó, del más reciente al más antiguo y sin repetir. Los vendidos y ocultos no SHALL ofrecerse, salvo el que ya está vinculado al negocio que se edita.

#### Scenario: Búsqueda
- **WHEN** el asesor escribe "mazda 2012"
- **THEN** el selector lista los vehículos disponibles o reservados que coinciden con todos los términos

#### Scenario: Sugeridos por consulta
- **WHEN** el contacto consultó desde la vitrina un Kia Picanto y después un Mazda 3
- **THEN** el selector muestra primero Mazda 3 y luego Kia Picanto como sugeridos

#### Scenario: Vehículo vendido
- **WHEN** un vehículo está vendido u oculto
- **THEN** no aparece en el selector, ni siquiera entre los sugeridos

#### Scenario: Editar un negocio cuyo vehículo ya se vendió
- **WHEN** se edita un negocio vinculado a un vehículo que ahora está vendido
- **THEN** el selector sigue mostrando ese vehículo como el elegido

### Requirement: Autollenado de valor y título
Al elegir un vehículo, el formulario SHALL poner el precio del vehículo como valor del negocio. SHALL poner "Marca Modelo Año" como título si el título está vacío o si todavía es el que se autollenó con otro vehículo. El asesor SHALL poder editar ambos campos después. Quitar el vehículo no SHALL borrar el valor ni el título.

#### Scenario: Elegir vehículo con título vacío
- **WHEN** el asesor elige un Mazda 3 2012 de $37.000.000 con el título vacío
- **THEN** el valor queda en 37000000 y el título en "Mazda 3 2012"

#### Scenario: Título escrito a mano
- **WHEN** el asesor escribió "Retoma de Juan" y luego elige un vehículo
- **THEN** el valor se llena con el precio y el título no cambia

#### Scenario: Cambiar de vehículo
- **WHEN** el asesor cambia el Mazda 3 2012 autollenado por un Kia Picanto 2012
- **THEN** el título pasa a "Kia Picanto 2012" y el valor al precio del Kia

#### Scenario: Ajuste manual del valor
- **WHEN** después de elegir el vehículo el asesor cambia el valor a 35000000 y guarda
- **THEN** el negocio queda con valor 35000000

### Requirement: El vehículo se ve donde se ve el negocio
La tarjeta del negocio en la bandeja, el formulario de negocio y las tarjetas del tablero de Embudos SHALL mostrar el vehículo vinculado como "Marca Modelo Año", junto con la placa si la tiene. Un negocio sin vehículo se ve igual que hoy.

#### Scenario: Tarjeta del tablero
- **WHEN** un negocio tiene vinculado un Mazda 3 2012
- **THEN** su tarjeta en el tablero muestra "Mazda 3 2012"

#### Scenario: Tarjeta de la bandeja
- **WHEN** el contacto abierto en la bandeja tiene un negocio con vehículo
- **THEN** la tarjeta del negocio muestra el vehículo
