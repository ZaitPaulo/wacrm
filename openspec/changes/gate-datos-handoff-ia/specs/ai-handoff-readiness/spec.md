## ADDED Requirements

### Requirement: El modelo declara los datos del cliente al pedir una transferencia

En modo `auto_reply`, el modelo SHALL pedir la transferencia a un asesor emitiendo un sentinel que incluya los datos que recolectó del cliente: nombre, presupuesto, vehículo de interés, si requiere crédito, y el motivo de la transferencia.

Un sentinel sin datos NO SHALL considerarse una petición de transferencia válida.

El sistema SHALL tolerar campos declarados como desconocidos: el modelo indica explícitamente cuáles no pudo obtener, en vez de omitirlos o inventarlos.

#### Scenario: Sentinel completo

- **WHEN** el modelo emite el sentinel con nombre, presupuesto, vehículo de interés, crédito y motivo
- **THEN** el sistema lo interpreta como una petición de transferencia con esos datos

#### Scenario: Sentinel sin datos

- **WHEN** el modelo emite el sentinel desnudo, sin ningún campo
- **THEN** el sistema NO transfiere la conversación
- **AND** trata el turno como una transferencia incompleta a la que le faltan todos los datos

#### Scenario: Campo declarado como desconocido

- **WHEN** el modelo emite el sentinel y marca el presupuesto como desconocido
- **THEN** el sistema considera ese campo faltante, no vacío ni inventado

### Requirement: Transferencia bloqueada mientras falten datos

El sistema SHALL rechazar la transferencia cuando falte cualquiera de los cuatro datos obligatorios: nombre, presupuesto, vehículo de interés y si requiere crédito.

Ante una transferencia rechazada, el auto-reply SHALL seguir atendiendo la conversación y SHALL pedirle al cliente los datos que falten. La conversación NO SHALL quedar asignada a un asesor, el bot NO SHALL apagarse en ese hilo, y el cliente NO SHALL recibir el aviso de "te asignamos un asesor comercial".

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
- **AND** el auto-reply se apaga en ese hilo
- **AND** el cliente recibe el aviso de asignación

### Requirement: Excepción por urgencia

Cuando el motivo declarado sea un reclamo del cliente o una petición explícita de hablar con una persona, el sistema SHALL exigir únicamente el nombre. Los demás datos NO SHALL bloquear la transferencia.

#### Scenario: Cliente molesto con nombre conocido

- **WHEN** el modelo pide transferir por reclamo y declara el nombre, sin presupuesto ni vehículo
- **THEN** la conversación se transfiere de inmediato

#### Scenario: Cliente pide un humano y no ha dado su nombre

- **WHEN** el modelo pide transferir porque el cliente pidió hablar con una persona, sin declarar nombre
- **THEN** la conversación no se transfiere en ese turno
- **AND** el cliente recibe un mensaje que le pregunta su nombre

### Requirement: Una transferencia urgente no queda atascada

El sistema SHALL contar los intentos de transferencia rechazados por urgencia en cada conversación. Al segundo intento urgente, la conversación SHALL transferirse aunque el nombre siga faltando.

Este escape NO SHALL aplicar a las transferencias no urgentes: una conversación sin reclamo ni petición de humano permanece con el bot hasta reunir los cuatro datos.

#### Scenario: El cliente se niega a dar su nombre

- **WHEN** el modelo pide transferir por urgencia por segunda vez en la misma conversación y el nombre sigue sin declararse
- **THEN** la conversación se transfiere al asesor

#### Scenario: Reintento no urgente

- **WHEN** el modelo pide transferir por quinta vez sin urgencia y sigue faltando el presupuesto
- **THEN** la conversación no se transfiere

### Requirement: El asesor recibe los datos recolectados

Cuando una transferencia se concrete, la nota interna que queda en la conversación SHALL incluir los datos que el modelo recolectó y el motivo declarado, para que el asesor sepa con qué contexto entra.

Los campos que no se obtuvieron SHALL aparecer marcados como faltantes, no omitidos en silencio.

#### Scenario: Transferencia completa

- **WHEN** una conversación se transfiere con los cuatro datos
- **THEN** la nota interna incluye nombre, presupuesto, vehículo de interés, crédito y motivo

#### Scenario: Transferencia urgente incompleta

- **WHEN** una conversación se transfiere por urgencia sin presupuesto ni vehículo de interés
- **THEN** la nota interna muestra esos dos campos marcados como faltantes
- **AND** indica que la transferencia fue por urgencia
