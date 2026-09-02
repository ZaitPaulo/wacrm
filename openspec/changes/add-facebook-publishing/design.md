## Context

`add-instagram-publishing` está implementado y corriendo en producción desde el 2026-08-28. El camino completo existe: un vehículo pasa a `available`, `syncVehiclePost` deja un borrador en `social_posts`, alguien lo revisa en `/instagram` y al aprobarlo `approveAndPublish` habla con Meta.

Este change agrega una segunda red a ese mismo camino. Tres hechos del código lo delimitan:

**El esquema ya lo previó.** La migración 512 creó `social_posts.network` con `CHECK (network IN ('instagram'))` y el índice único parcial `idx_social_posts_one_pending ON (vehicle_id, network) WHERE status = 'pending'`. La columna nació con un solo valor posible pero con la forma correcta, y su comentario explica por qué: *"la unicidad de pendientes es por vehículo Y red, y agregarla después obligaría a reconstruir el índice"*.

**El código, en cambio, no.** `src/lib/instagram/queue.ts:29` tiene `const NETWORK = 'instagram'` y lo usa en las cuatro consultas del módulo. `errors.ts` define `InstagramError` y `InstagramStep`. El namespace de traducción es `InstagramPost`. Nada de eso es un obstáculo de diseño —es renombrar—, pero es el grueso del trabajo.

**La conexión es incompatible.** La decisión 13 de aquel design eligió *Instagram API with Instagram Login* sobre `graph.instagram.com` (`src/lib/instagram/api.ts:25`), con `instagram_business_basic` e `instagram_business_content_publish`. Ese token no autoriza nada sobre una página de Facebook, y el host tampoco es el mismo. Aquella decisión ya anotó esta consecuencia: *"si ambos avanzan, la misma cuenta de Instagram terminará conectada por dos caminos distintos"*.

**Restricción de calendario.** Los tres permisos de páginas pasan por App Review de Meta. Todo lo que este design decida tiene que poder construirse y probarse antes de esa aprobación, o el change queda bloqueado semanas contra algo que no controlamos.

## Goals / Non-Goals

**Goals:**

- Publicar la misma ficha del vehículo en la página de Facebook del negocio, con la misma aprobación humana explícita que hoy exige Instagram.
- Que las dos redes sean **independientes en todo**: conexión, borrador, aprobación, fallo y reintento. Que una se caiga no puede afectar a la otra.
- Que agregar la segunda red **no cambie el comportamiento de la primera**. Instagram publica hoy en producción; este change no puede introducir una regresión ahí.
- Dejar la estructura preparada para una tercera red sin volver a refactorizar, sin construir abstracción que hoy nadie usa.

**Non-Goals:**

- Una conexión unificada de Meta que sirva para ambas redes. Ver decisión 2.
- Marketplace de Facebook, historias, reels o vídeo.
- Publicación automática sin aprobación.
- Despublicar de Facebook lo que se vendió.
- Que el texto se adapte a cada red. Ver decisión 6.

## Decisions

### 1. Dos filas en la cola, una por red — no una fila con dos destinos

Un vehículo disponible con ambas redes conectadas genera **dos** filas en `social_posts`, una con `network = 'instagram'` y otra con `network = 'facebook'`. Cada una se aprueba, falla, se reintenta y se descarta por separado.

*Por qué:* `external_post_id` es la única prueba de que algo se publicó, y `publish_locked_at` protege exactamente una publicación. Con una fila y dos destinos, el caso "salió en Instagram, falló en Facebook" no tiene representación honesta: `status` tendría que ser `published` y `failed` a la vez, y `external_post_id` tendría que guardar dos ids con desenlaces distintos. Cualquier valor único que se elija miente sobre una de las dos redes.

*Alternativa considerada:* una fila con columnas por red (`ig_post_id`, `fb_post_id`, `ig_status`, `fb_status`). Se descarta porque duplica cada regla del sistema —dos candados en una fila, dos revalidaciones, dos motivos de fallo— y porque el `CHECK` y el índice de la 512 quedarían sin sentido: la columna `network` que se creó justamente para esto pasaría a no significar nada.

*El costo, asumido:* la cola tiene el doble de entradas y quien revisa aprueba dos veces el mismo vehículo. Es trabajo real. Se compensa parcialmente con la decisión 8.

> **Corrección del 2026-09-01, tras verlo funcionando.** El cliente pidió un solo botón que publique en ambas redes, con el resultado de cada una a la vista y reintento por separado. Tenía razón, y la decisión estaba mal donde confundía el modelo de datos con la pantalla.
>
> **Las dos filas se quedan.** Todo el argumento de arriba sigue en pie y es justamente lo que hace posible lo que él pide: sin dos filas no hay dos `external_post_id`, ni dos candados, ni forma de reintentar una sola red.
>
> **Lo que cambia es la presentación** (ver decisión 15): la cola agrupa por vehículo y ofrece un botón que aprueba las pendientes de ese vehículo, una por una. Aprobar sigue siendo por fila; lo que se ahorra es el segundo clic, no la separación.
>
> Lo que asumí de más fue que dos filas obligaban a dos tarjetas. No: obligan a dos *estados*, que es distinto y es lo que hay que mostrar.

### 2. Dos conexiones separadas, no una sola de Meta

`facebook_config` es una tabla nueva con la misma forma que `instagram_config`: una fila por cuenta, token cifrado con `encrypt()`, RLS de `admin` o superior, estado `connected`/`disconnected`. Se conecta desde su propio panel en Ajustes, con su propio token pegado a mano.

*Por qué no unificar:* Facebook Login puede autorizar ambas redes con un solo token, y sobre el papel es más limpio. Pero Instagram ya está conectado y publicando en producción con Instagram Login; unificar obligaría a reconectar una integración que funciona, en el servidor del cliente, para ganar comodidad. Y ataría este change al éxito de una migración de credenciales que puede fallar por motivos ajenos —qué páginas ve el usuario, qué vinculación tiene la cuenta— dejando al negocio sin ninguna de las dos redes.

*Por qué no una tabla `social_configs` con `network`:* las dos conexiones no guardan lo mismo. Instagram necesita `ig_user_id`; Facebook necesita `page_id` y, además, un token de página que se **deriva** de un token de usuario. Meterlas en una tabla con columnas anulables convertiría en opcional lo que en cada red es obligatorio, y la base dejaría de poder exigirlo.

*Lo que hay que tener presente:* un fallo de credenciales tiene que decir **de qué red**. Con dos conexiones, "vuelve a conectar la cuenta en Ajustes" es una instrucción ambigua que puede mandar a reconectar la que estaba bien.

### 3. Se guarda el Page Access Token, y se deriva al conectar

El usuario pega un token de usuario de Facebook. El servidor consulta `/me/accounts`, muestra las páginas que administra, y al elegir una guarda el **token de esa página**, no el del usuario.

*Por qué:* publicar en una página se autentica con el token de la página. Guardar el de usuario obligaría a derivar el de página en cada publicación —una petición de red extra por publicación, y un punto de fallo más en el momento menos conveniente.

*Por qué elegir la página y no adivinarla:* un usuario puede administrar varias. Tomar la primera publicaría en la página equivocada, que es un error irreversible y visible para los clientes del negocio. Si administra exactamente una, se preselecciona.

*Ventaja adicional:* los tokens de página derivados de un token de usuario de larga duración no caducan mientras el usuario mantenga el permiso. Es una propiedad de Meta, no una garantía nuestra: `token_expires_at` se guarda igual, y el sistema sigue tratando el vencimiento como posible.

### 4. `src/lib/instagram/` pasa a `src/lib/social/`

```
src/lib/social/
  caption.ts        compose.ts       images.ts       queue.ts
  publish.ts        errors.ts        networks.ts
  instagram/  api.ts  limits.ts
  facebook/   api.ts  limits.ts
```

En la raíz queda lo que no depende de la red: la plantilla del texto, la composición, la conversión de imágenes, el encolado y la mecánica de publicar —candado, revalidación, registro del desenlace—. En cada submódulo queda el cliente de Graph API y las constantes de política de esa red.

`networks.ts` es el registro: para cada red, cómo se carga su configuración, cómo se publica y cuáles son sus límites. `publish.ts` lo consulta por `network` en vez de importar Instagram directamente.

*Por qué mover y no agregar `src/lib/facebook/` al lado:* duplicaría `caption.ts`, `compose.ts`, `images.ts` y toda la mecánica de `publish.ts`. Dos copias de la plantilla del texto es exactamente la forma de que el feed de Facebook se quede con el precio viejo cuando alguien arregle el de Instagram.

*El riesgo, reconocido:* es un movimiento grande sobre código que publica en producción. La mitigación es la decisión 5.

### 5. La refactorización se hace sin cambiar una sola expectativa de prueba

Existen `api.test.ts`, `publish.test.ts`, `compose.test.ts`, `images.test.ts` y `limits.test.ts`. Se mueven con el código y **sus aserciones no se tocan**: solo cambian los `import`. Si algo tiene que cambiar en lo que una prueba espera, es que la refactorización dejó de ser un movimiento y hay que revisarla.

*Por qué se declara acá y no queda como buena intención:* es la única señal disponible de que Instagram sigue haciendo lo mismo después de mover 1.500 líneas. Un cambio de expectativa "para que pase" convierte esa señal en ruido.

*Consecuencia de secuencia:* la refactorización se hace **completa y verde antes** de escribir nada de Facebook. Mezclar las dos cosas hace imposible saber cuál rompió qué.

### 6. Mismo texto en ambas redes

`buildVehicleCaption` produce un solo texto y va igual a las dos. No hay plantilla de Facebook.

*Por qué:* el formato lo definió el negocio y lo calcamos de lo que ya publicaba a mano —así lo dice el encabezado de `caption.ts`: *"EL FORMATO NO ES NUESTRO"*. Inventarle una variante para Facebook sería decidir por el cliente algo que él nunca pidió. Los argumentos técnicos a favor de variar —en Facebook las etiquetas rinden menos y caben más caracteres— son ciertos y menores; ninguno justifica que quien revisa tenga que leer dos textos distintos del mismo auto.

*Lo que sí es por red:* los límites de validación. `CAPTION_MAX_CHARS = 2200` y `MAX_HASHTAGS = 30` son de Instagram; Facebook admite mucho más. `validateCaption` pasa a recibir los límites de la red que corresponda, y quien edita el texto de Facebook no ve una advertencia por un tope que no existe ahí.

*Consecuencia:* editar el texto de una red no toca el de la otra. Son filas distintas (decisión 1), así que ya son textos distintos en cuanto alguien edita uno. Es lo correcto: la edición es trabajo de una persona sobre una publicación concreta.

### 7. Publicar en Facebook: `/photos` sin publicar, y agrupar en `/feed`

- **Una sola foto:** `POST /{page-id}/photos` con `url` y `caption`. Devuelve el id de la foto.
- **Varias fotos:** `POST /{page-id}/photos` con `published=false` por cada una, y luego `POST /{page-id}/feed` con `message` y `attached_media`. Devuelve el id de la entrada.

No hay contenedor en dos pasos, no hay `status_code` que consultar y no hay espera de procesado: la parte más cara de Instagram —`waitForContainerReady`, el paso cuya ausencia impidió que saliera ninguna publicación hasta el 2026-08-31— **no existe acá**.

*Lo que sí se conserva:* la clasificación del error en credenciales o contenido, y el `step` que distingue "todavía no se publicó nada" de "puede haberse publicado". El paso irreversible en Facebook es la creación de la entrada de `/feed` (o la foto publicada, cuando es una sola); una foto subida con `published=false` no es visible para nadie, así que un fallo ahí es tan seguro como un fallo creando contenedores en Instagram.

*Sobre reintentar:* una entrada de página **sí** se puede borrar por API, a diferencia de una de Instagram. No cambia la regla: borrar no es deshacer —quien la vio ya la vio, y las notificaciones ya salieron— así que ante un desenlace desconocido la fila va igual a `needs_review` y nadie republica automáticamente.

### 8. Sin tope que consultar en Facebook, y la cola lo dice

`getPublishingLimit()` consulta `content_publishing_limit`, que es de Instagram. Facebook no expone un endpoint equivalente para entradas de página.

*Decisión:* el paso 1 de `approveAndPublish` —verificar margen antes de tomar el candado— pasa a ser **opcional por red**. Instagram lo mantiene exactamente como está. Facebook no lo ejecuta, y la cola no muestra un margen para esa red en vez de mostrar uno inventado.

*Por qué no suponer un tope:* el mismo argumento que ya está escrito en `limits.ts` sobre por qué el tope de Instagram no es una constante: *"cualquier constante nacería vencida y fallaría en la dirección peligrosa"*. Sin dato, no hay número.

*Lo que se pierde:* si Meta limita por volumen sin decirlo, se descubre por el rechazo. Es aceptable: el rechazo queda como fallo de contenido con su motivo, y la publicación sigue pendiente.

### 9. Las fotos se convierten a JPEG también para Facebook

`ensurePublishableImages` corre igual en ambas redes, y la copia convertida se comparte.

*Por qué, si Facebook acepta PNG y WebP:* la conversión ya existe, es idempotente y su ruta es determinista sobre el hash de la URL original (`convertedObjectPath`). Convertir para las dos redes significa que la segunda publicación del mismo vehículo reutiliza el objeto que dejó la primera, sin descargar ni convertir nada. Saltear la conversión en Facebook ahorraría trabajo solo cuando esa red publica sola, y a cambio metería una bifurcación en el punto donde hoy hay una sola regla.

*Lo que sí cambia:* `convertedObjectPath` deja el objeto bajo `account-<uuid>/instagram/`. Pasa a `account-<uuid>/social/`, que es lo que de verdad es. Los objetos ya existentes bajo el prefijo viejo se vuelven huérfanos —una copia derivada que se regenera sola en la siguiente publicación— y no se migran.

### 10. El encolado recorre las redes conectadas

`syncVehiclePost` pasa a preparar un borrador **por cada red que la cuenta tenga conectada**. Un vehículo disponible con solo Instagram conectado sigue generando exactamente una pendiente, como hoy.

*Por qué depende de la conexión y no encola siempre las dos:* una pendiente de una red que nadie conectó no se puede aprobar, y llenaría la cola de entradas que solo se pueden descartar.

*Qué pasa al conectar Facebook con inventario ya cargado:* no se encolan retroactivamente los vehículos disponibles. `refreshPendingCaptions` corre al abrir la cola y solo refresca lo que ya existe; encolar de golpe 136 pendientes nuevas al conectar la red haría inutilizable la pantalla. Los vehículos se van encolando a medida que se guardan, y queda como pregunta abierta si conviene una acción explícita de "preparar los que faltan".

### 11. Los estados de fallo distinguen la red porque la fila ya lo hace

No hace falta ninguna columna nueva: `social_posts.network` ya está en la fila que falla, y `failure_kind` ya distingue credenciales de contenido. Lo que cambia es el **mensaje**: "Facebook rechazó las credenciales. Vuelve a conectar la página en Ajustes" en vez del texto genérico de hoy.

*Por qué se anota como decisión:* es el error más fácil de cometer al generalizar. Un mensaje que dice "la cuenta" cuando hay dos conexiones manda a reconectar la que funcionaba, y la persona termina rompiendo Instagram mientras intenta arreglar Facebook.

### 12. Aprueba `admin` o superior, igual que hoy

Sin cambios respecto de la decisión 14 de `add-instagram-publishing`. Publicar en la página del negocio interviene su marca por el mismo motivo y con el mismo alcance.

### 15. Un botón por vehículo, dos estados a la vista, reintento por red

La cola agrupa las publicaciones por vehículo. Cada tarjeta muestra **una línea por red** con su estado —pendiente, publicada, fallida, en revisión— y ofrece:

- **Publicar**, que aprueba todas las pendientes de ese vehículo, una por una y en serie.
- **Reintentar**, por red, sobre las que fallaron.
- **Descartar**, que retira las pendientes.

*Por qué en serie y no en paralelo:* cada aprobación toma su propio candado y habla con una API distinta. En paralelo, un fallo de red en la primera dejaría a la segunda a mitad de camino sin que la pantalla pueda decir cuál quedó cómo. En serie, cada desenlace se conoce antes de empezar el siguiente.

*Por qué el botón no promete un resultado único:* porque no lo hay. Al terminar informa **por red**, y la tarjeta queda mostrando qué salió y qué no. Un "publicado" a secas cuando una de las dos falló sería exactamente la mentira que la decisión 1 quiere evitar.

*El texto es uno solo.* La tarjeta tiene un editor, no dos, y lo que se guarda va a las pendientes de ese vehículo en todas las redes. Se valida contra el **límite más estricto** de las redes involucradas —hoy el de Instagram—, porque un texto que no entra en una de las dos no sirve para el botón único. Editarlas por separado sigue siendo posible en los datos; simplemente no se ofrece, porque nadie lo pidió y duplicaría el trabajo de revisar.

### 16. Reintentar es una acción humana, y nunca sobre algo que ya salió

Una publicación fallida vuelve a `pending` solo si alguien lo pide, y **solo si `external_post_id` está vacío**. Con identificador, ya salió: no hay nada que reintentar y republicar duplicaría.

*Lo que esto corrige:* hasta ahora una publicación fallida se iba al historial sin ninguna forma de recuperarla desde la interfaz. Un corte de red sacaba un vehículo de la cola para siempre y había que reponerlo con SQL. Es un agujero que ya dolía con una sola red.

*El caso incómodo:* `needs_review` significa que no se sabe si salió. Se permite reintentar desde ahí —es la salida que el diseño siempre previó para una persona que fue a mirar—, pero el botón lo dice con todas las letras en vez de parecer un reintento cualquiera.

*Choque con el índice único:* si mientras tanto se generó otra pendiente para ese vehículo y esa red, el `UPDATE` viola `idx_social_posts_one_pending`. No es un error a esconder: significa que ya hay un borrador fresco esperando, y eso es lo que hay que decir.

## Risks / Trade-offs

- **La revisión de Meta se demora o rechaza** → Es el riesgo dominante y no tiene mitigación técnica. Lo que se hace: las conexiones son independientes (decisión 2), así que Instagram no queda expuesto; y todo se construye contra dobles, así que la aprobación bloquea solo la prueba real.
- **La refactorización rompe Instagram en producción** → Movimiento puro, pruebas sin cambios de expectativa, y completa y verde antes de escribir Facebook (decisiones 4 y 5).
- **Publicar dos veces en Facebook** → Mismo candado condicional y mismo criterio: ante desenlace desconocido, `needs_review`, no reintento (decisión 7).
- **Publicar en la página equivocada** → El usuario elige la página al conectar, y la cola muestra en qué página se va a publicar (decisión 3).
- **El doble de pendientes estanca la cola** → Riesgo real de producto, ya reconocido para una sola red y ahora duplicado. La cola necesita filtrar por red y descartar fácil; no hay solución técnica que sustituya a que alguien la mire.
- **Un mensaje de error manda a reconectar la red que estaba bien** → Todo mensaje de fallo nombra la red (decisión 11).
- **La conversión de imágenes deja objetos huérfanos** → Copias derivadas que se regeneran solas; se acepta no migrarlas (decisión 9).
- **Los dos tokens caducan por separado y en momentos distintos** → Cada conexión guarda su propio `token_expires_at` y se muestra por separado en Ajustes.

## Migration Plan

1. **Refactorización sola.** `src/lib/instagram/` → `src/lib/social/`, con `networks.ts` y los límites parametrizados. Sin nada de Facebook. Pruebas verdes con las mismas expectativas. Es un commit propio y desplegable: si algo se rompe, se revierte sin arrastrar trabajo de la segunda red.
2. **Migración 513.** `facebook_config` y ampliación del `CHECK` de `social_posts.network` a `('instagram', 'facebook')`. Ninguna fila existente cambia.
3. **Cliente de Facebook** (`social/facebook/api.ts`) con sus pruebas, contra dobles. No se conecta a nada todavía.
4. **Conexión en Ajustes:** pegar token, elegir página, guardar el token de página cifrado.
5. **Encolado y cola por red:** `syncVehiclePost` recorre las redes conectadas; la pantalla muestra y filtra por red.
6. **App Review de Meta.** Corre en paralelo desde el paso 2; bloquea únicamente la prueba real de publicación.
7. **Prueba real** contra la página de LoraMotors, con un vehículo, verificando la entrada en la página antes de dar el paso por bueno.

*Rollback:* desconectar la página desde Ajustes deja de encolar para Facebook y no toca nada de Instagram. Las pendientes de Facebook quedan sin poder aprobarse, igual que hoy quedarían las de Instagram sin cuenta conectada.

## Open Questions

- **¿Conviene una acción de "preparar las que faltan"** al conectar una red con inventario ya cargado (decisión 10)? Encolar 136 pendientes automáticamente no, pero descubrirlas de a una a medida que alguien edita cada vehículo tampoco es razonable. No bloquea: se puede resolver después de ver cómo se comporta la cola con dos redes.
- **¿La cola agrupa por vehículo o lista plano por red?** Con dos filas del mismo auto una al lado de la otra, agrupar puede ayudar a revisar y puede esconder que una falló. Se decide al implementar la pantalla, con las dos redes ya publicando.
- **Los permisos exactos de App Review.** `pages_show_list`, `pages_read_engagement` y `pages_manage_posts` es lo que corresponde hoy, pero Meta los renombra y reagrupa. Se confirma contra la documentación vigente antes de enviar la solicitud, no antes de escribir esto.
