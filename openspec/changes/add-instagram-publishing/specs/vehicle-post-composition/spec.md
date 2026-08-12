## ADDED Requirements

### Requirement: La publicación se arma con los datos que ya tiene el vehículo

La publicación preparada SHALL construirse a partir de la ficha del vehículo: sus imágenes y sus datos comerciales —marca, línea, año, precio, kilometraje y ficha técnica—, sin pedirle nada nuevo a quien cargó el auto.

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

### Requirement: Sin imágenes no hay publicación

Un vehículo sin imágenes NO SHALL generar una publicación pendiente. Instagram exige contenido visual, y una publicación sin foto no puede armarse.

#### Scenario: Vehículo sin fotos

- **WHEN** un vehículo sin imágenes queda disponible
- **THEN** no se prepara ninguna publicación, y el motivo queda registrado

#### Scenario: Se agregan fotos después

- **WHEN** se editan las imágenes de un vehículo disponible que no tenía ninguna
- **THEN** se prepara la publicación que antes no pudo armarse

### Requirement: El costo de compra nunca aparece en la publicación

La publicación NUNCA SHALL incluir el costo de adquisición ni ningún dato derivado de él. Es información reservada a `admin` o superior dentro del sistema, y una publicación es contenido público.

#### Scenario: Vehículo con costo registrado

- **WHEN** se prepara la publicación de un vehículo que tiene costo de compra registrado
- **THEN** ni el costo ni el margen aparecen en el contenido preparado

### Requirement: El contacto de la publicación es el del negocio

El texto SHALL invitar a contactar por los canales públicos configurados del negocio, los mismos que usa la vitrina.

#### Scenario: Negocio con contacto configurado

- **WHEN** se arma la publicación de una cuenta con datos públicos de contacto
- **THEN** el texto invita a escribir por esos canales

#### Scenario: Negocio sin contacto configurado

- **WHEN** la cuenta no tiene canales públicos configurados
- **THEN** la publicación se arma igual, con una invitación genérica a consultar, sin inventar datos de contacto
