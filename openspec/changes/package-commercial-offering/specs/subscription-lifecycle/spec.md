## ADDED Requirements

### Requirement: La suscripción tiene tres estados con degradación gradual

Una cuenta SHALL estar en uno de tres estados: **activa**, **en gracia** o **suspendida**.

- **Activa**: el sistema funciona sin restricción por estado.
- **En gracia**: el sistema funciona igual que activa, y SHALL mostrarse un aviso visible dentro de la aplicación.
- **Suspendida**: sólo lectura y exportación; la escritura queda bloqueada y la vitrina pública deja de publicarse.

NO SHALL existir un estado que elimine datos del cliente.

#### Scenario: Suscripción vigente

- **WHEN** la cuenta está al día
- **THEN** todo funciona sin aviso ni restricción

#### Scenario: Entra en periodo de gracia

- **WHEN** vence el periodo pagado y la cuenta entra en gracia
- **THEN** el sistema sigue funcionando completo y se muestra un aviso a los miembros con rol `admin` o superior

#### Scenario: El aviso precede a la suspensión

- **WHEN** una cuenta va a ser suspendida
- **THEN** el aviso estuvo visible durante todo el periodo de gracia previo, de modo que la suspensión nunca aparece sin advertencia

#### Scenario: Cuenta suspendida

- **WHEN** la cuenta queda suspendida e intenta crear o modificar información
- **THEN** la escritura se rechaza explicando el estado, mientras la consulta y la exportación siguen disponibles

#### Scenario: Se regulariza el pago

- **WHEN** una cuenta suspendida vuelve a estar al día
- **THEN** recupera de inmediato toda su operación, incluida la publicación de la vitrina, sin pérdida de información

### Requirement: Los datos del cliente siguen siendo suyos en cualquier estado

La exportación de contactos, conversaciones, inventario y documentos SHALL estar disponible en los tres estados, incluida la suspensión.

#### Scenario: Exportación con la cuenta suspendida

- **WHEN** un miembro con rol `admin` o superior de una cuenta suspendida solicita exportar su información
- **THEN** la exportación se entrega completa

### Requirement: Ante la duda, la cuenta se considera activa

Cuando el estado o la vigencia de una cuenta no se puedan determinar —dato ausente, fecha nula o error al resolverlos— el sistema SHALL tratarla como activa y registrar la anomalía.

Detener la operación de un negocio por un fallo de datos propio tiene un costo muy superior al de cobrar tarde.

#### Scenario: Cuenta sin información de suscripción

- **WHEN** una cuenta no tiene estado de suscripción registrado
- **THEN** opera con normalidad y la situación queda registrada para revisión

#### Scenario: Falla la resolución del estado

- **WHEN** ocurre un error al consultar el estado de la suscripción
- **THEN** la petición continúa como si la cuenta estuviera activa, y el fallo queda registrado

### Requirement: La vitrina pública depende del estado de la suscripción

La vitrina pública SHALL dejar de publicarse mientras la cuenta esté suspendida, y SHALL volver a publicarse al regularizarse, conservando las mismas direcciones de cada vehículo.

#### Scenario: Visitante entra a la vitrina de una cuenta suspendida

- **WHEN** alguien abre la vitrina de una cuenta suspendida
- **THEN** no se muestra el inventario, sin exponer que la causa es una falta de pago

#### Scenario: Se reactiva la cuenta

- **WHEN** la cuenta vuelve a estar activa
- **THEN** la vitrina se publica de nuevo y los enlaces que ya circulaban siguen funcionando
