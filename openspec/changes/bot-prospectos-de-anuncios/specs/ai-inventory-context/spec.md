## MODIFIED Requirements

### Requirement: El asistente ve todo el inventario disponible

En cada generación —borrador y respuesta automática— el sistema SHALL entregarle al modelo un índice de todos los vehículos con estado disponible de la cuenta.

Cada entrada del índice SHALL incluir referencia pública, marca, modelo, año, precio, kilometraje, transmisión, tipo de carrocería y el enlace a la ficha del vehículo en la vitrina.

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

## ADDED Requirements

### Requirement: Ningún vehículo nombrado sale sin su enlace

Antes de enviar una respuesta automática, el sistema SHALL detectar qué vehículos del índice nombra el texto. Para cada uno cuyo enlace de ficha no aparezca en el texto, SHALL agregar el enlace al final de la respuesta, una línea por vehículo.

Un vehículo cuenta como nombrado cuando el texto trae su modelo y su año. Como en el inventario puede haber dos vehículos con el mismo modelo y año, el precio desempata; si no hay desempate, se agregan los enlaces de todos los que coinciden, hasta 3.

#### Scenario: El modelo nombra un carro sin enlace

- **WHEN** la respuesta dice "una Kia Sorento Radical 2015, en $64.000.000" sin la URL de su ficha
- **THEN** el mensaje enviado termina con el enlace de la ficha de esa Sorento

#### Scenario: El modelo ya puso todos los enlaces

- **WHEN** la respuesta nombra dos vehículos y trae el enlace de ambos
- **THEN** el mensaje se envía sin cambios

#### Scenario: Mención genérica de una marca

- **WHEN** la respuesta dice "también hay Kia Picanto y Renault Kwid" sin año
- **THEN** no se agrega ningún enlace
