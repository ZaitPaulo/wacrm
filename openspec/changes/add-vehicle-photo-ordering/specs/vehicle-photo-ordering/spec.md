## ADDED Requirements

### Requirement: Las fotos de un vehículo tienen un orden elegido

El orden de las fotos de un vehículo SHALL ser un dato que una persona define, no el subproducto del orden en que se subieron los archivos.

Ese orden SHALL vivir en el vehículo y SHALL ser uno solo: no existe un orden por red de destino ni un orden por publicación. Toda pantalla que permita reordenar escribe sobre el mismo dato.

La primera foto del orden SHALL ser la portada del vehículo: es la que encabeza la ficha en la vitrina pública y la que las redes usan para encuadrar el resto.

#### Scenario: Se reordenan las fotos

- **WHEN** una persona cambia el orden de las fotos de un vehículo
- **THEN** el orden nuevo queda guardado en el vehículo y reemplaza al anterior

#### Scenario: Vehículo nunca reordenado

- **WHEN** un vehículo tiene fotos y nadie las reordenó
- **THEN** el orden es aquel en que se subieron, y es un orden válido como cualquier otro

#### Scenario: Se suben fotos nuevas a un vehículo ya ordenado

- **WHEN** se agregan fotos a un vehículo cuyo orden ya fue definido
- **THEN** las nuevas se agregan al final y el orden existente no se altera

### Requirement: El orden se puede cambiar arrastrando

Reordenar las fotos SHALL hacerse arrastrando una foto a su nueva posición, con el resultado visible antes de soltar.

El gesto SHALL estar disponible tanto en la ficha del vehículo dentro del inventario como en la pantalla de publicaciones, con el mismo comportamiento en ambas: es el mismo dato editado desde dos lugares.

Reordenar NO SHALL exigir precisión de puntero: SHALL poder hacerse también desde un dispositivo táctil y desde el teclado.

Designar una foto como portada SHALL ser posible en un solo gesto, sin arrastrarla hasta la primera posición.

#### Scenario: Se arrastra una foto a otra posición

- **WHEN** una persona arrastra una foto y la suelta sobre otra posición de la grilla
- **THEN** la foto queda en esa posición y las demás se desplazan para acomodarla

#### Scenario: Se cancela un arrastre

- **WHEN** un arrastre se interrumpe sin soltar sobre una posición válida
- **THEN** el orden queda como estaba antes de empezar

#### Scenario: Se reordena desde un teléfono

- **WHEN** una persona arrastra una foto con el dedo
- **THEN** la foto se reordena, y el gesto no se confunde con el desplazamiento de la pantalla

#### Scenario: Se reordena con el teclado

- **WHEN** una persona navega hasta una foto con el teclado y la mueve
- **THEN** el orden cambia igual que arrastrando, y se anuncia el resultado

#### Scenario: Se designa una portada

- **WHEN** una persona marca como portada una foto que no era la primera
- **THEN** esa foto pasa al primer lugar y el orden relativo de las demás se conserva

#### Scenario: Vehículo con una sola foto

- **WHEN** el vehículo tiene una única foto
- **THEN** no se ofrece reordenar ni designar portada, porque no hay nada que decidir

### Requirement: La foto se agarra desde cualquier punto, salvo sus controles

El arrastre SHALL poder iniciarse desde cualquier punto de la miniatura, y NO SHALL exigir apuntar a una zona concreta.

Los controles que van encima de la miniatura —eliminar, designar portada— SHALL seguir siendo pulsables: activarlos NO SHALL iniciar un arrastre, y arrastrar NO SHALL activarlos.

Mientras el puntero esté sobre una foto que se puede reordenar, el cursor SHALL indicar que se puede agarrar.

#### Scenario: Se arrastra desde el centro de la foto

- **WHEN** una persona arrastra una miniatura desde cualquier punto de su superficie
- **THEN** se inicia el reordenamiento

#### Scenario: Se toca el control de eliminar

- **WHEN** una persona activa el control de eliminar de una miniatura
- **THEN** la foto se elimina y no se inicia ningún arrastre

#### Scenario: Se toca el control de portada

- **WHEN** una persona activa el control de designar portada
- **THEN** esa foto pasa al frente y no se inicia ningún arrastre

#### Scenario: El puntero pasa sobre una foto ordenable

- **WHEN** el cursor se posa sobre una miniatura que se puede reordenar
- **THEN** el cursor cambia para indicar que la foto se puede agarrar

#### Scenario: El puntero pasa sobre una foto en modo lectura

- **WHEN** el cursor se posa sobre una miniatura que no se puede reordenar
- **THEN** el cursor no cambia, porque no hay nada que agarrar

### Requirement: El orden se guarda como una sola operación

Los cambios de orden SHALL guardarse agrupados, no uno por cada movimiento: acomodar una grilla de quince fotos es una sola decisión, no quince.

Mientras haya cambios sin guardar, la pantalla SHALL indicarlo. Si el guardado falla, el orden mostrado SHALL volver al último guardado y el fallo SHALL informarse.

#### Scenario: Varios movimientos seguidos

- **WHEN** una persona hace varios cambios de orden antes de confirmar
- **THEN** se guardan juntos en una sola operación

#### Scenario: Cambios sin guardar

- **WHEN** el orden en pantalla difiere del guardado
- **THEN** la pantalla lo indica y ofrece guardar

#### Scenario: El guardado falla

- **WHEN** no se puede guardar el orden nuevo
- **THEN** se avisa del fallo y la pantalla vuelve a mostrar el último orden guardado

### Requirement: El orden decide qué fotos se publican

Cuando un vehículo tiene más fotos de las que acepta una red, las que sobran se descartan por el final. En consecuencia, el orden SHALL determinar no solo la secuencia de la publicación sino **cuáles fotos llegan a publicarse**.

Cuando un vehículo tenga más fotos que el máximo de alguna red conectada, la pantalla de reordenamiento SHALL hacer visible dónde queda ese corte, para que quien ordena sepa qué está dejando afuera.

#### Scenario: Vehículo con más fotos que el máximo de una red

- **WHEN** se muestran las fotos de un vehículo que excede el máximo de una red conectada
- **THEN** se distingue cuáles quedan dentro de ese máximo y cuáles no

#### Scenario: Se reordena para incluir una foto que estaba fuera del corte

- **WHEN** una persona mueve al frente una foto que quedaba fuera del máximo
- **THEN** esa foto pasa a estar entre las que se publican, y la que quedó última sale del corte

#### Scenario: Vehículo con menos fotos que el máximo

- **WHEN** el vehículo no supera el máximo de ninguna red conectada
- **THEN** no se señala ningún corte, porque todas se publican

### Requirement: Reordenar desde la pantalla de publicaciones alcanza a lo pendiente y solo a lo pendiente

Reordenar las fotos de un vehículo desde la pantalla de publicaciones SHALL actualizar las publicaciones que todavía están pendientes de ese vehículo, en todas sus redes, de modo que lo que se aprueba sea lo que se vio.

Un vehículo sin publicaciones pendientes NO SHALL ofrecer reordenamiento en esa pantalla: sus fotos se muestran en modo lectura. El sistema no modifica lo que ya se publicó.

#### Scenario: Se reordena un vehículo con pendientes en dos redes

- **WHEN** se cambia el orden de las fotos de un vehículo con una publicación pendiente en cada red
- **THEN** ambas pendientes quedan con el orden nuevo

#### Scenario: Vehículo cuyas publicaciones ya salieron

- **WHEN** se abre en la pantalla de publicaciones un vehículo sin pendientes
- **THEN** sus fotos se muestran sin posibilidad de reordenar

#### Scenario: Publicación ya realizada de un vehículo que vuelve a tener pendientes

- **WHEN** un vehículo ya publicado genera una publicación pendiente nueva y se reordenan sus fotos
- **THEN** la pendiente nueva toma el orden nuevo y la publicación ya realizada no se altera

### Requirement: El orden vale para todos los destinos del vehículo

El orden elegido SHALL regir en todo lugar donde se muestren las fotos del vehículo: la vitrina pública, la ficha del inventario y las publicaciones en redes.

Cambiar el orden desde cualquier pantalla SHALL cambiarlo en todas. La pantalla desde la que se reordena SHALL advertir que el cambio alcanza también a la vitrina pública, para que el alcance no sea una sorpresa.

#### Scenario: Se reordena desde la ficha del inventario

- **WHEN** se guarda un vehículo con un orden de fotos nuevo
- **THEN** la vitrina pública muestra ese orden y sus publicaciones pendientes también

#### Scenario: Se reordena desde la pantalla de publicaciones

- **WHEN** se guarda un orden nuevo desde la pantalla de publicaciones
- **THEN** el cambio alcanza igualmente a la vitrina pública, y la pantalla lo advirtió antes de guardar

#### Scenario: Cambio de portada

- **WHEN** una foto distinta pasa al primer lugar
- **THEN** es la que encabeza el vehículo en el catálogo público y la que las redes usan para encuadrar la publicación
