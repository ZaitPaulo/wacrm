# appointment-pre-visit-alert Specification

## Purpose
TBD - created by archiving change agenda-citas-avisos. Update Purpose after archive.
## Requirements
### Requirement: Aviso de visita próxima
El sistema SHALL crear una notificación `appointment_pre_visit` para el asesor de cada cita `scheduled` o `confirmed` cuando falten los minutos configurados o menos para su inicio, con el cliente, la hora, el motivo y los vehículos. Cada hora vigente de una cita SHALL avisarse como máximo una vez. Si la cita se reagenda, SHALL volver a avisarse para la hora nueva. Una cita que ya empezó NO SHALL avisarse. Este aviso es para el asesor y NO SHALL frenarse por el horario de atención.

#### Scenario: Una hora antes
- **WHEN** son las 2:00 p. m. y Angélica tiene una cita confirmada a las 3:00 p. m., con el aviso en 60 minutos
- **THEN** Angélica recibe «En 1 hora: Jorge Castro · Ver un carro · Chevrolet Tracker 2021»

#### Scenario: Primera cita del día
- **WHEN** el horario abre a las 8:00 y hay una cita a las 8:00
- **THEN** el aviso sale a las 7:00

#### Scenario: Cita agendada con poca anticipación
- **WHEN** a las 2:30 p. m. se agenda una cita para las 3:00 p. m.
- **THEN** el aviso sale en la siguiente pasada, antes de las 3:00 p. m.

#### Scenario: Cita reagendada
- **WHEN** una cita que ya tuvo su aviso se mueve a otro día
- **THEN** recibe un aviso nuevo antes de la hora nueva

#### Scenario: Cita cancelada
- **WHEN** una cita se cancela antes de su aviso
- **THEN** no se crea ningún aviso

### Requirement: Anticipación configurable
La configuración de la Agenda SHALL incluir la anticipación del aviso de visita próxima: 60 minutos por defecto, entre 15 y 240, o apagado. Solo owner y admin SHALL poder cambiarla.

#### Scenario: Cambiar a 30 minutos
- **WHEN** un admin cambia la anticipación a 30 minutos
- **THEN** los avisos siguientes salen 30 minutos antes de cada cita

#### Scenario: Apagar el aviso
- **WHEN** un admin apaga el aviso de visita próxima
- **THEN** no se crean más avisos de visita próxima

