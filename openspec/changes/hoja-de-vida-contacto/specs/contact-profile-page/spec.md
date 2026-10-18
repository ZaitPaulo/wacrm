## ADDED Requirements

### Requirement: La ficha del contacto es una página propia

Cada contacto SHALL tener una ficha a pantalla completa en la ruta `/contacts/[id]`. La ficha SHALL mostrar un encabezado con nombre, teléfono, canales, asesor que lo atiende y etiquetas; un resumen con los datos del contacto y sus campos personalizados; y pestañas para la hoja de vida y los documentos. La URL SHALL poder compartirse y abrirse directamente, y el botón "atrás" del navegador SHALL volver a donde se estaba.

#### Scenario: Abrir la ficha por su enlace
- **WHEN** un miembro de la cuenta abre `/contacts/<id>` de un contacto de su cuenta
- **THEN** ve la ficha completa de ese contacto, con la pestaña de hoja de vida seleccionada

#### Scenario: Contacto de otra cuenta o inexistente
- **WHEN** un miembro abre `/contacts/<id>` con un id que no existe o que pertenece a otra cuenta
- **THEN** ve un aviso de contacto no encontrado, sin ningún dato del contacto

#### Scenario: Ficha en el celular
- **WHEN** la ficha se abre en una pantalla angosta
- **THEN** el resumen y la hoja de vida se apilan en una columna sin desplazamiento horizontal

### Requirement: Desde Contactos, un clic abre la ficha completa

En la lista de Contactos, hacer clic en un contacto SHALL navegar a su ficha en `/contacts/[id]`. La lista de Contactos NO SHALL abrir el panel lateral del contacto.

#### Scenario: Clic en un contacto de la lista
- **WHEN** un usuario hace clic en la fila de "Juan Pérez" en la lista de Contactos
- **THEN** el navegador va a `/contacts/<id de Juan>` y muestra su ficha a pantalla completa

#### Scenario: Volver a la lista
- **WHEN** desde la ficha el usuario pulsa "atrás" o el enlace "Contactos"
- **THEN** vuelve a la lista de Contactos

### Requirement: La bandeja conserva su panel lateral y enlaza a la ficha

El panel de contacto de la bandeja SHALL seguir mostrándose al lado de la conversación (y como hoja en pantallas angostas), sin cambios en su contenido. El panel SHALL ofrecer un enlace "Ver hoja de vida" que lleva a `/contacts/[id]` del contacto de la conversación.

#### Scenario: Ir a la ficha desde la bandeja
- **WHEN** un asesor que atiende una conversación pulsa "Ver hoja de vida" en el panel del contacto
- **THEN** se abre la ficha completa de ese contacto

### Requirement: Los demás módulos enlazan a la ficha

Donde se muestre un contacto con nombre en la Agenda (detalle de la cita), en el Inventario (comprador, propietario y vendedor de un vehículo) y en las notificaciones que refieren a un contacto, el nombre SHALL ser un enlace a su ficha.

#### Scenario: Del comprador de un vehículo a su ficha
- **WHEN** un usuario ve en el Inventario un vehículo vendido a "Royse Salas" y hace clic en su nombre
- **THEN** se abre la ficha de "Royse Salas"

#### Scenario: De una cita a la ficha del cliente
- **WHEN** un asesor abre el detalle de una cita en la Agenda y hace clic en el nombre del cliente
- **THEN** se abre la ficha de ese cliente

### Requirement: La ficha solo ofrece las ediciones que la base permite

Los datos, etiquetas y campos personalizados del contacto SHALL ser editables en la ficha solo para quien tiene permiso de escritura sobre el contacto (rol `owner` o `admin`, o un `agent` con una conversación del contacto asignada). Para el resto SHALL mostrarse en solo lectura. Las acciones de agregar nota y registrar interacción SHALL ofrecerse a todo miembro con rol `agent` o superior.

#### Scenario: Un asesor abre la ficha de un cliente de otro asesor
- **WHEN** un `agent` abre la ficha de un contacto cuya conversación está asignada a otro asesor
- **THEN** ve los datos en solo lectura y puede agregar una nota o registrar una llamada

#### Scenario: El asesor asignado edita los datos
- **WHEN** un `agent` abre la ficha de un contacto que tiene asignado y cambia su correo
- **THEN** el cambio se guarda

### Requirement: Las notas se escriben desde la hoja de vida

Encima de la línea de tiempo, la ficha SHALL mostrar una caja para escribir una nota sobre el contacto, disponible para todo miembro con rol `agent` o superior. La nota guardada SHALL aparecer de inmediato en la línea de tiempo con su fecha y el nombre de quien la escribió. Las notas NO SHALL tener una pestaña aparte: se consultan en la línea de tiempo con el filtro "Notas". Las notas que ya existen en `contact_notes` SHALL aparecer en la línea de tiempo.

#### Scenario: Un asesor deja una nota sobre el cliente de otro
- **WHEN** Carlos escribe "Si no le aprueban el crédito, ofrecerle la Mazda 2" en la ficha de un cliente que atiende Angélica y la guarda
- **THEN** la nota aparece arriba en la hoja de vida, a nombre de Carlos, y Angélica la ve al abrir la ficha

#### Scenario: Un viewer no ve la caja de notas
- **WHEN** un miembro con rol `viewer` abre la ficha
- **THEN** ve las notas existentes, pero no la caja para escribir una nueva

### Requirement: Agendar una visita desde la ficha

La ficha SHALL ofrecer un botón "Agendar visita" que abre el mismo formulario de cita de la Agenda (`appointment-dialog.tsx`) con el contacto ya elegido. La cita creada SHALL ser la misma que se ve en la Agenda, y no una copia. El botón SHALL mostrarse solo a quien hoy puede agendarle una cita al contacto (rol `owner` o `admin`, o el `agent` que lo atiende), porque la inserción en `appointments` sigue gobernada por `contact_visible`.

#### Scenario: La cita agendada en la Agenda aparece en la hoja de vida
- **WHEN** Angélica agenda en la Agenda una prueba de manejo para Juan Pérez
- **THEN** al abrir la ficha de Juan, la cita aparece en su hoja de vida con quién la agendó, y si después se mueve o se marca la asistencia en la Agenda, la hoja de vida muestra el cambio

#### Scenario: Agendar desde la ficha
- **WHEN** el asesor que atiende a Juan pulsa "Agendar visita" en su ficha y guarda la cita
- **THEN** la cita aparece en la Agenda de ese asesor y en la hoja de vida de Juan

#### Scenario: Un asesor que no atiende al cliente
- **WHEN** un `agent` abre la ficha de un cliente que atiende otro asesor
- **THEN** no ve el botón "Agendar visita"
