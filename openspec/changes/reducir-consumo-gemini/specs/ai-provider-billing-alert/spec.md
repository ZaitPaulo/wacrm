## ADDED Requirements

### Requirement: El saldo agotado del proveedor se reconoce como tal

El adaptador de proveedores SHALL clasificar como `billing_exhausted` una respuesta HTTP 402, o cualquier error cuyo mensaje indique créditos prepago agotados o facturación requerida. Ese código MUST NOT tratarse como fallo pasajero: el auto-reply no reintenta la llamada.

#### Scenario: Gemini responde 402

- **WHEN** Gemini responde HTTP 402 "Your prepayment credits are depleted"
- **THEN** la llamada falla con el código `billing_exhausted`
- **AND** no se hace el reintento de fallo pasajero

#### Scenario: Error 500 del proveedor

- **WHEN** Gemini responde HTTP 500
- **THEN** el error sigue siendo `provider_error` y se reintenta una vez, como hoy

### Requirement: Owner y admin se enteran de que se agotó el saldo

Cuando una llamada del bot falla por `billing_exhausted`, el sistema SHALL crear una notificación del CRM de tipo `ai_billing_exhausted` para cada owner y admin de la cuenta, con un texto que diga que el bot está sin saldo en Gemini y que hay que recargar en AI Studio. La notificación MUST NOT enviarse por WhatsApp. El aviso SHALL emitirse como máximo una vez cada 6 horas por cuenta mientras el saldo siga agotado.

La conversación afectada se traspasa como hoy en un fallo del proveedor, con una nota que diga que el motivo es el saldo agotado.

#### Scenario: Primer fallo por saldo

- **WHEN** a las 19:31 falla la primera llamada por `billing_exhausted`
- **THEN** cada owner y admin recibe la notificación en el CRM
- **AND** la conversación se traspasa con la nota de saldo agotado

#### Scenario: Fallos seguidos

- **WHEN** fallan 40 llamadas por saldo en las 6 horas siguientes
- **THEN** no se crean notificaciones nuevas en ese lapso

#### Scenario: Sigue sin saldo al día siguiente

- **WHEN** el saldo sigue agotado 7 horas después del primer aviso y falla otra llamada
- **THEN** owner y admin reciben un aviso nuevo

#### Scenario: El aviso no cuesta nada

- **WHEN** se emite el aviso
- **THEN** no se envía ningún mensaje por WhatsApp ni por otro servicio de pago
