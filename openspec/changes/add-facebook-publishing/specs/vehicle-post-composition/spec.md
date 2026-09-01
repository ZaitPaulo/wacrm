## MODIFIED Requirements

### Requirement: La publicación es un carrusel con las fotos del vehículo

La publicación SHALL llevar las imágenes del vehículo agrupadas en una sola entrada, en el orden en que están cargadas, y SHALL respetar el máximo de elementos que acepta **la red de destino**.

Cuando el vehículo tenga más fotos que ese máximo, se SHALL tomar las primeras y descartar el resto, sin impedir la publicación.

El máximo NO SHALL ser un valor único del sistema: cada red fija el suyo y lo cambia por su cuenta.

#### Scenario: Vehículo con varias fotos

- **WHEN** se prepara la publicación de un vehículo con varias imágenes
- **THEN** todas van en una misma entrada, en el orden en que están cargadas

#### Scenario: Vehículo con más fotos de las que acepta la red

- **WHEN** el vehículo tiene más imágenes que el máximo admitido por la red de destino
- **THEN** la publicación se arma con las primeras hasta ese máximo, y las restantes se omiten

#### Scenario: Redes con máximos distintos

- **WHEN** un vehículo tiene más fotos de las que acepta una red pero no más de las que acepta la otra
- **THEN** cada publicación se arma con las fotos que su red admite, sin recortar la que no lo necesita

#### Scenario: Vehículo con una sola foto

- **WHEN** el vehículo tiene exactamente una imagen
- **THEN** la publicación se arma igual con esa única imagen

### Requirement: Las imágenes se entregan en el formato que la red acepta

Las redes no aceptan los mismos formatos de imagen, y el sistema almacena varios. Antes de publicar, las imágenes que no estén en un formato aceptado SHALL convertirse, y la copia convertida SHALL quedar accesible públicamente para que la red pueda descargarla.

La copia convertida SHALL poder reutilizarse entre redes: convertir la misma foto dos veces para publicar el mismo vehículo en dos redes es trabajo desperdiciado.

Un vehículo NO SHALL quedar sin publicar por el formato en que se subieron sus fotos.

#### Scenario: Fotos en un formato que la red no acepta

- **WHEN** se publica un vehículo cuyas fotos están en un formato no admitido por la red de destino
- **THEN** se publican igual, a partir de copias convertidas al formato aceptado

#### Scenario: Fotos ya en el formato aceptado

- **WHEN** las fotos del vehículo ya están en un formato admitido
- **THEN** se usan tal cual, sin generar copias

#### Scenario: El mismo vehículo se publica en la segunda red

- **WHEN** se publica en una red un vehículo cuyas fotos ya se convirtieron al publicarlo en la otra
- **THEN** se reutilizan las copias existentes en lugar de convertirlas de nuevo

#### Scenario: La conversión falla

- **WHEN** una imagen no puede convertirse
- **THEN** la publicación no se envía, queda como fallida indicando un problema con las imágenes, y no se reporta como problema de conexión

### Requirement: El texto respeta los límites de la red de destino

El texto de la publicación SHALL mantenerse dentro del máximo de caracteres y del máximo de etiquetas que acepta **la red a la que va**, tanto el generado por el sistema como el editado por una persona.

Un texto que exceda el límite SHALL rechazarse al momento de editarlo, no al momento de publicar: descubrirlo por el rechazo de la red desperdicia una aprobación.

Los límites de una red NO SHALL aplicarse a otra. Advertir por un tope que en el destino real no existe impide escribir algo perfectamente válido.

#### Scenario: Texto dentro del límite

- **WHEN** quien revisa guarda un texto dentro de los límites de la red de esa publicación
- **THEN** se acepta y la publicación queda lista para aprobarse

#### Scenario: Texto demasiado largo

- **WHEN** quien revisa intenta guardar un texto que excede el máximo de caracteres de esa red
- **THEN** se rechaza indicando el límite, antes de intentar publicar

#### Scenario: Demasiadas etiquetas

- **WHEN** el texto supera el máximo de etiquetas admitido por esa red
- **THEN** se rechaza indicando el límite

#### Scenario: Texto válido en una red y no en la otra

- **WHEN** quien revisa escribe un texto que excede el límite de una red pero no el de la otra
- **THEN** se rechaza únicamente en la publicación de la red que lo excede

### Requirement: Sin imágenes no hay publicación

Un vehículo sin imágenes NO SHALL generar una publicación pendiente en ninguna red. La publicación es una ficha visual del vehículo, y sin foto no hay nada que armar.

#### Scenario: Vehículo sin fotos

- **WHEN** un vehículo sin imágenes queda disponible
- **THEN** no se prepara ninguna publicación en ninguna red, y el motivo queda registrado

#### Scenario: Se agregan fotos después

- **WHEN** se editan las imágenes de un vehículo disponible que no tenía ninguna
- **THEN** se preparan las publicaciones que antes no pudieron armarse, una por red conectada

## ADDED Requirements

### Requirement: El texto propuesto es el mismo en todas las redes

El sistema SHALL proponer el mismo texto para la publicación de un vehículo en todas las redes. NO SHALL existir una plantilla por red.

El formato lo definió el negocio y el sistema lo calca de lo que ya venía publicando a mano. Inventarle una variante por red sería decidir por el cliente algo que no pidió, y obligaría a quien revisa a leer dos textos distintos del mismo auto.

Lo editado por una persona SHALL quedar acotado a la publicación que editó, porque cada publicación es una decisión sobre un destino concreto.

#### Scenario: Se prepara el mismo vehículo en dos redes

- **WHEN** un vehículo disponible genera publicaciones pendientes en las dos redes
- **THEN** ambas se proponen con el mismo texto

#### Scenario: Se edita el texto de una publicación

- **WHEN** quien revisa edita el texto de la publicación de una red
- **THEN** la publicación de la otra red conserva el texto propuesto original

#### Scenario: Cambia un dato del negocio

- **WHEN** cambia un dato público del negocio que aparece en el texto
- **THEN** las publicaciones pendientes sin editar de todas las redes se refrescan con el texto nuevo
