## ADDED Requirements

### Requirement: El color de acento de la vitrina sale de la cuenta

La vitrina SHALL tomar su color de acento de la configuración pública de la cuenta, no de un valor escrito en el código. Cuando la cuenta no tenga uno configurado, la vitrina SHALL usar un color de respaldo definido en un único lugar.

El color de acento SHALL aplicarse de forma consistente a las llamadas a la acción, los indicadores de estado activo y los detalles de marca, en la portada y en la ficha.

El valor guardado SHALL validarse antes de usarse: un valor ausente o con formato inválido SHALL resolverse al color de respaldo, y NO SHALL romper el render de la página.

#### Scenario: La cuenta tiene color de marca configurado

- **WHEN** la cuenta tiene un color de marca válido y un visitante abre la vitrina
- **THEN** los botones de acción, los filtros activos y los detalles de marca usan ese color, tanto en la portada como en la ficha

#### Scenario: La cuenta no tiene color configurado

- **WHEN** la cuenta no ha configurado un color de marca
- **THEN** la vitrina se muestra completa con el color de respaldo, sin huecos ni errores

#### Scenario: El valor guardado es inválido

- **WHEN** el color guardado no tiene un formato de color válido
- **THEN** la vitrina lo trata como ausente y usa el color de respaldo

### Requirement: La vitrina no depende del tema del CRM

La apariencia de la vitrina SHALL ser independiente de la preferencia de tema y de modo claro/oscuro que un usuario del CRM haya guardado en ese navegador. Un visitante SHALL ver la misma vitrina sin importar si además usa el CRM.

#### Scenario: Un usuario del CRM con modo oscuro abre la vitrina

- **WHEN** una persona que tiene el CRM en modo oscuro abre la vitrina pública en el mismo navegador
- **THEN** la vitrina se ve igual que para cualquier otro visitante

### Requirement: Un vehículo sin fotos se presenta como inventario disponible

Un vehículo publicado sin ninguna foto SHALL presentarse como inventario vendible, no como un contenido faltante. Su tarjeta SHALL mostrar un bloque con la identidad del negocio en lugar de la foto, SHALL declarar que las fotos aún no están, y SHALL ofrecer una llamada a la acción propia para pedirlas.

La tarjeta SHALL conservar toda la información que sí existe —marca, modelo, año, kilometraje, transmisión y precio— con la misma jerarquía que las demás.

#### Scenario: Un vehículo sin fotos en la grilla

- **WHEN** un vehículo publicado no tiene ninguna imagen
- **THEN** su tarjeta muestra el bloque de marca del negocio, indica que las fotos están pendientes, mantiene sus datos y ofrece la acción de pedir fotos en lugar de la acción de consulta habitual

#### Scenario: Un vehículo con fotos

- **WHEN** un vehículo publicado tiene al menos una imagen
- **THEN** su tarjeta muestra la primera imagen y ofrece la acción de consulta habitual

### Requirement: La identidad funciona con o sin logo cargado

La vitrina SHALL mostrar el logo público de la cuenta cuando exista, y el nombre comercial cuando no exista. NO SHALL mostrar ambos a la vez en el mismo lugar, porque un logotipo ya contiene el nombre.

#### Scenario: La cuenta no cargó logo

- **WHEN** la cuenta no tiene logo público configurado
- **THEN** la cabecera y el pie muestran el nombre comercial con el tratamiento tipográfico de la marca

### Requirement: La portada y la ficha comparten el sistema visual

La cabecera, el pie y el sistema visual —paleta, tipografía, tratamiento de botones y de tarjetas— SHALL ser los mismos en la portada y en la ficha de un vehículo. Un visitante que navega entre ambas NO SHALL percibir un cambio de sitio.

#### Scenario: El visitante entra a una ficha y vuelve

- **WHEN** un visitante abre la ficha de un vehículo desde la grilla y luego vuelve al inventario
- **THEN** la cabecera, el pie y el lenguaje visual son los mismos en las dos pantallas
