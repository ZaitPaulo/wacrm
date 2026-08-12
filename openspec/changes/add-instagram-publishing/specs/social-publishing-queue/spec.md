## ADDED Requirements

### Requirement: Un vehículo disponible genera una publicación pendiente, no publicada

Cuando un vehículo pase a estado disponible, el sistema SHALL preparar una publicación y dejarla **pendiente de revisión**. NUNCA SHALL publicarla por su cuenta.

Preparar la publicación SHALL ser best-effort: si falla, se registra y el vehículo se guarda igual. Encolar nunca puede impedir cargar inventario.

#### Scenario: Se carga un vehículo nuevo

- **WHEN** se crea un vehículo con estado disponible
- **THEN** aparece una publicación pendiente para ese vehículo, y nada se publica en Instagram

#### Scenario: Falla la preparación

- **WHEN** ocurre un error al preparar la publicación
- **THEN** el vehículo queda guardado con normalidad y el fallo queda registrado

#### Scenario: El mismo vehículo vuelve a quedar disponible

- **WHEN** un vehículo que ya tiene una publicación pendiente vuelve a guardarse como disponible
- **THEN** no se crea una segunda publicación pendiente para el mismo vehículo

#### Scenario: Vehículo cargado como vendido u oculto

- **WHEN** se crea o edita un vehículo con un estado distinto de disponible
- **THEN** no se prepara ninguna publicación

### Requirement: Publicar exige una acción humana explícita

Una publicación SHALL enviarse a Instagram únicamente tras la aprobación de una persona. NO SHALL existir ningún camino —automatización, tarea programada o regla— que publique sin esa aprobación.

Quien revisa SHALL poder editar el texto antes de aprobar, y SHALL poder descartar la publicación.

#### Scenario: Se aprueba una publicación

- **WHEN** una persona con permiso revisa una publicación pendiente y la aprueba
- **THEN** se envía a Instagram y queda registrada como publicada, con el identificador que Instagram devolvió

#### Scenario: Se edita antes de aprobar

- **WHEN** quien revisa cambia el texto propuesto y aprueba
- **THEN** se publica el texto editado, no el original

#### Scenario: Se descarta

- **WHEN** quien revisa descarta una publicación pendiente
- **THEN** deja de aparecer entre las pendientes, no se publica nunca, y el vehículo permanece intacto

#### Scenario: Nadie revisa la cola

- **WHEN** hay publicaciones pendientes sin revisar
- **THEN** permanecen pendientes indefinidamente y no se publican solas

### Requirement: Una publicación nunca se envía dos veces

El sistema SHALL impedir que una misma publicación se envíe más de una vez, incluso ante aprobaciones simultáneas.

Una publicación de Instagram no puede retirarse limpiamente, así que ante cualquier duda sobre si ya se publicó, el sistema NO SHALL reintentar: SHALL marcarla para revisión manual.

#### Scenario: Doble aprobación simultánea

- **WHEN** dos personas aprueban la misma publicación al mismo tiempo
- **THEN** se envía una sola vez y la segunda aprobación no produce una segunda publicación

#### Scenario: Se pierde la respuesta de Instagram

- **WHEN** la publicación se envía pero el sistema no logra registrar el resultado
- **THEN** queda marcada para revisión manual en lugar de reintentarse automáticamente

#### Scenario: Publicación ya realizada

- **WHEN** se intenta aprobar una publicación que ya está publicada
- **THEN** la acción se rechaza indicando que ya fue publicada

### Requirement: Se revalida el vehículo en el momento de publicar

Antes de enviar a Instagram, el sistema SHALL comprobar que el vehículo sigue disponible y que sus imágenes siguen siendo accesibles. Si algo cambió, NO SHALL publicar y SHALL explicar por qué.

Entre preparar y aprobar pueden pasar días, y el inventario cambia por caminos que la cola no observa.

#### Scenario: El vehículo se vendió mientras esperaba

- **WHEN** se aprueba una publicación de un vehículo que ya se vendió
- **THEN** no se publica y se informa que el vehículo ya no está disponible

#### Scenario: Las imágenes ya no están

- **WHEN** al publicar alguna imagen del vehículo no es accesible
- **THEN** no se publica y queda como fallida indicando el problema con las imágenes

#### Scenario: El vehículo fue eliminado

- **WHEN** se aprueba una publicación de un vehículo que ya no existe
- **THEN** no se publica y la publicación se retira de las pendientes

### Requirement: El tope de publicaciones se respeta antes de intentar

El sistema SHALL conocer cuántas publicaciones admite Instagram por periodo, SHALL mostrarlo en la cola y SHALL impedir aprobar cuando ya no quede margen, en lugar de descubrirlo por el rechazo.

#### Scenario: Queda margen

- **WHEN** se aprueba una publicación y el tope no se ha alcanzado
- **THEN** se publica con normalidad

#### Scenario: Tope alcanzado

- **WHEN** se intenta aprobar habiendo alcanzado el tope del periodo
- **THEN** la acción se impide explicando cuándo vuelve a haber margen, y la publicación sigue pendiente

### Requirement: Vender un vehículo publicado se avisa, no se despublica

Cuando se venda un vehículo que tiene una publicación viva, el sistema SHALL señalarlo. NO SHALL eliminar la publicación de Instagram.

Retirar una publicación con interacción destruye el alcance ganado, y qué hacer con ella es una decisión de mercadeo del negocio.

#### Scenario: Se vende un vehículo publicado

- **WHEN** un vehículo con publicación viva pasa a vendido
- **THEN** el sistema lo señala para que alguien decida, y la publicación sigue en Instagram

#### Scenario: Se vende un vehículo sin publicar

- **WHEN** se vende un vehículo cuya publicación seguía pendiente
- **THEN** la pendiente se retira, porque ya no tiene sentido publicarla
