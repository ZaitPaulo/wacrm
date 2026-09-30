## MODIFIED Requirements

### Requirement: El cliente sabe quién lo va a atender

El aviso que recibe el cliente al transferirse la conversación SHALL nombrar al asesor asignado, usando su primer nombre.

Cuando no haya asesor asignable, el aviso SHALL conservar la forma anónima, sin prometer un nombre que no existe.

El aviso SHALL decir también cuándo lo va a contactar el asesor, según el horario de atención de la cuenta (`accounts.business_hours` y `holiday_calendar`):

- dentro del horario: que lo contactan en los próximos minutos;
- fuera del horario, si la próxima apertura es el mismo día o el siguiente: "hoy" o "mañana", más la hora de apertura (por ejemplo, "mañana desde las 8:00 a. m.");
- fuera del horario, si la próxima apertura es más adelante: el nombre del día y la hora (por ejemplo, "el lunes desde las 8:00 a. m.").

Si la cuenta no tiene configurado el horario (`quiet_hours_enabled` apagado o sin franjas), o no hay próxima apertura, el aviso SHALL quedar sin mención de tiempo, como hasta ahora.

#### Scenario: Con asesor asignado

- **WHEN** la conversación se asigna a un asesor llamado "Juan Marino Arias Medina"
- **THEN** el cliente recibe un aviso que menciona a "Juan"

#### Scenario: Sin asesor disponible

- **WHEN** la cuenta no tiene ningún miembro con rol `agent`
- **THEN** la conversación queda en la cola compartida
- **AND** el cliente recibe el aviso sin nombre

#### Scenario: Traspaso en horario de atención

- **WHEN** la conversación se traspasa un martes a las 10:00 a. m. con horario de lunes a viernes de 8:00 a 18:00
- **THEN** el aviso dice que el asesor lo contacta en los próximos minutos

#### Scenario: Traspaso de noche

- **WHEN** la conversación se traspasa un martes a las 11:00 p. m.
- **THEN** el aviso dice que el asesor lo contacta mañana desde las 8:00 a. m.

#### Scenario: Traspaso el sábado por la tarde

- **WHEN** la conversación se traspasa un sábado a las 3:00 p. m., el domingo es cerrado y el lunes no es festivo
- **THEN** el aviso dice que el asesor lo contacta el lunes desde las 8:00 a. m.

#### Scenario: Sin horario configurado

- **WHEN** la cuenta tiene `quiet_hours_enabled` apagado
- **THEN** el aviso no menciona cuándo

## ADDED Requirements

### Requirement: El traspaso no se come la respuesta del bot

Cuando el modelo pide un traspaso y además escribió texto para el cliente, y el traspaso se concreta, el sistema SHALL enviar primero ese texto, ya pasado por el filtro de salida y con los enlaces de vehículos, y después el aviso de traspaso. Si el modelo solo escribió el marcador, el cliente SHALL recibir únicamente el aviso, como hasta ahora.

#### Scenario: El cliente preguntó algo al completar los datos

- **WHEN** el cliente pregunta "¿Sería la cuota de cuánto?", el modelo responde que la cuota la calcula el asesor con el banco y pide el traspaso con todos los datos
- **THEN** el cliente recibe primero esa respuesta
- **AND** después recibe el aviso de traspaso

#### Scenario: Solo el marcador

- **WHEN** el modelo devuelve únicamente el marcador de traspaso y el traspaso se concreta
- **THEN** el cliente recibe solo el aviso de traspaso
