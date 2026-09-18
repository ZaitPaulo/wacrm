## ADDED Requirements

### Requirement: Con crédito, el traspaso lleva el perfil del cliente

Cuando el modelo declare que el cliente requiere crédito, el sentinel de transferencia SHALL incluir además la ocupación del cliente y sus ingresos mensuales aproximados. Ambos campos admiten el valor desconocido, igual que los demás.

El modelo SHALL pedir estos dos datos con naturalidad antes de transferir por crédito. NO SHALL pedir cédula, datos bancarios, extractos, desprendibles de pago ni fotos de documentos.

Cuando el cliente no requiere crédito, estos dos campos NO SHALL exigirse.

#### Scenario: Traspaso por crédito con perfil completo

- **WHEN** el modelo pide transferir con nombre, presupuesto, vehículo de interés, crédito = sí, ocupación e ingresos
- **THEN** la conversación se transfiere al asesor

#### Scenario: Traspaso por crédito sin perfil

- **WHEN** el modelo pide transferir con los cuatro datos, crédito = sí, y sin ocupación ni ingresos
- **THEN** la conversación no se transfiere en ese turno
- **AND** el cliente recibe un mensaje que le pregunta a qué se dedica y cuánto gana más o menos al mes

#### Scenario: Comprador de contado

- **WHEN** el modelo pide transferir con los cuatro datos y crédito = no, sin ocupación ni ingresos
- **THEN** la conversación se transfiere al asesor

### Requirement: El perfil de crédito no deja al cliente atascado

Si la conversación ya tuvo al menos una transferencia rechazada y en el intento actual los únicos datos que faltan son la ocupación o los ingresos, la transferencia SHALL concretarse. Los cuatro datos obligatorios conservan sus reglas: esta salida no aplica mientras falte alguno de ellos.

#### Scenario: El cliente no quiere decir sus ingresos

- **WHEN** el modelo pide transferir por crédito por segunda vez, con los cuatro datos y todavía sin ingresos
- **THEN** la conversación se transfiere al asesor
- **AND** la nota interna muestra los ingresos marcados como faltantes

## MODIFIED Requirements

### Requirement: El asesor recibe los datos recolectados

Cuando una transferencia se concrete, la nota interna que queda en la conversación SHALL incluir los datos que el modelo recolectó y el motivo declarado, para que el asesor sepa con qué contexto entra. Si el cliente requiere crédito, la nota SHALL incluir también ocupación e ingresos aproximados.

Los campos que no se obtuvieron SHALL aparecer marcados como faltantes, no omitidos en silencio.

#### Scenario: Transferencia completa

- **WHEN** una conversación se transfiere con los cuatro datos
- **THEN** la nota interna incluye nombre, presupuesto, vehículo de interés, crédito y motivo

#### Scenario: Transferencia por crédito con perfil

- **WHEN** una conversación se transfiere con crédito = sí, ocupación "comerciante independiente" e ingresos "3 millones"
- **THEN** la nota interna incluye ocupación e ingresos además de los cuatro datos

#### Scenario: Transferencia urgente incompleta

- **WHEN** una conversación se transfiere por urgencia sin presupuesto ni vehículo de interés
- **THEN** la nota interna muestra esos dos campos marcados como faltantes
- **AND** indica que la transferencia fue por urgencia
