## ADDED Requirements

### Requirement: Marcar un vehículo como vendido exige registrar el cierre

Cuando un vehículo pasa al estado `sold`, el sistema SHALL solicitar el **precio final de venta** y la **fecha de venta**, y SHALL permitir vincular opcionalmente el **contacto comprador**. El precio final SHALL persistirse por separado del precio de lista (`inventory_vehicles.price`), que no se modifica.

El precio final SHALL ser un monto no negativo y PUEDE diferir del precio de lista en cualquier dirección (descuento o sobreprecio). La fecha de venta SHALL tener como valor por defecto la fecha actual.

#### Scenario: Cierre de venta completo

- **WHEN** un usuario cambia el estado de un vehículo a `sold` e indica precio final, fecha y contacto comprador
- **THEN** el vehículo queda en estado `sold` con precio de cierre, fecha y comprador persistidos, y su precio de lista permanece intacto

#### Scenario: Venta sin comprador identificado

- **WHEN** un usuario cierra la venta sin vincular ningún contacto
- **THEN** la venta se registra con precio y fecha, y el comprador queda vacío

#### Scenario: Venta con descuento sobre el precio de lista

- **WHEN** el precio final indicado es menor que el precio de lista del vehículo
- **THEN** el sistema acepta el valor sin advertencia y conserva ambos montos por separado

#### Scenario: El usuario cancela el diálogo de venta

- **WHEN** un usuario abre el cambio de estado a `sold` y cancela sin completar los datos
- **THEN** el vehículo conserva su estado anterior y no se registra ningún dato de cierre

### Requirement: La venta se puede revertir

El sistema SHALL permitir devolver un vehículo vendido a un estado no vendido (por ejemplo `available` o `reserved`). Al hacerlo, los datos de cierre SHALL limpiarse, de modo que un vehículo que no está vendido nunca conserve precio o fecha de venta.

#### Scenario: Se revierte una venta cargada por error

- **WHEN** un usuario cambia un vehículo de `sold` a `available`
- **THEN** el precio de cierre, la fecha de venta y el comprador quedan vacíos, y el vehículo vuelve a contarse como stock disponible

### Requirement: El comprador vinculado debe pertenecer a la cuenta

El contacto comprador SHALL referenciar un contacto existente de la misma cuenta. Si ese contacto es eliminado más adelante, el registro de la venta SHALL conservarse y sólo perder el vínculo con el comprador.

#### Scenario: Se elimina el contacto de un comprador

- **WHEN** se elimina un contacto que figuraba como comprador de un vehículo vendido
- **THEN** el vehículo sigue vendido, con su precio y fecha intactos, y queda sin comprador vinculado

### Requirement: Sólo agent o superior puede registrar ventas

El registro y la reversión de una venta SHALL exigir rol `agent` o superior, igual que el resto de la escritura sobre el inventario. El precio final de venta SHALL ser legible por cualquier miembro de la cuenta, ya que no es un dato reservado.

#### Scenario: Un miembro de sólo lectura intenta cerrar una venta

- **WHEN** un miembro con rol `viewer` intenta marcar un vehículo como vendido
- **THEN** la operación es rechazada

#### Scenario: Un vendedor consulta las ventas del equipo

- **WHEN** un miembro con rol `agent` consulta los vehículos vendidos
- **THEN** ve el precio final de venta de cada uno, sin ver ningún costo de adquisición
