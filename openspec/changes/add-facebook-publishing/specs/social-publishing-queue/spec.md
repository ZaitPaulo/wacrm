## MODIFIED Requirements

### Requirement: Un vehículo disponible genera una publicación pendiente, no publicada

Cuando un vehículo pase a estado disponible, el sistema SHALL preparar una publicación **por cada red conectada** y dejarla **pendiente de revisión**. NUNCA SHALL publicarla por su cuenta.

Una red que la cuenta no tenga conectada NO SHALL generar pendientes: una publicación que nadie puede aprobar solo se puede descartar.

Preparar la publicación SHALL ser best-effort: si falla, se registra y el vehículo se guarda igual. Encolar nunca puede impedir cargar inventario. Un fallo al preparar la publicación de una red NO SHALL impedir que se prepare la de la otra.

#### Scenario: Se carga un vehículo nuevo con las dos redes conectadas

- **WHEN** se crea un vehículo con estado disponible en una cuenta con Instagram y Facebook conectados
- **THEN** aparecen dos publicaciones pendientes para ese vehículo, una por red, y nada se publica en ninguna

#### Scenario: Se carga un vehículo nuevo con una sola red conectada

- **WHEN** se crea un vehículo con estado disponible en una cuenta con una sola red conectada
- **THEN** aparece exactamente una publicación pendiente, la de esa red

#### Scenario: Falla la preparación

- **WHEN** ocurre un error al preparar la publicación
- **THEN** el vehículo queda guardado con normalidad y el fallo queda registrado

#### Scenario: Falla la preparación de una sola red

- **WHEN** ocurre un error al preparar la publicación de una red y no de la otra
- **THEN** la pendiente de la red que sí pudo prepararse queda disponible en la cola

#### Scenario: El mismo vehículo vuelve a quedar disponible

- **WHEN** un vehículo que ya tiene publicaciones pendientes vuelve a guardarse como disponible
- **THEN** no se crea una segunda publicación pendiente para el mismo vehículo en ninguna red

#### Scenario: Vehículo cargado como vendido u oculto

- **WHEN** se crea o edita un vehículo con un estado distinto de disponible
- **THEN** no se prepara ninguna publicación en ninguna red

### Requirement: Publicar exige una acción humana explícita

Una publicación SHALL enviarse a la red que corresponda únicamente tras la aprobación de una persona. NO SHALL existir ningún camino —automatización, tarea programada o regla— que publique sin esa aprobación.

Cada publicación SHALL aprobarse por separado. Aprobar la de una red NO SHALL publicar en la otra: son decisiones distintas sobre destinos distintos.

Aprobar, editar y descartar SHALL requerir rol `admin` o superior, el mismo que exige conectar la cuenta o la página. Publicar interviene la marca del negocio, que es la razón de que la cola exista.

#### Scenario: Se aprueba una publicación

- **WHEN** un miembro con rol `admin` o superior revisa una publicación pendiente y la aprueba
- **THEN** se envía a la red de esa publicación y queda registrada como publicada, con el identificador que esa red devolvió

#### Scenario: Se aprueba en una red y no en la otra

- **WHEN** quien revisa aprueba la publicación de Instagram de un vehículo y deja pendiente la de Facebook
- **THEN** se publica solo en Instagram y la de Facebook sigue pendiente y aprobable

#### Scenario: Un asesor abre la cola

- **WHEN** un miembro con rol `agent` o `viewer` accede a la cola de publicaciones
- **THEN** no puede aprobar, editar ni descartar ninguna publicación

#### Scenario: Se edita antes de aprobar

- **WHEN** quien revisa cambia el texto propuesto y aprueba
- **THEN** se publica el texto editado, no el original

#### Scenario: Se edita el texto de una sola red

- **WHEN** quien revisa edita el texto de la publicación de una red
- **THEN** el texto de la publicación de la otra red no cambia

#### Scenario: Se descarta

- **WHEN** quien revisa descarta una publicación pendiente
- **THEN** deja de aparecer entre las pendientes, no se publica nunca, el vehículo permanece intacto y la pendiente de la otra red no se ve afectada

#### Scenario: Nadie revisa la cola

- **WHEN** hay publicaciones pendientes sin revisar
- **THEN** permanecen pendientes indefinidamente y no se publican solas

### Requirement: Una publicación nunca se envía dos veces

El sistema SHALL impedir que una misma publicación se envíe más de una vez, incluso ante aprobaciones simultáneas.

Una publicación no puede retirarse de forma que deshaga lo ocurrido —quien la vio ya la vio, y los avisos ya salieron—, así que ante cualquier duda sobre si ya se publicó, el sistema NO SHALL reintentar en ninguna red: SHALL marcarla para revisión manual.

#### Scenario: Doble aprobación simultánea

- **WHEN** dos personas aprueban la misma publicación al mismo tiempo
- **THEN** se envía una sola vez y la segunda aprobación no produce una segunda publicación

#### Scenario: Se pierde la respuesta de la red

- **WHEN** la publicación se envía pero el sistema no logra registrar el resultado
- **THEN** queda marcada para revisión manual en lugar de reintentarse automáticamente

#### Scenario: Se pierde la respuesta en una red y la otra publica bien

- **WHEN** una de las dos publicaciones de un vehículo queda en revisión manual y la otra se publica con éxito
- **THEN** la cola muestra los dos desenlaces por separado y no presenta el vehículo como publicado sin más

#### Scenario: Publicación ya realizada

- **WHEN** se intenta aprobar una publicación que ya está publicada
- **THEN** la acción se rechaza indicando que ya fue publicada

### Requirement: Se revalida el vehículo en el momento de publicar

Antes de enviar a cualquier red, el sistema SHALL comprobar que el vehículo sigue **disponible** y que sus imágenes siguen siendo accesibles. Si algo cambió, NO SHALL publicar y SHALL explicar por qué.

Disponible significa exactamente el estado disponible, no "cualquier cosa menos vendido". Un vehículo reservado u oculto ya no aparece en la vitrina, así que anunciarlo llevaría a una ficha que el interesado no puede consultar. Es la misma regla que el sistema ya aplica para sacarlo del knowledge base.

La revalidación SHALL correr en cada aprobación, también cuando la otra red ya publicó ese vehículo: entre una aprobación y la otra pueden pasar días, y el inventario cambia por caminos que la cola no observa.

#### Scenario: El vehículo se vendió mientras esperaba

- **WHEN** se aprueba una publicación de un vehículo que ya se vendió
- **THEN** no se publica y se informa que el vehículo ya no está disponible

#### Scenario: El vehículo se vende entre las dos aprobaciones

- **WHEN** se aprueba la publicación de una red, el vehículo se vende, y después se intenta aprobar la de la otra red
- **THEN** la segunda no se publica y se informa que el vehículo ya no está disponible

#### Scenario: El vehículo quedó reservado u oculto

- **WHEN** se aprueba una publicación de un vehículo que pasó a reservado u oculto
- **THEN** no se publica y se informa que el vehículo ya no está disponible

#### Scenario: Las imágenes ya no están

- **WHEN** al publicar alguna imagen del vehículo no es accesible
- **THEN** no se publica y queda como fallida indicando el problema con las imágenes

#### Scenario: El vehículo fue eliminado

- **WHEN** se aprueba una publicación de un vehículo que ya no existe
- **THEN** no se publica y las publicaciones pendientes de ese vehículo se retiran de la cola

### Requirement: El tope de publicaciones se consulta a la red, no se estima

Cuando la red informe un tope de publicaciones por periodo, el sistema SHALL preguntárselo, SHALL mostrarlo en la cola y SHALL impedir aprobar cuando no quede margen, en lugar de descubrirlo por el rechazo.

El tope NO SHALL guardarse como un valor fijo en el sistema: lo define la red y cambia, y un valor desactualizado falla creyéndose con margen que no tiene.

Cuando la red **no** informe ningún tope, el sistema NO SHALL mostrar ni suponer uno. Un número inventado es peor que la ausencia de dato, porque impide aprobar sin motivo real.

#### Scenario: Queda margen

- **WHEN** se aprueba una publicación en una red que informa tope y el tope no se ha alcanzado
- **THEN** se publica con normalidad

#### Scenario: Tope alcanzado

- **WHEN** se intenta aprobar habiendo alcanzado el tope del periodo de esa red
- **THEN** la acción se impide explicando cuándo vuelve a haber margen, y la publicación sigue pendiente

#### Scenario: No se puede consultar el margen

- **WHEN** no se logra averiguar el margen restante en una red que informa tope
- **THEN** la aprobación se impide indicando que no pudo verificarse, en vez de publicar a ciegas

#### Scenario: La red no informa tope

- **WHEN** se aprueba una publicación en una red que no expone un tope por periodo
- **THEN** se publica sin verificar margen, y la cola no muestra ningún tope para esa red

#### Scenario: El tope de una red no afecta a la otra

- **WHEN** una red alcanzó su tope del periodo
- **THEN** las publicaciones pendientes de la otra red siguen pudiendo aprobarse

### Requirement: Vender un vehículo publicado se avisa, no se despublica

Cuando se venda un vehículo que tiene publicaciones vivas, el sistema SHALL señalarlo indicando **en qué redes** está publicado. NO SHALL eliminar ninguna publicación.

Retirar una publicación con interacción destruye el alcance ganado, y qué hacer con ella es una decisión de mercadeo del negocio. Vale igual en las redes donde borrar por API es posible: borrar no deshace.

#### Scenario: Se vende un vehículo publicado en ambas redes

- **WHEN** un vehículo con publicaciones vivas en las dos redes pasa a vendido
- **THEN** el sistema lo señala nombrando ambas redes, y las publicaciones siguen en pie

#### Scenario: Se vende un vehículo publicado en una sola red

- **WHEN** un vehículo publicado solo en una red pasa a vendido
- **THEN** el sistema señala únicamente esa red

#### Scenario: Se vende un vehículo sin publicar

- **WHEN** se vende un vehículo cuyas publicaciones seguían pendientes
- **THEN** las pendientes de todas las redes se retiran, porque ya no tiene sentido publicarlas

#### Scenario: Un vehículo pendiente se reserva o se oculta

- **WHEN** un vehículo con publicaciones pendientes deja de estar disponible por cualquier motivo
- **THEN** las pendientes se retiran, igual que si se hubiera vendido

### Requirement: Un vehículo que reingresa se ofrece de nuevo, mostrando que ya se publicó

Cuando un vehículo vuelva a estar disponible después de haber salido del inventario, el sistema SHALL preparar una publicación nueva por cada red conectada, y SHALL indicar en la cola si ese vehículo ya se publicó antes **en esa red** y cuándo.

Un auto que reingresa es un hecho comercial nuevo y merece ofrecerse. Pero republicarlo puede ser lo correcto o puede ser un descuido, y desde la cola no se distingue: mostrar el antecedente convierte eso en una decisión informada. El antecedente es por red porque publicar de nuevo en una red donde ya salió no es lo mismo que estrenarlo en la otra.

Esto no contradice la regla de no duplicar pendientes: salir del inventario ya retiró las pendientes que hubiera, así que al reingresar no hay ninguna con la cual duplicarse.

#### Scenario: Vuelve a estar disponible un vehículo ya publicado en ambas redes

- **WHEN** un vehículo que tuvo publicaciones en las dos redes vuelve a quedar disponible
- **THEN** se prepara una publicación nueva por red y cada una indica que ese vehículo ya se publicó ahí, con la fecha

#### Scenario: Vuelve a estar disponible un vehículo publicado en una sola red

- **WHEN** un vehículo publicado solo en una red vuelve a quedar disponible con ambas redes conectadas
- **THEN** la pendiente de la red donde ya salió muestra el antecedente y la de la otra red no muestra ninguno

#### Scenario: Vuelve a estar disponible un vehículo nunca publicado

- **WHEN** un vehículo cuyas publicaciones se descartaron vuelve a quedar disponible
- **THEN** se preparan publicaciones nuevas sin señalar ningún antecedente de publicación

#### Scenario: Se decide no republicar

- **WHEN** quien revisa descarta la publicación de un vehículo reingresado
- **THEN** no se publica nada y las publicaciones anteriores siguen intactas en sus redes

## ADDED Requirements

### Requirement: La cola agrupa por vehículo y declara el estado de cada red

La cola SHALL presentar las publicaciones **agrupadas por vehículo**, y cada grupo SHALL mostrar una línea por red con su estado propio. La cola SHALL permitir filtrar por red.

NO SHALL presentar un estado único por vehículo. Con dos redes, "publicado" a secas es falso en cuanto una de las dos falle, y es exactamente la confusión que hace aprobar creyendo que se aprueba la otra.

#### Scenario: Un vehículo con pendientes en las dos redes

- **WHEN** un vehículo tiene publicaciones pendientes en las dos redes
- **THEN** aparece como UNA tarjeta que muestra las dos redes, cada una con su estado

#### Scenario: Distinto desenlace por red

- **WHEN** una publicación de un vehículo se publicó y la otra falló
- **THEN** la tarjeta muestra ambos estados junto a su red, sin presentar un único estado para el vehículo

#### Scenario: Se filtra por red

- **WHEN** quien revisa filtra la cola por una red
- **THEN** solo ve las publicaciones de esa red

### Requirement: Un solo gesto publica en todas las redes pendientes del vehículo

La cola SHALL ofrecer una acción única que apruebe **todas las publicaciones pendientes de ese vehículo**, enviándolas a cada red **una por una**.

Esa acción NO SHALL informar un resultado único: SHALL informar el desenlace **de cada red**. Cada envío conserva su propio candado, su propia revalidación y su propio registro; lo que se ahorra es el segundo gesto, no la separación entre publicaciones.

El fallo en una red NO SHALL impedir el intento en la otra.

#### Scenario: Las dos redes salen bien

- **WHEN** quien revisa publica un vehículo con pendientes en dos redes y ambas aceptan
- **THEN** las dos quedan publicadas, cada una con el identificador que devolvió su red

#### Scenario: Una sale y la otra falla

- **WHEN** una red acepta la publicación y la otra la rechaza
- **THEN** la que salió queda publicada, la que falló queda registrada como fallida con su motivo, y quien revisa ve los dos desenlaces por separado

#### Scenario: Solo una red tiene pendiente

- **WHEN** el vehículo ya se publicó en una red y sigue pendiente en la otra
- **THEN** la acción envía únicamente la pendiente, y no vuelve a publicar la que ya salió

#### Scenario: El texto editado vale para todas

- **WHEN** quien revisa edita el texto y publica
- **THEN** todas las redes reciben ese texto editado

### Requirement: El texto se valida contra el límite más estricto de las redes pendientes

Al editar el texto de un vehículo con pendientes en varias redes, el sistema SHALL validarlo contra el límite **más estricto** de esas redes.

Un texto que una de las redes rechazaría no sirve para una acción que publica en todas, y descubrirlo al publicar desperdicia la aprobación.

#### Scenario: Texto que excede el límite de una sola red

- **WHEN** el texto entra en el límite de una red pero excede el de la otra, y ambas están pendientes
- **THEN** se rechaza al guardar, indicando el límite que no se cumple

#### Scenario: Queda pendiente una sola red

- **WHEN** solo queda pendiente la red de límites más amplios
- **THEN** el texto se valida contra esa red, sin aplicarle el límite de una red que ya no interviene

### Requirement: Una publicación fallida se puede reintentar, y nunca una que ya salió

El sistema SHALL permitir devolver a pendiente una publicación fallida, a pedido explícito de una persona y **por red**.

NO SHALL permitirlo cuando la publicación tenga identificador externo: eso prueba que salió, y republicar duplicaría algo que no se deshace.

Reintentar desde el estado de revisión manual SHALL advertir que no se sabe si la publicación salió, en lugar de presentarse como un reintento corriente.

#### Scenario: Falló por un problema de contenido ya corregido

- **WHEN** quien revisa reintenta una publicación fallida sin identificador externo
- **THEN** vuelve a quedar pendiente, sin motivo de fallo, y se puede aprobar de nuevo

#### Scenario: Se reintenta solo una de las dos redes

- **WHEN** un vehículo se publicó en una red y falló en la otra, y se reintenta la fallida
- **THEN** solo esa vuelve a pendiente, y la publicada permanece intacta

#### Scenario: Se intenta reintentar algo ya publicado

- **WHEN** se intenta reintentar una publicación que tiene identificador externo
- **THEN** la acción se rechaza indicando que esa publicación ya salió

#### Scenario: Reintento desde revisión manual

- **WHEN** quien revisa reintenta una publicación en revisión manual
- **THEN** el sistema advierte que pudo haberse publicado y que conviene comprobarlo en la red antes de continuar

#### Scenario: Ya existe una pendiente nueva para esa red

- **WHEN** se reintenta una fallida y el vehículo ya tiene otra pendiente en esa misma red
- **THEN** la acción se rechaza explicando que ya hay un borrador esperando, en vez de fallar sin motivo aparente

### Requirement: Conectar una red no encola retroactivamente el inventario existente

Al conectar una red nueva, el sistema NO SHALL preparar automáticamente publicaciones para todos los vehículos disponibles que ya existan.

Una cuenta con inventario cargado tiene decenas o cientos de vehículos disponibles; encolarlos de golpe llenaría la cola de trabajo que nadie pidió y la volvería inutilizable justo cuando se estrena la red.

#### Scenario: Se conecta una red con inventario ya cargado

- **WHEN** se conecta una red en una cuenta que ya tiene vehículos disponibles
- **THEN** no se prepara ninguna publicación pendiente por el solo hecho de conectarla

#### Scenario: Se guarda un vehículo después de conectar

- **WHEN** un vehículo disponible se guarda después de haberse conectado la red nueva
- **THEN** se prepara su publicación pendiente en esa red
