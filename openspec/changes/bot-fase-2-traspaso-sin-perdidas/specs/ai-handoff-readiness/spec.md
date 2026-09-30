## MODIFIED Requirements

### Requirement: Transferencia bloqueada mientras falten datos

El sistema SHALL rechazar la transferencia cuando falte cualquiera de los cuatro datos obligatorios: nombre, presupuesto, vehículo de interés y si requiere crédito.

Ante una transferencia rechazada, el auto-reply SHALL seguir atendiendo la conversación y SHALL pedirle al cliente los datos que falten. La conversación NO SHALL quedar asignada a un asesor, el bot NO SHALL apagarse en ese hilo, y el cliente NO SHALL recibir el aviso de "te asignamos un asesor comercial".

Excepción por el nombre: si lo único que falta es el nombre y la conversación ya tiene al menos una transferencia rechazada (`ai_handoff_attempts >= 1`), la transferencia SHALL pasar usando como nombre el del perfil del contacto (`contacts.name`, tal como vino de WhatsApp), si existe. El resumen del traspaso SHALL indicar que ese nombre es el del perfil y no uno que el cliente dijo. Sin nombre de perfil, la transferencia sigue bloqueada.

#### Scenario: Falta el presupuesto

- **WHEN** el modelo pide transferir con nombre y vehículo de interés, pero sin presupuesto
- **THEN** la conversación no se transfiere
- **AND** el auto-reply sigue activo en ese hilo
- **AND** el cliente recibe un mensaje que le pregunta por su presupuesto

#### Scenario: El cliente da su presupuesto en el primer turno

- **WHEN** el cliente dice su presupuesto y el modelo pide transferir sin haber mostrado ningún vehículo
- **THEN** la conversación no se transfiere, porque falta el vehículo de interés

#### Scenario: Datos completos

- **WHEN** el modelo pide transferir con los cuatro datos presentes
- **THEN** la conversación se transfiere al asesor
- **AND** el bot queda en espera del asesor (ver `ai-waiting-agent`)
- **AND** el cliente recibe el aviso de asignación

#### Scenario: El cliente no da el nombre

- **WHEN** una transferencia ya fue rechazada por falta de nombre y el modelo vuelve a pedirla sin nombre, con los otros tres datos, para el contacto "Rodrigo Movil"
- **THEN** la conversación se transfiere
- **AND** el resumen dice "Nombre: Rodrigo Movil (perfil de WhatsApp)"

#### Scenario: Sin nombre de perfil

- **WHEN** el contacto no tiene nombre y el modelo pide transferir otra vez sin nombre
- **THEN** la conversación no se transfiere

## ADDED Requirements

### Requirement: El nombre se pide una sola vez

Las instrucciones del modelo SHALL indicarle que pida el nombre del cliente una sola vez, junto a algo útil y no como condición para ayudar. Si el cliente no lo da, el bot MUST NOT volver a preguntarlo y sigue atendiendo.

#### Scenario: El cliente ignora la pregunta

- **WHEN** el bot preguntó el nombre y el cliente responde con otra pregunta sin darlo
- **THEN** el bot responde esa pregunta sin volver a pedir el nombre
