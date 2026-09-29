## MODIFIED Requirements

### Requirement: La publicación se arma con los datos que ya tiene el vehículo

La publicación preparada SHALL construirse a partir de la ficha del vehículo: sus imágenes y sus datos comerciales —marca, línea, año, precio, kilometraje y ficha técnica—, sin pedirle nada nuevo a quien cargó el auto. El texto SHALL seguir la plantilla de publicación de la cuenta (ver `social-post-template`).

El precio publicado SHALL ser el **precio con garantía** del vehículo. Cuando el vehículo no tenga precio con garantía cargado, SHALL publicarse su precio de venta, de modo que ningún vehículo quede sin precio.

El precio SHALL mostrarse en la moneda de la cuenta, con el mismo formato que usa la vitrina.

#### Scenario: Vehículo con ficha completa

- **WHEN** se prepara la publicación de un vehículo con fotos y datos completos
- **THEN** la publicación incluye sus imágenes y un texto con marca, línea, año, precio y kilometraje

#### Scenario: Vehículo con datos parciales

- **WHEN** el vehículo no tiene alguno de los datos opcionales
- **THEN** la publicación se arma igual, omitiendo lo ausente en vez de mostrar espacios vacíos o marcadores

#### Scenario: Coherencia con la vitrina

- **WHEN** se compara el precio de la publicación con el de la vitrina
- **THEN** ambos se muestran en la misma moneda y con el mismo formato

#### Scenario: Vehículo con precio con garantía

- **WHEN** se prepara la publicación de un vehículo con precio de venta 35.000.000 y precio con garantía 37.100.000
- **THEN** el precio que muestra el texto propuesto es 37.100.000

#### Scenario: Vehículo sin precio con garantía

- **WHEN** se prepara la publicación de un vehículo que solo tiene precio de venta
- **THEN** el texto muestra el precio de venta como precio
