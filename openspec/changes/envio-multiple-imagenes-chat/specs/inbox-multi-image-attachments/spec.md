## ADDED Requirements

### Requirement: Selección de varias imágenes a la vez
El composer de la bandeja SHALL permitir elegir varias imágenes en una sola acción del selector de archivos, y SHALL dejarlas en preparación en el orden en que el navegador las entrega.

#### Scenario: El asesor elige cuatro fotos
- **WHEN** el asesor abre "Imagen" en el menú de adjuntos y selecciona cuatro archivos PNG/JPEG/WebP
- **THEN** las cuatro aparecen como miniaturas en la tira de preparación, en el orden de la selección

#### Scenario: Se agregan más fotos a una tanda en curso
- **WHEN** ya hay tres imágenes en preparación y el asesor elige dos más
- **THEN** la tira muestra cinco imágenes, con las nuevas al final

### Requirement: Límite de 10 imágenes por tanda
El sistema SHALL aceptar como máximo 10 imágenes en preparación. Las que excedan el límite MUST descartarse sin subirse, y el asesor MUST ver un aviso que diga cuántas quedaron fuera.

#### Scenario: Selección que excede el límite
- **WHEN** hay 8 imágenes en preparación y el asesor elige 5 más
- **THEN** se agregan las 2 primeras de la nueva selección, las otras 3 no se suben y se muestra un aviso de que se ignoraron 3 por el límite de 10

### Requirement: Arrastrar y pegar imágenes
El sistema SHALL aceptar imágenes soltadas sobre el panel del hilo y pegadas desde el portapapeles en el campo de texto del composer, con las mismas reglas del selector. Los archivos que no sean imágenes admitidas MUST ignorarse con un aviso.

#### Scenario: Soltar fotos sobre el hilo
- **WHEN** el asesor arrastra tres fotos desde el explorador y las suelta sobre el hilo abierto
- **THEN** las tres entran a la tira de preparación

#### Scenario: Pegar una captura de pantalla
- **WHEN** el asesor copia una imagen y pulsa Ctrl+V con el foco en el campo de texto
- **THEN** la imagen entra a la tira de preparación y el texto ya escrito no cambia

#### Scenario: Soltar un archivo no admitido
- **WHEN** el asesor suelta un PDF y una foto JPEG sobre el hilo
- **THEN** solo la foto entra a la tira y se avisa que el PDF se ignoró

#### Scenario: Pegar texto normal
- **WHEN** el portapapeles solo contiene texto
- **THEN** el pegado funciona como siempre y no se agrega ningún adjunto

### Requirement: Envío deshabilitado fuera de la ventana o sin permiso
Seleccionar, soltar o pegar imágenes MUST respetar las mismas reglas que hoy rigen los adjuntos: si el rol no puede enviar mensajes o la ventana de 24 h está cerrada, no se agrega ninguna imagen.

#### Scenario: Sesión vencida
- **WHEN** la ventana de 24 h de la conversación está cerrada y el asesor suelta una foto sobre el hilo
- **THEN** la foto no se agrega a la tira

### Requirement: Revisión de la tanda antes de enviar
La tira de preparación SHALL mostrar una miniatura por imagen, con su estado de subida (subiendo, lista o con error), un control para quitarla y un campo de leyenda por imagen limitado a 1024 caracteres. Quitar una imagen MUST borrar su objeto del bucket `chat-media`.

#### Scenario: Quitar una imagen de la tanda
- **WHEN** el asesor quita la segunda de cuatro imágenes
- **THEN** la tira queda con tres, en el mismo orden relativo, y el objeto subido de la imagen quitada se borra del almacenamiento

#### Scenario: Leyenda por imagen
- **WHEN** el asesor selecciona la tercera miniatura y escribe "Interior"
- **THEN** esa leyenda queda asociada solo a la tercera imagen

#### Scenario: Imagen que excede el peso permitido
- **WHEN** una de las imágenes elegidas pesa más que el límite de imagen vigente
- **THEN** esa imagen no se agrega, se avisa con su nombre y las demás sí se agregan

#### Scenario: Descartar toda la tanda
- **WHEN** el asesor descarta la tanda completa o sale de la conversación sin enviar
- **THEN** todos los objetos subidos de esa tanda se borran del almacenamiento

### Requirement: Envío secuencial y ordenado
Al enviar, el sistema SHALL mandar cada imagen como un mensaje independiente, de a una, esperando el resultado de cada envío antes de empezar el siguiente, en el orden de la tira. El envío MUST estar bloqueado mientras alguna imagen siga subiéndose. La cita del mensaje al que se responde, si la hay, MUST ir solo en la primera imagen.

#### Scenario: Envío de una tanda de cinco
- **WHEN** el asesor envía una tanda de cinco imágenes ya subidas
- **THEN** se crean cinco mensajes de imagen en la conversación, en el mismo orden de la tira, cada uno con su propia leyenda

#### Scenario: Respuesta citada
- **WHEN** el asesor está respondiendo a un mensaje y envía tres imágenes
- **THEN** solo el primer mensaje enviado lleva la referencia al mensaje citado

#### Scenario: Subida pendiente
- **WHEN** una imagen de la tira todavía se está subiendo
- **THEN** el botón de enviar está deshabilitado

#### Scenario: Progreso visible
- **WHEN** se está enviando la tercera imagen de siete
- **THEN** el composer muestra el progreso del envío (3 de 7) y no permite iniciar otro envío de la tanda

### Requirement: Fallo parcial sin detener la tanda
Si el envío de una imagen falla, el sistema SHALL seguir con las siguientes. La burbuja fallida MUST quedar marcada como fallida y su objeto MUST borrarse del almacenamiento, igual que hoy con un adjunto suelto.

#### Scenario: Falla la segunda de cuatro
- **WHEN** el servidor rechaza el envío de la segunda imagen de una tanda de cuatro
- **THEN** la segunda burbuja queda como fallida y la primera, la tercera y la cuarta se envían

### Requirement: Burbujas optimistas con id único
Cada mensaje enviado desde el hilo SHALL recibir un id temporal único, aunque varios mensajes se creen en el mismo milisegundo, para que el estado de una burbuja (enviando, enviado o fallido) nunca se aplique a otra.

#### Scenario: Dos envíos en el mismo milisegundo
- **WHEN** se crean dos burbujas optimistas con la misma marca de tiempo
- **THEN** tienen ids distintos y marcar una como fallida no afecta a la otra
