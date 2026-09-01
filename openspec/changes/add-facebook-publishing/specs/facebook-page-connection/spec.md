## ADDED Requirements

### Requirement: El negocio conecta su página de Facebook desde los ajustes

El sistema SHALL permitir vincular una página de Facebook por cuenta del CRM, y SHALL guardar sus credenciales cifradas, con el mismo tratamiento que reciben las de Instagram y las de WhatsApp.

Las credenciales NUNCA SHALL exponerse al cliente ni devolverse en ninguna respuesta de la API.

Conectar o desconectar la página SHALL requerir rol `admin` o superior.

#### Scenario: Se conecta una página válida

- **WHEN** un miembro con rol `admin` o superior conecta una página de Facebook que administra
- **THEN** la conexión queda registrada como activa y el sistema muestra en qué página se va a publicar

#### Scenario: El usuario no administra ninguna página

- **WHEN** las credenciales entregadas no dan acceso a ninguna página
- **THEN** la conexión se rechaza explicando el requisito, en vez de guardarse y fallar después al publicar

#### Scenario: Un asesor abre los ajustes

- **WHEN** un miembro con rol `agent` o `viewer` accede a los ajustes
- **THEN** no puede conectar, desconectar ni ver las credenciales de la página

#### Scenario: Se desconecta la página

- **WHEN** un miembro con rol `admin` o superior desconecta la página
- **THEN** las credenciales dejan de estar disponibles, las entradas ya publicadas no se ven afectadas y las pendientes de Facebook quedan a la espera de una página conectada

### Requirement: Quien conecta elige en qué página se publica

Cuando las credenciales den acceso a más de una página, el sistema SHALL mostrar las páginas disponibles y SHALL exigir que una persona elija cuál. NO SHALL elegir una por su cuenta.

Publicar en la página equivocada es visible para los clientes del negocio y no se deshace, así que la elección no puede deducirse.

#### Scenario: El usuario administra varias páginas

- **WHEN** las credenciales dan acceso a más de una página
- **THEN** el sistema las lista y no guarda la conexión hasta que se elija una

#### Scenario: El usuario administra exactamente una página

- **WHEN** las credenciales dan acceso a una sola página
- **THEN** esa página queda preseleccionada y la conexión se completa confirmándola

#### Scenario: Se cambia la página conectada

- **WHEN** un miembro con rol `admin` o superior vuelve a conectar eligiendo otra página
- **THEN** las publicaciones siguientes van a la página nueva, y las ya publicadas permanecen donde se publicaron

### Requirement: La conexión de Facebook es independiente de la de Instagram

Cada red SHALL tener su propia conexión, con sus propias credenciales y su propio estado. Conectar una NO SHALL conectar la otra, y desconectar una NO SHALL afectar a la otra.

Las dos redes se autentican por caminos distintos de Meta, así que unas credenciales válidas para una no autorizan nada en la otra.

#### Scenario: Solo Instagram conectado

- **WHEN** la cuenta tiene Instagram conectado y Facebook no
- **THEN** se publica en Instagram con normalidad y no se prepara ninguna publicación de Facebook

#### Scenario: Solo Facebook conectado

- **WHEN** la cuenta tiene Facebook conectado e Instagram no
- **THEN** se publica en Facebook con normalidad y no se prepara ninguna publicación de Instagram

#### Scenario: Se desconecta una de las dos

- **WHEN** se desconecta una de las dos redes
- **THEN** la otra sigue publicando sin interrupción ni necesidad de reconectarse

### Requirement: Todo aviso de credenciales nombra la red afectada

Cuando una operación falle por credenciales inválidas o expiradas, el sistema SHALL indicar **de qué red** se trata y a qué conexión hay que volver.

Con dos conexiones activas, un mensaje que hable genéricamente de "la cuenta" lleva a reconectar la que estaba funcionando.

#### Scenario: El token de Facebook expiró

- **WHEN** una publicación de Facebook falla porque sus credenciales ya no son válidas
- **THEN** el sistema lo reporta como problema de la conexión de Facebook e invita a reconectar la página, sin mencionar Instagram

#### Scenario: El token de Instagram expiró

- **WHEN** una publicación de Instagram falla por credenciales
- **THEN** el sistema invita a reconectar la cuenta de Instagram, sin mencionar Facebook

#### Scenario: No hay página conectada

- **WHEN** se intenta aprobar una publicación de Facebook sin página conectada
- **THEN** la acción se impide indicando que primero hay que conectar la página de Facebook

### Requirement: El vencimiento de cada conexión se informa por separado

El sistema SHALL registrar y mostrar el vencimiento de las credenciales de cada red de forma independiente, cuando Meta lo informe.

Los dos tokens se obtienen por caminos distintos y caducan en momentos distintos; presentarlos como uno solo oculta cuál está por vencer.

#### Scenario: Una conexión vigente y otra por vencer

- **WHEN** las credenciales de una red están próximas a vencer y las de la otra no
- **THEN** los ajustes lo señalan únicamente para la red afectada

#### Scenario: Meta no informa el vencimiento

- **WHEN** Meta no informa cuándo caducan las credenciales
- **THEN** la conexión se guarda igual y el sistema no afirma una fecha de vencimiento
