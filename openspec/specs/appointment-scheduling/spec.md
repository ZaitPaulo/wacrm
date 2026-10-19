# appointment-scheduling Specification

## Purpose
TBD - created by archiving change agenda-citas. Update Purpose after archive.
## Requirements
### Requirement: Una cita registra la visita de un cliente con un asesor
El sistema SHALL guardar cada cita con su cuenta, el contacto (obligatorio), la conversación de origen (opcional), el asesor asignado, la fecha y hora de inicio, la duración en minutos (entre 15 y 480, 30 por defecto o la configurada en la cuenta), el motivo (`view_vehicle`, `test_drive`, `appraisal`, `signing` o `delivery`), notas opcionales y cero o más vehículos del inventario de la misma cuenta. La hora de fin SHALL calcularla la base a partir del inicio y la duración, ignorando cualquier valor enviado por el cliente.

#### Scenario: Cita con vehículo
- **WHEN** un asesor guarda una cita para Jorge Castro el martes a las 14:00, motivo `view_vehicle`, con la Chevrolet Tracker 2021
- **THEN** existe una cita `scheduled` de 14:00 a 14:30 vinculada al contacto y al vehículo

#### Scenario: Vehículo de otra cuenta
- **WHEN** se intenta vincular a una cita un vehículo de otra cuenta
- **THEN** la base rechaza el cambio

#### Scenario: Se borra el vehículo
- **WHEN** se borra del inventario un vehículo vinculado a una cita
- **THEN** la cita sigue existiendo, sin ese vehículo

### Requirement: Un asesor no puede tener dos citas activas que se crucen
La base SHALL rechazar cualquier inserción o cambio que deje dos citas en estado `scheduled` o `confirmed` del mismo asesor con intervalos de tiempo que se solapen. Las citas `attended`, `no_show` y `cancelled` NO SHALL ocupar la franja.

#### Scenario: Misma franja
- **WHEN** Angélica tiene una cita activa de 14:00 a 14:30 y se intenta crear otra suya de 14:15 a 14:45
- **THEN** la base rechaza la segunda cita

#### Scenario: Franja de una cita cancelada
- **WHEN** la cita de 14:00 de Angélica está cancelada y se crea otra suya a las 14:00
- **THEN** la nueva cita se guarda

#### Scenario: Otro asesor a la misma hora
- **WHEN** Angélica tiene una cita a las 14:00 y se crea una para Carlos a las 14:00
- **THEN** la cita de Carlos se guarda

### Requirement: Franjas libres dentro del horario de atención
Para un asesor, un día y una duración, el sistema SHALL ofrecer como horas posibles los inicios cada 30 minutos en los que la cita completa cabe dentro del horario de atención de la cuenta (días cerrados y festivos incluidos) y no se cruza con otra cita activa de ese asesor. Si la cuenta no tiene horario configurado, SHALL usar de lunes a sábado de 08:00 a 18:00.

#### Scenario: Día con citas
- **WHEN** el horario del martes es 08:00–18:00 y Angélica tiene citas a las 09:00 y a las 12:00, con duración de 30 minutos
- **THEN** las 09:00 y las 12:00 no se ofrecen, y las 09:30 y las 17:30 sí

#### Scenario: Cita que no cabe antes del cierre
- **WHEN** el horario cierra a las 18:00 y la duración es de 60 minutos
- **THEN** la última hora ofrecida es las 17:00

#### Scenario: Domingo cerrado
- **WHEN** se piden las franjas de un domingo con el domingo cerrado en el horario
- **THEN** no se ofrece ninguna hora

### Requirement: Estados de la cita y sus transiciones
Una cita SHALL estar en uno de cinco estados: `scheduled`, `confirmed`, `attended`, `no_show` o `cancelled`. Desde `scheduled` SHALL poder pasar a `confirmed`, `attended`, `no_show` o `cancelled`, y desde `confirmed` a `attended`, `no_show` o `cancelled`. `attended`, `no_show` y `cancelled` SHALL ser finales para el rol `agent`; solo owner y admin SHALL poder sacarla de ellos para corregir un error.

#### Scenario: Marcar asistencia
- **WHEN** el asesor marca «asistió» en una cita `confirmed`
- **THEN** la cita queda `attended`

#### Scenario: Asesor intenta reabrir
- **WHEN** un asesor intenta pasar a `scheduled` una cita `cancelled`
- **THEN** la base rechaza el cambio

#### Scenario: Admin corrige
- **WHEN** un admin pasa a `confirmed` una cita marcada `no_show` por error
- **THEN** el cambio se guarda

### Requirement: Reagendar devuelve la cita a programada
Cuando cambia la hora de inicio o la duración de una cita activa, la base SHALL recalcular la hora de fin, volverla a `scheduled` aunque estuviera `confirmed`, registrar el momento del cambio y borrar el recordatorio enviado y la respuesta del cliente, para que vuelva a recibir recordatorio. Una cita en estado final NO SHALL poder cambiar de hora.

#### Scenario: Mover una cita confirmada
- **WHEN** una cita `confirmed` de mañana a las 14:00 se mueve a las 16:00
- **THEN** la cita queda `scheduled` a las 16:00, sin recordatorio enviado ni respuesta del cliente

#### Scenario: Mover una cita cancelada
- **WHEN** se intenta cambiar la hora de una cita `cancelled`
- **THEN** la base rechaza el cambio

### Requirement: Historial de la cita
Cada creación, cambio de hora, reasignación y cambio de estado, además de cada confirmación o recordatorio enviado y cada respuesta del cliente, SHALL quedar como un evento con fecha, tipo, el usuario que lo hizo (o vacío si fue el sistema) y los datos del cambio. El registro SHALL hacerlo la base, sin depender de la pantalla que originó el cambio. Los eventos NO SHALL poder editarse ni borrarse desde el cliente.

#### Scenario: Reagendar desde SQL
- **WHEN** se ejecuta `UPDATE appointments SET starts_at = …` directamente
- **THEN** existe un evento `rescheduled` con la hora anterior y la nueva

### Requirement: Visibilidad y escritura por rol
Una cita SHALL ser visible para owner, admin y viewer de la cuenta, y para el rol `agent` solo si es el asesor asignado. Crear y editar citas SHALL requerir al menos el rol `agent`. Un `agent` solo SHALL poder crear o dejar citas asignadas a sí mismo; asignar o reasignar a otro asesor SHALL requerir owner o admin. El asesor asignado SHALL ser miembro de la cuenta con rol `agent` o superior. El owner NO SHALL aparecer en la Agenda: ni en la lista de asesores, ni en las columnas, ni en el filtro. Ningún rol SHALL poder borrar citas: se cancelan.

#### Scenario: Asesor ve solo las suyas
- **WHEN** Carlos (agent) consulta las citas de la semana
- **THEN** solo recibe las que tiene asignadas

#### Scenario: Viewer
- **WHEN** un miembro con rol viewer consulta las citas
- **THEN** recibe todas las de la cuenta y la base rechaza cualquier cambio que intente

#### Scenario: Asesor intenta pasar una cita
- **WHEN** Carlos intenta cambiar el asesor de su cita a Angélica
- **THEN** la base rechaza el cambio

#### Scenario: Admin reasigna
- **WHEN** un admin cambia el asesor de una cita de Carlos a Angélica
- **THEN** la cita queda asignada a Angélica

#### Scenario: Cliente que el asesor no ve
- **WHEN** un asesor intenta crear una cita para un contacto que no tiene ninguna conversación visible para él
- **THEN** la base rechaza la cita

