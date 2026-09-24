# handoff-deal-creation Specification

## Purpose
TBD - created by archiving change agent-performance-dashboard. Update Purpose after archive.
## Requirements
### Requirement: El traspaso al asesor abre el negocio

Cuando la IA transfiere una conversación a un asesor, el sistema SHALL crear un negocio abierto vinculado a esa conversación y a su contacto, sin intervención del asesor.

El negocio SHALL crearse en el embudo llamado "Ventas" —sin distinguir mayúsculas ni espacios— o, si no existe, en el primero por fecha de creación, y en la etapa de menor posición de ese embudo. Es el mismo criterio que ya usa la creación desde la bandeja, para que un negocio nacido del bot y uno creado a mano caigan en el mismo sitio.

El negocio SHALL quedar asignado al mismo asesor que recibió la conversación.

#### Scenario: Traspaso normal

- **WHEN** la IA transfiere una conversación al asesor Juan
- **THEN** se crea un negocio abierto en Ventas/Prospecto, vinculado a esa conversación y a su contacto, y asignado a Juan

#### Scenario: El traspaso queda en la cola compartida

- **WHEN** la IA transfiere una conversación y la cuenta no tiene ningún asesor disponible
- **THEN** el negocio se crea igualmente, sin asesor asignado

### Requirement: El negocio hereda lo que el bot averiguó

El negocio creado en el traspaso SHALL llevar el nombre del cliente y el vehículo de interés recogidos por el bot, y SHALL conservar el motivo del traspaso y los demás datos de la calificación —presupuesto, interés y si requiere crédito, más ocupación e ingresos cuando los haya— de modo que el asesor no tenga que releer la conversación entera.

Un dato que el bot no obtuvo NO SHALL inventarse ni rellenarse con un valor por defecto que se lea como real.

#### Scenario: Traspaso por crédito con perfil completo

- **WHEN** la IA transfiere por crédito con nombre, presupuesto, interés, ocupación e ingresos
- **THEN** el negocio creado refleja esos datos y el motivo `credito`

#### Scenario: Traspaso urgente sin presupuesto

- **WHEN** la IA transfiere porque el cliente pidió hablar con una persona y solo tiene su nombre
- **THEN** el negocio se crea con lo que hay y los datos faltantes quedan señalados como faltantes

### Requirement: Un traspaso no duplica el negocio

El sistema NO SHALL crear un segundo negocio abierto para una conversación que ya tiene uno. Una conversación reactivada y vuelta a transferir SHALL seguir apuntando al mismo negocio.

#### Scenario: Segunda transferencia del mismo hilo

- **WHEN** una conversación que ya tiene negocio abierto se devuelve al bot y este la vuelve a transferir
- **THEN** no se crea un negocio nuevo y el existente se conserva

#### Scenario: Negocio previo cerrado

- **WHEN** la conversación tuvo un negocio que se cerró y el bot la transfiere de nuevo
- **THEN** se crea un negocio nuevo, porque el anterior ya no está en gestión

### Requirement: Un fallo creando el negocio no cuesta el traspaso

Si la creación del negocio falla, el sistema SHALL completar igualmente la transferencia: el asesor queda asignado, el cliente recibe su aviso y el fallo se registra. Perder una tarjeta del embudo es preferible a dejar a un cliente esperando.

#### Scenario: Error al insertar el negocio

- **WHEN** falla la creación del negocio durante una transferencia
- **THEN** la conversación queda asignada al asesor, el cliente recibe el aviso y el error queda en el registro

