# appointment-lifecycle-alerts Specification

## Purpose
TBD - created by archiving change agenda-citas-avisos. Update Purpose after archive.
## Requirements
### Requirement: Aviso de carro no disponible
Cuando un vehículo del inventario pasa de `available` o `reserved` a `sold` o `hidden`, o se borra, el sistema SHALL crear una notificación `appointment_vehicle_unavailable` para el asesor de cada cita `scheduled` o `confirmed` con inicio futuro que tenga ese vehículo, indicando qué pasó con el vehículo, el cliente y la fecha y hora de la cita. NO SHALL avisarse cuando el comprador registrado del vehículo es el mismo contacto de la cita. El aviso por borrado SHALL crearse antes de que la cita pierda el vínculo con el vehículo. Un fallo al crear el aviso NO SHALL impedir el cambio de estado ni el borrado del vehículo.

#### Scenario: Se vende el carro por el que viene otro cliente
- **WHEN** la Chevrolet Tracker 2021 se marca como vendida a Laura Gómez y Jorge Castro tiene una cita activa el jueves por ese carro
- **THEN** el asesor de Jorge recibe «Se vendió la Chevrolet Tracker 2021 · Jorge Castro viene el jueves 9 de octubre, 3:00 p. m.»

#### Scenario: Lo compra el mismo cliente de la cita
- **WHEN** el carro se marca como vendido con Jorge Castro como comprador y la cita es de Jorge
- **THEN** no se crea ningún aviso

#### Scenario: Se borra el carro del inventario
- **WHEN** se borra un vehículo que tiene una cita activa futura
- **THEN** el asesor recibe el aviso «Se borró…» y el vehículo se borra igual

#### Scenario: Cita pasada o cancelada
- **WHEN** se oculta un vehículo cuya única cita ya pasó o está cancelada
- **THEN** no se crea ningún aviso

#### Scenario: Pasa a reservado
- **WHEN** un vehículo de una cita activa pasa a `reserved`
- **THEN** no se crea ningún aviso

### Requirement: Aviso de confirmación del cliente
Cuando el cliente confirma su cita con el botón del recordatorio, el sistema SHALL crear una notificación `appointment_customer_confirmed` para el asesor de la cita con el cliente y la fecha y hora. Confirmar desde el CRM NO SHALL generar este aviso.

#### Scenario: Confirma por WhatsApp
- **WHEN** Jorge toca «Confirmo» en el recordatorio de su cita con Angélica
- **THEN** Angélica recibe «Jorge Castro confirmó su visita del jueves 9 de octubre, 3:00 p. m.»

#### Scenario: El asesor confirma en la Agenda
- **WHEN** Angélica marca la cita como confirmada desde el CRM
- **THEN** no se crea este aviso

### Requirement: Aviso de cita cambiada por otra persona
Cuando otra persona que no es el asesor asignado cambia la hora o la duración de una cita, o la cancela, sin cambiar de asesor, el sistema SHALL crear una notificación `appointment_updated` para el asesor con la hora anterior y la nueva, o con la cancelación. Si el cambio lo hizo el propio asesor, NO SHALL avisarse.

#### Scenario: Un admin mueve la cita
- **WHEN** un admin mueve la cita de Angélica de las 3:00 p. m. a las 5:00 p. m.
- **THEN** Angélica recibe «Tu cita con Jorge Castro pasó del jueves 9 de octubre, 3:00 p. m. al jueves 9 de octubre, 5:00 p. m.»

#### Scenario: Un admin cancela la cita
- **WHEN** un admin cancela una cita de Carlos
- **THEN** Carlos recibe un aviso de que la cita se canceló

#### Scenario: El asesor mueve su propia cita
- **WHEN** Angélica mueve su propia cita
- **THEN** no se crea ningún aviso

### Requirement: Aviso de cita quitada
Cuando una cita se reasigna a otro asesor, el sistema SHALL crear una notificación `appointment_unassigned` para el asesor anterior con el cliente, la fecha y el nombre del asesor nuevo, salvo que el cambio lo haya hecho el propio asesor anterior. En esa misma edición, el asesor anterior NO SHALL recibir además el aviso de cita cambiada.

#### Scenario: Reasignación por un admin
- **WHEN** un admin pasa la cita de Jorge Castro de Carlos a Angélica
- **THEN** Carlos recibe «La cita de Jorge Castro del jueves 9 de octubre, 3:00 p. m. pasó a Angélica Rodríguez» y Angélica recibe el aviso de cita nueva

#### Scenario: Reasignar y mover a la vez
- **WHEN** un admin cambia de asesor y de hora en la misma edición
- **THEN** el asesor anterior recibe solo el aviso de cita quitada

### Requirement: Aviso de asistencia sin marcar
Después del cierre del horario de atención de un día (a las 18:00 si la cuenta no tiene horario), el sistema SHALL crear, para cada asesor con citas de ese día todavía `scheduled` o `confirmed` cuya hora de fin ya pasó, una sola notificación `appointment_attendance_pending` con la cantidad de citas y enlace a la vista Día de esa fecha. Cada cita SHALL incluirse en este aviso como máximo una vez. Las citas de más de 7 días atrás NO SHALL incluirse.

#### Scenario: Dos citas sin marcar
- **WHEN** a las 18:00 Carlos tiene dos citas de hoy que ya terminaron sin marcar asistencia
- **THEN** Carlos recibe un solo aviso «Tienes 2 citas de hoy sin marcar asistencia»

#### Scenario: Pasada repetida
- **WHEN** el proceso corre otra vez a las 18:01
- **THEN** Carlos no recibe un segundo aviso por esas citas

#### Scenario: Todo marcado
- **WHEN** al cierre todas las citas del día de Angélica tienen asistencia marcada
- **THEN** Angélica no recibe aviso

### Requirement: Aviso de cliente que no asistió
Cuando una cita pasa a `no_show`, el sistema SHALL crear una notificación `appointment_no_show` para cada miembro admin de la cuenta (el owner no participa en la Agenda), excepto quien hizo el cambio, con el cliente, el asesor y la fecha de la cita.

#### Scenario: El asesor marca no asistió
- **WHEN** Carlos marca «no asistió» en la cita de Tomás Acosta
- **THEN** cada admin recibe «Tomás Acosta no asistió a su cita con Carlos del martes 7 de octubre, 9:00 a. m.»

#### Scenario: Lo marca un admin
- **WHEN** un admin marca «no asistió»
- **THEN** los demás owner y admin reciben el aviso, y quien lo marcó no

### Requirement: Los avisos de la Agenda llevan a la cita
Tocar cualquiera de estos avisos, en el push, en la campana o en el aviso emergente, SHALL llevar a la Agenda en la cita correspondiente (`/agenda?cita=<id>`). El aviso de asistencia sin marcar SHALL llevar a la vista Día de su fecha. Cada tipo SHALL tener su propio ícono en la campana.

#### Scenario: Aviso de carro no disponible
- **WHEN** el asesor toca el aviso de carro no disponible
- **THEN** el CRM abre la Agenda con el detalle de esa cita

#### Scenario: Aviso de asistencia sin marcar
- **WHEN** el asesor toca «Tienes 2 citas de hoy sin marcar asistencia»
- **THEN** el CRM abre la vista Día de esa fecha

### Requirement: Los avisos nunca bloquean el cambio que los origina
Un fallo al crear cualquiera de estos avisos NO SHALL impedir guardar la cita, cambiar el vehículo ni terminar la pasada del proceso que lo intentaba.

#### Scenario: Falla el aviso de no asistió
- **WHEN** crear el aviso para los admin falla
- **THEN** la cita queda igual marcada como `no_show`

