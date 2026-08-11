## ADDED Requirements

### Requirement: Cada cuenta tiene un plan con límites declarados

El sistema SHALL asociar cada cuenta a un plan, y el plan SHALL declarar los topes de uso que aplican a esa cuenta: número de usuarios, número de vehículos en inventario y consultas de IA por periodo.

Los valores de cada tope SHALL vivir en la definición del plan y NO SHALL estar repartidos por el código.

Un tope sin valor SHALL interpretarse como "sin restricción", nunca como cero.

#### Scenario: Cuenta existente al momento del despliegue

- **WHEN** se despliega el cambio sobre una instalación con cuentas ya operando
- **THEN** todas quedan con un plan activo y sin restricción, y ningún usuario percibe un cambio de comportamiento

#### Scenario: Consulta del plan vigente

- **WHEN** un miembro con rol `admin` o superior abre los ajustes de la cuenta
- **THEN** ve qué plan tiene, qué topes aplica y cuánto lleva consumido de cada uno

#### Scenario: Tope sin valor definido

- **WHEN** un plan no declara valor para alguno de sus topes
- **THEN** ese aspecto se trata como ilimitado

### Requirement: Los topes restringen la creación, nunca la consulta

Al alcanzarse un tope, el sistema SHALL impedir crear nuevos elementos de ese tipo, y SHALL seguir permitiendo consultar, editar y exportar todo lo existente.

Alcanzar un tope NUNCA SHALL interrumpir la atención de conversaciones entrantes ni la recepción de mensajes.

#### Scenario: Inventario en el tope

- **WHEN** una cuenta alcanzó el máximo de vehículos de su plan e intenta crear uno más
- **THEN** la operación se rechaza indicando qué límite se alcanzó y cómo ampliarlo, y el inventario existente sigue consultable y editable

#### Scenario: Usuarios en el tope

- **WHEN** una cuenta alcanzó el máximo de usuarios e intenta invitar a otro
- **THEN** la invitación se rechaza con el mismo criterio, y los usuarios actuales conservan su acceso íntegro

#### Scenario: Llega un mensaje con la cuenta en el tope

- **WHEN** entra un mensaje de WhatsApp a una cuenta que alcanzó alguno de sus topes
- **THEN** el mensaje se recibe y se procesa con normalidad

#### Scenario: Se libera espacio bajo el tope

- **WHEN** una cuenta en el tope elimina un elemento y vuelve a quedar por debajo
- **THEN** puede crear de nuevo sin ninguna intervención manual

### Requirement: El límite comercial se distingue del límite técnico

Un tope de plan alcanzado SHALL responder con un error propio y distinguible del que produce la protección contra ráfagas de peticiones. El mensaje SHALL indicar qué límite se alcanzó y qué hacer al respecto.

#### Scenario: Tope de plan alcanzado

- **WHEN** una petición se rechaza por haber alcanzado un tope del plan
- **THEN** la respuesta identifica el límite comercial y no se confunde con una restricción por exceso de peticiones

#### Scenario: Exceso de peticiones en una cuenta sin topes alcanzados

- **WHEN** una cuenta dentro de sus límites envía peticiones a un ritmo excesivo
- **THEN** la protección técnica actúa como hasta ahora, sin mencionar el plan
