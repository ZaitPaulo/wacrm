## ADDED Requirements

### Requirement: Aviso por cita asignada
Cuando se crea una cita asignada a un asesor distinto de quien la crea, o se reasigna una cita a otro asesor, el sistema SHALL crear para el nuevo asesor una notificación `appointment_assigned` con el cliente, la fecha y la hora, vinculada a la cita. Si el asesor se agenda a sí mismo, NO SHALL notificarse. El aviso SHALL generarlo la base, sin depender de la pantalla que hizo el cambio.

#### Scenario: Admin agenda para Carlos
- **WHEN** un admin crea una cita asignada a Carlos
- **THEN** Carlos recibe una notificación «Nueva cita: Laura Gómez, lunes 6, 9:00 a. m.»

#### Scenario: Asesor se agenda a sí mismo
- **WHEN** Angélica crea una cita asignada a ella misma
- **THEN** no se crea ninguna notificación

### Requirement: Aviso cuando el cliente pide cambiar la hora
Cuando el cliente toca «Necesito cambiar la hora» en un recordatorio vigente, el sistema SHALL crear para el asesor de la cita una notificación `appointment_change_requested` con el cliente y la hora actual de la cita, vinculada a la cita y a su conversación.

#### Scenario: Pedido de cambio
- **WHEN** Jorge pide cambiar su cita con Angélica
- **THEN** Angélica recibe «Jorge Castro pidió cambiar su cita del martes 7, 2:00 p. m.»

### Requirement: Resumen diario de visitas
Cada día, a partir de la hora del resumen configurada, el sistema SHALL crear para cada asesor una única notificación `appointment_digest` que lista sus citas activas del día (hora y cliente) e indica cuántas citas suyas del día anterior quedaron sin marcar asistencia. Si no tiene citas hoy ni citas de ayer pendientes de marcar, NO SHALL crearse. Si el proceso corre más de una vez, el asesor NO SHALL recibir dos resúmenes del mismo día.

#### Scenario: Asesor con visitas
- **WHEN** a las 07:30 Angélica tiene citas hoy a las 09:00 y a las 14:00
- **THEN** recibe «Tus visitas de hoy: 2» con «9:00 a. m. Sandra Pérez · 2:00 p. m. Jorge Castro»

#### Scenario: Asistencia sin marcar
- **WHEN** Carlos no tiene citas hoy pero dejó una de ayer en `scheduled`
- **THEN** recibe un resumen que le recuerda marcar la asistencia de esa cita

#### Scenario: Sin nada
- **WHEN** Julián no tiene citas hoy ni pendientes de ayer
- **THEN** no recibe resumen

### Requirement: Los avisos de cita llegan por push
Las notificaciones de cita SHALL enviarse por push a los dispositivos suscritos del asesor por el mismo mecanismo que las demás notificaciones, sin un camino de envío propio.

#### Scenario: CRM cerrado
- **WHEN** se le asigna una cita a Carlos y no tiene el CRM abierto
- **THEN** su celular muestra el aviso del sistema operativo
