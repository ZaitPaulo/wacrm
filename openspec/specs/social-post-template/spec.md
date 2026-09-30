# social-post-template Specification

## Purpose
TBD - created by archiving change plantilla-publicacion-editable. Update Purpose after archive.
## Requirements
### Requirement: El texto de la publicación sale de una plantilla de la cuenta

Cada cuenta SHALL tener una plantilla de texto para las publicaciones de vehículos, y el texto propuesto de toda publicación SHALL armarse a partir de ella. La plantilla SHALL ser la misma para todas las redes.

Mientras la cuenta no haya definido la suya, SHALL usarse la plantilla por defecto, que calca el formato del negocio: marca y línea, modelo, kilometraje, transmisión, motor, ciudad de placas, SOAT, tecnomecánica, `PRECIO DE VENTA` con el precio con garantía, `GARANTÍA INCLUIDA POR 12 MESES` y, a continuación, el cierre comercial (financiación, dirección, invitación a agendar, contacto, etiquetas y nombre comercial).

#### Scenario: Cuenta sin plantilla propia

- **WHEN** se prepara la publicación de un vehículo en una cuenta que nunca editó la plantilla
- **THEN** el texto sigue la plantilla por defecto y no incluye una línea aparte de "precio con garantía"

#### Scenario: Cuenta con plantilla propia

- **WHEN** la cuenta guardó una plantilla propia y se prepara una publicación
- **THEN** el texto sigue esa plantilla

### Requirement: La plantilla usa variables con nombre y omite las líneas sin dato

La plantilla SHALL poder citar datos del vehículo y del negocio mediante variables entre llaves, de un catálogo cerrado: `{marca}`, `{modelo}`, `{año}`, `{kilometraje}`, `{transmision}`, `{motor}`, `{ciudad_placa}`, `{soat}`, `{tecno}`, `{precio}`, `{precio_sin_garantia}`, `{direccion}`, `{contacto}` y `{nombre}`.

Una línea de la plantilla con alguna variable cuyo dato falte SHALL omitirse completa. Las líneas sin variables SHALL salir tal cual. `{soat}` y `{tecno}` SHALL valer "NA" cuando falte la fecha, y la línea NO SHALL omitirse. `{contacto}` SHALL caer en la invitación genérica cuando el negocio no tenga canales, sin inventar datos.

El catálogo NO SHALL exponer datos reservados (costo de adquisición, notas internas, VIN, placa).

#### Scenario: Dato opcional ausente

- **WHEN** la plantilla tiene la línea `PLACAS DE {ciudad_placa}` y el vehículo no tiene ciudad de matrícula
- **THEN** esa línea no aparece en el texto y las demás sí

#### Scenario: SOAT sin fecha

- **WHEN** el vehículo no tiene fecha de vencimiento del SOAT
- **THEN** la línea del SOAT aparece con "NA"

#### Scenario: Línea de texto fijo

- **WHEN** la plantilla tiene la línea `GARANTÍA INCLUIDA POR 12 MESES`
- **THEN** esa línea aparece igual en todas las publicaciones

#### Scenario: Precio sin garantía disponible como variable

- **WHEN** la plantilla usa `{precio_sin_garantia}`
- **THEN** se muestra el precio de venta del vehículo, en la moneda y el formato de la vitrina

### Requirement: Un administrador edita la plantilla desde Configuración

Configuración SHALL ofrecer, solo a administradores, una sección para editar la plantilla de publicación, con la lista de variables disponibles, una vista previa con un vehículo de la cuenta y la opción de volver a la plantilla por defecto.

Al guardar, el sistema SHALL rechazar una plantilla que cite una variable fuera del catálogo e indicar cuál es. Una plantilla vacía SHALL equivaler a volver a la de defecto.

#### Scenario: Guardar una plantilla válida

- **WHEN** un administrador guarda una plantilla que solo usa variables del catálogo
- **THEN** se guarda y las publicaciones nuevas la usan

#### Scenario: Variable mal escrita

- **WHEN** un administrador intenta guardar una plantilla con `{precio_garantia}`
- **THEN** se rechaza indicando que `precio_garantia` no es una variable válida, y la plantilla anterior sigue vigente

#### Scenario: Restaurar la plantilla por defecto

- **WHEN** un administrador elige volver a la plantilla por defecto
- **THEN** las publicaciones siguientes se arman con la plantilla por defecto

#### Scenario: Un agente no puede editarla

- **WHEN** un usuario con rol de agente intenta guardar la plantilla
- **THEN** la operación se rechaza por permisos

### Requirement: Cambiar la plantilla actualiza los borradores no editados

Al cambiar la plantilla, las publicaciones pendientes cuyo texto no editó una persona SHALL volver a proponerse con la plantilla nueva. Las que editó una persona y las ya publicadas NO SHALL modificarse.

#### Scenario: Pendiente sin editar

- **WHEN** se cambia la plantilla y existe un borrador pendiente sin edición manual
- **THEN** al revisar la cola ese borrador muestra el texto armado con la plantilla nueva

#### Scenario: Pendiente editado a mano

- **WHEN** se cambia la plantilla y existe un borrador pendiente cuyo texto editó una persona
- **THEN** ese borrador conserva el texto editado

