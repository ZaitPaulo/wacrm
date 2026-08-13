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

### Requirement: La publicación es un carrusel con las fotos del vehículo

La publicación SHALL llevar las imágenes del vehículo como un carrusel, en el orden en que están cargadas, y SHALL respetar el máximo de elementos que acepta Instagram.

Cuando el vehículo tenga más fotos que ese máximo, se SHALL tomar las primeras y descartar el resto, sin impedir la publicación.

#### Scenario: Vehículo con varias fotos

- **WHEN** se prepara la publicación de un vehículo con varias imágenes
- **THEN** todas van en un mismo carrusel, en el orden en que están cargadas

#### Scenario: Vehículo con más fotos de las que acepta Instagram

- **WHEN** el vehículo tiene más imágenes que el máximo admitido
- **THEN** la publicación se arma con las primeras hasta ese máximo, y las restantes se omiten

#### Scenario: Vehículo con una sola foto

- **WHEN** el vehículo tiene exactamente una imagen
- **THEN** la publicación se arma igual con esa única imagen

### Requirement: Las imágenes se entregan en el formato que Instagram acepta

Instagram solo admite JPEG, y el sistema almacena además otros formatos. Antes de publicar, las imágenes que no estén en un formato aceptado SHALL convertirse, y la copia convertida SHALL quedar accesible públicamente para que Instagram pueda descargarla.

Un vehículo NO SHALL quedar sin publicar por el formato en que se subieron sus fotos.

#### Scenario: Fotos en un formato que Instagram no acepta

- **WHEN** se publica un vehículo cuyas fotos están en un formato no admitido
- **THEN** se publican igual, a partir de copias convertidas al formato aceptado

#### Scenario: Fotos ya en el formato aceptado

- **WHEN** las fotos del vehículo ya están en un formato que Instagram admite
- **THEN** se usan tal cual, sin generar copias

#### Scenario: La conversión falla

- **WHEN** una imagen no puede convertirse
- **THEN** la publicación no se envía, queda como fallida indicando un problema con las imágenes, y no se reporta como problema de conexión

### Requirement: El texto respeta los límites de Instagram

El texto de la publicación SHALL mantenerse dentro del máximo de caracteres y del máximo de etiquetas que acepta Instagram, tanto el generado por el sistema como el editado por una persona.

Un texto que exceda el límite SHALL rechazarse al momento de editarlo, no al momento de publicar: descubrirlo por el rechazo de Instagram desperdicia una aprobación.

#### Scenario: Texto dentro del límite

- **WHEN** quien revisa guarda un texto dentro de los límites
- **THEN** se acepta y la publicación queda lista para aprobarse

#### Scenario: Texto demasiado largo

- **WHEN** quien revisa intenta guardar un texto que excede el máximo de caracteres
- **THEN** se rechaza indicando el límite, antes de intentar publicar

#### Scenario: Demasiadas etiquetas

- **WHEN** el texto supera el máximo de etiquetas admitido
- **THEN** se rechaza indicando el límite

### Requirement: La reescritura del texto con IA es opcional y la pide una persona

El sistema SHALL armar el texto propuesto con una plantilla, siempre. PODRÁ ofrecer reescribirlo con la IA de la cuenta, pero solo a pedido explícito de quien revisa y nunca al preparar la publicación.

Una cuenta sin IA configurada SHALL tener la cola igual de funcional; la reescritura es una comodidad, no un requisito.

#### Scenario: Cuenta sin IA configurada

- **WHEN** se prepara una publicación en una cuenta que no tiene IA configurada
- **THEN** el texto propuesto se arma igual con la plantilla, y la reescritura no se ofrece

#### Scenario: Quien revisa pide reescribir

- **WHEN** quien revisa pide reescribir el texto en una cuenta con IA configurada
- **THEN** se le propone el texto reescrito y puede aceptarlo, editarlo o conservar el original

#### Scenario: Preparar una publicación no llama a la IA

- **WHEN** un vehículo queda disponible y se prepara su publicación
- **THEN** el texto sale de la plantilla y no se consume IA

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

Tampoco SHALL incluir las notas internas del vehículo. El knowledge base sí las usa porque alimenta respuestas internas; una publicación no.

#### Scenario: Vehículo con costo registrado

- **WHEN** se prepara la publicación de un vehículo que tiene costo de compra registrado
- **THEN** ni el costo ni el margen aparecen en el contenido preparado

#### Scenario: Vehículo con notas internas

- **WHEN** se prepara la publicación de un vehículo que tiene notas internas
- **THEN** esas notas no aparecen en el contenido preparado

### Requirement: El contacto de la publicación es el del negocio

El texto SHALL invitar a contactar por los canales públicos configurados del negocio, los mismos que usa la vitrina.

#### Scenario: Negocio con contacto configurado

- **WHEN** se arma la publicación de una cuenta con datos públicos de contacto
- **THEN** el texto invita a escribir por esos canales

#### Scenario: Negocio sin contacto configurado

- **WHEN** la cuenta no tiene canales públicos configurados
- **THEN** la publicación se arma igual, con una invitación genérica a consultar, sin inventar datos de contacto
