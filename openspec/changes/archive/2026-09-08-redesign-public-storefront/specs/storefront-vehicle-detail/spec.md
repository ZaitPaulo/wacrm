## ADDED Requirements

### Requirement: El precio y la acción de contacto no se pierden de vista

En la ficha de un vehículo, el precio y la acción principal de contacto SHALL permanecer visibles mientras el visitante recorre las fotos, las especificaciones y las características.

En pantallas anchas esto SHALL lograrse anclando el panel de precio y contacto mientras el resto del contenido se desplaza. En pantallas angostas SHALL lograrse con una barra anclada al borde inferior que lleve el precio y la acción de contacto.

#### Scenario: El visitante baja a leer las especificaciones

- **WHEN** un visitante en pantalla ancha baja hasta la tabla de especificaciones
- **THEN** el precio y el botón de contacto siguen visibles sin volver arriba

#### Scenario: El visitante recorre la ficha desde el teléfono

- **WHEN** un visitante en un teléfono baja por la ficha
- **THEN** una barra inferior con el precio y el botón de contacto lo acompaña durante todo el recorrido

### Requirement: La galería permite recorrer todas las fotos y ubicarse

Cuando el vehículo tiene más de una foto, la ficha SHALL permitir pasar de una a otra, SHALL indicar cuál se está viendo respecto del total, y SHALL señalar visualmente cuál está seleccionada.

Cuando el vehículo tiene una sola foto, NO SHALL mostrar controles de navegación.

#### Scenario: Vehículo con varias fotos

- **WHEN** el visitante abre la ficha de un vehículo con diez fotos y elige la cuarta
- **THEN** la imagen grande cambia, la ficha indica que va en la cuarta de diez y el control correspondiente se ve seleccionado

#### Scenario: Vehículo con una sola foto

- **WHEN** el vehículo tiene una única imagen
- **THEN** la ficha muestra esa imagen sin controles de navegación

### Requirement: La ficha de un vehículo sin fotos sigue siendo útil

La ficha de un vehículo publicado sin ninguna foto NO SHALL mostrar una galería vacía ni un contenedor roto. SHALL mostrar el mismo bloque de marca que su tarjeta en la grilla, SHALL conservar todas sus especificaciones, y su acción principal SHALL ser pedir las fotos.

#### Scenario: Ficha de un vehículo sin fotos

- **WHEN** un visitante abre la ficha de un vehículo que no tiene imágenes
- **THEN** ve el bloque de marca en lugar de la galería, la tabla completa de especificaciones y una acción para pedir las fotos por WhatsApp

### Requirement: La ficha muestra al visitante el código de referencia del vehículo

La ficha SHALL mostrar el código de referencia del vehículo de forma legible, y SHALL explicar en una línea que ese código viaja en el mensaje de WhatsApp para que la consulta se atienda por ese vehículo.

Cuando el vehículo no tenga código de referencia, la ficha SHALL omitir el código y su explicación, sin dejar espacio vacío ni texto a medias.

#### Scenario: Vehículo con código de referencia

- **WHEN** un visitante abre la ficha de un vehículo que tiene código de referencia
- **THEN** el código se muestra en la ficha junto a una explicación breve de para qué sirve

#### Scenario: Vehículo sin código de referencia

- **WHEN** el vehículo no tiene código asignado
- **THEN** la ficha se muestra completa, sin el código ni su explicación

### Requirement: La ficha ofrece seguir buscando sin volver atrás

La ficha SHALL ofrecer al menos dos caminos para continuar: volver al inventario completo, y ver vehículos parecidos al que se está mirando. Los vehículos parecidos SHALL provenir del mismo inventario publicado y NO SHALL incluir el vehículo que se está viendo.

Cuando no haya ningún vehículo parecido que ofrecer, la sección SHALL omitirse por completo en lugar de mostrarse vacía.

#### Scenario: Hay vehículos parecidos

- **WHEN** un visitante abre la ficha de una camioneta y hay otras camionetas publicadas
- **THEN** la ficha muestra una selección de vehículos parecidos, sin incluir el actual, y cada uno lleva a su propia ficha

#### Scenario: No hay vehículos parecidos

- **WHEN** el vehículo es el único de su tipo en el inventario publicado
- **THEN** la ficha no muestra la sección de vehículos parecidos, y sigue ofreciendo volver al inventario
