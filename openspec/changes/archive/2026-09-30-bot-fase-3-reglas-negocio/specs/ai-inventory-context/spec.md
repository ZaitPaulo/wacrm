## MODIFIED Requirements

### Requirement: El asistente ve todo el inventario disponible

En cada generación —borrador y respuesta automática— el sistema SHALL entregarle al modelo un índice de todos los vehículos con estado disponible de la cuenta.

Cada entrada del índice SHALL incluir referencia pública, marca, modelo, año, precio, kilometraje, transmisión, tipo de carrocería y el enlace a la ficha del vehículo en la vitrina. Con la regla de antigüedad para crédito activa (ver `ai-credit-eligibility`), cada entrada SHALL incluir además su aptitud para crédito vehicular: sí, por confirmar o no.

Los vehículos que no están disponibles NO SHALL aparecer en el índice.

#### Scenario: Un vehículo barato fuera del alcance de la búsqueda semántica

- **WHEN** el cliente pide un carro de 25 millones y el único que entra en ese precio no está entre los extractos que devuelve la búsqueda semántica
- **THEN** ese vehículo aparece igualmente en el índice que recibe el modelo, con su enlace

#### Scenario: Vehículo vendido

- **WHEN** un vehículo pasa a estado vendido
- **THEN** deja de aparecer en el índice

#### Scenario: Cuenta sin inventario

- **WHEN** la cuenta no tiene vehículos disponibles
- **THEN** no se añade índice al prompt, y el resto de la generación ocurre igual

#### Scenario: Aptitud para crédito en la línea

- **WHEN** la regla de crédito es de 10 años, el año en curso es 2026 y hay un Chevrolet Aveo 2013 disponible
- **THEN** su línea del índice dice "crédito vehicular: no"
