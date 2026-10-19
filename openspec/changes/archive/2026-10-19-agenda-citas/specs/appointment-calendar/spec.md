## ADDED Requirements

### Requirement: Sección Agenda en el menú
El menú lateral SHALL mostrar la entrada «Agenda», justo después de «Bandeja», para todos los roles. La ruta `/agenda` SHALL ser accesible para owner, admin, agent y viewer.

#### Scenario: Asesor abre la Agenda
- **WHEN** un asesor toca «Agenda» en el menú
- **THEN** ve la Agenda en la vista Día de hoy con sus citas

### Requirement: Vistas Día, Semana y Mes
La Agenda SHALL ofrecer tres vistas:
- **Día**: una columna por asesor visible, con franjas de 30 minutos dentro del horario de atención y una línea con la hora actual si el día es hoy.
- **Semana**: siete días, con las citas de todos los asesores visibles, cada asesor con su color.
- **Mes**: cuántas citas activas tiene cada día.

Cada cita SHALL mostrar el cliente, la hora, el motivo o el vehículo, y su estado. La vista, la fecha, el asesor filtrado y la cita abierta SHALL reflejarse en la URL, para que un enlace o un aviso lleve exactamente a esa vista.

#### Scenario: Vista Día como admin
- **WHEN** un admin abre la vista Día del martes 7
- **THEN** ve una columna por cada asesor con sus citas de ese día

#### Scenario: Vista Día como asesor
- **WHEN** un asesor abre la vista Día
- **THEN** ve una sola columna, la suya

#### Scenario: Enlace a una cita
- **WHEN** se abre `/agenda?cita=<id>` de una cita visible
- **THEN** la Agenda muestra el día de esa cita con su detalle abierto

#### Scenario: Del mes al día
- **WHEN** el usuario toca un día en la vista Mes
- **THEN** pasa a la vista Día de esa fecha

### Requirement: Filtro por asesor
Owner, admin y viewer SHALL poder filtrar la Agenda por un asesor o ver todos. Para el rol `agent`, el filtro NO SHALL mostrarse.

#### Scenario: Filtrar
- **WHEN** un admin elige «Daniela» en el filtro de la vista Semana
- **THEN** solo ve las citas de Daniela

### Requirement: Agendar desde la conversación
La cabecera de la conversación en la bandeja SHALL tener el botón «Agendar visita» para quien pueda crear citas. El formulario SHALL abrirse con el contacto y la conversación precargados, el asesor de la conversación (o quien agenda, si no tiene asesor; un `agent` siempre queda como asesor él mismo), la duración por defecto de la cuenta, y como sugeridos los vehículos que el contacto consultó. El selector de hora SHALL ofrecer solo las franjas libres del asesor elegido para el día elegido.

#### Scenario: Agendar con vehículo sugerido
- **WHEN** el asesor toca «Agendar visita» en la conversación de Jorge Castro, que consultó la Chevrolet Tracker 2021
- **THEN** el formulario muestra a Jorge Castro, el asesor de la conversación y la Tracker entre los vehículos sugeridos

#### Scenario: Hora ocupada mientras se llenaba el formulario
- **WHEN** otra persona ocupa la franja elegida antes de que el asesor guarde
- **THEN** el guardado falla con el mensaje «Esa hora ya está ocupada» y las franjas se recargan

#### Scenario: Viewer
- **WHEN** un viewer abre una conversación
- **THEN** no ve el botón «Agendar visita»

### Requirement: Crear desde el calendario
Tocar una franja libre de la Agenda SHALL abrir el formulario de cita con esa fecha, hora y asesor, para buscar y elegir al contacto. Solo SHALL permitirse a quien pueda crear citas.

#### Scenario: Clic en franja libre
- **WHEN** un admin toca la franja de las 10:00 en la columna de Carlos
- **THEN** se abre el formulario con Carlos, el día y las 10:00 ya elegidos

### Requirement: Detalle y acciones de la cita
Tocar una cita SHALL abrir su detalle, con cliente (y enlace a su conversación), asesor, hora, motivo, vehículos, notas, estado, respuesta del cliente al recordatorio e historial. Las acciones que se ofrecen SHALL depender del estado y del rol, según las transiciones permitidas: confirmar, marcar asistió, marcar no asistió, cancelar, reagendar y, para owner y admin, cambiar de asesor. El viewer NO SHALL ver acciones.

#### Scenario: Cita con cambio pedido
- **WHEN** el asesor abre una cita cuyo cliente tocó «Necesito cambiar la hora»
- **THEN** el detalle muestra que el cliente pidió cambiarla y ofrece «Reagendar»

### Requirement: Mover arrastrando
Quien puede editar una cita activa SHALL poder arrastrarla a otra franja de la vista Día o Semana. En la vista Día, owner y admin SHALL poder soltarla en la columna de otro asesor; para el rol `agent`, las columnas de otros asesores NO SHALL aceptarla. Toda la tarjeta SHALL ser arrastrable, con cursor de mano al pasar por encima. Soltarla SHALL pedir confirmación con la hora nueva y la opción «Avisar al cliente del cambio» antes de guardar. Las citas en estado final NO SHALL poder arrastrarse.

#### Scenario: Mover a otra hora
- **WHEN** el asesor arrastra su cita de las 14:00 a las 16:00 y confirma
- **THEN** la cita queda a las 16:00

#### Scenario: Cancelar el arrastre
- **WHEN** el asesor suelta la cita en otra franja y toca «Cancelar» en la confirmación
- **THEN** la cita sigue a su hora original

### Requirement: Citas en la ficha del contacto
La ficha del contacto en la bandeja SHALL mostrar su próxima cita activa (fecha, hora, asesor y estado) y sus citas anteriores, de la más reciente a la más antigua, cada una con enlace a la Agenda. Solo SHALL mostrar las citas visibles para quien mira.

#### Scenario: Contacto con cita
- **WHEN** el asesor abre la conversación de Jorge Castro, que tiene una cita el martes a las 14:00
- **THEN** la ficha muestra «Próxima cita: martes 7 de octubre, 2:00 p. m.» con su estado

### Requirement: Actualización en vivo
Cuando cambia una cita visible para el usuario (por otra persona, por el cron o por la respuesta del cliente), la Agenda abierta SHALL reflejarlo sin recargar la página.

#### Scenario: Cliente confirma con la Agenda abierta
- **WHEN** el cliente toca «Confirmo» mientras el asesor mira la vista Día
- **THEN** la tarjeta de esa cita pasa a «Confirmada» sin recargar
