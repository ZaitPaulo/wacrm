## ADDED Requirements

### Requirement: El asistente ve todo el inventario disponible

En cada generación —borrador y respuesta automática— el sistema SHALL entregarle al modelo un índice de todos los vehículos con estado disponible de la cuenta.

Cada entrada del índice SHALL incluir referencia pública, marca, modelo, año, precio, kilometraje, transmisión y tipo de carrocería.

Los vehículos que no están disponibles NO SHALL aparecer en el índice.

#### Scenario: Un vehículo barato fuera del alcance de la búsqueda semántica

- **WHEN** el cliente pide un carro de 25 millones y el único que entra en ese precio no está entre los extractos que devuelve la búsqueda semántica
- **THEN** ese vehículo aparece igualmente en el índice que recibe el modelo

#### Scenario: Vehículo vendido

- **WHEN** un vehículo pasa a estado vendido
- **THEN** deja de aparecer en el índice

#### Scenario: Cuenta sin inventario

- **WHEN** la cuenta no tiene vehículos disponibles
- **THEN** no se añade índice al prompt, y el resto de la generación ocurre igual

### Requirement: El índice no reemplaza a la búsqueda semántica

El sistema SHALL seguir recuperando extractos del knowledge base y entregándolos junto al índice.

El índice cubre la selección —qué vehículos existen y cuáles cumplen un criterio—; los extractos cubren el detalle de un vehículo concreto: color, cilindraje, placa, características y enlace a la ficha con fotos.

#### Scenario: Pregunta por un vehículo concreto

- **WHEN** el cliente pregunta por un vehículo que nombra
- **THEN** el modelo recibe tanto el índice como los extractos recuperados para ese vehículo

### Requirement: El modelo sabe que el índice es completo

El prompt SHALL declararle al modelo que el índice contiene todo el inventario disponible, y que no debe afirmar que un vehículo no existe sin haberlo consultado.

#### Scenario: El cliente pide algo que no hay

- **WHEN** ningún vehículo del índice cumple lo que pide el cliente
- **THEN** el modelo puede afirmar que no hay nada que encaje, porque el índice es la lista completa

### Requirement: Un catálogo demasiado grande se recorta y se declara

Cuando el número de vehículos disponibles supere el tope configurado, el sistema SHALL incluir solo una parte del índice y SHALL indicarle al modelo que está viendo una selección y no el inventario completo.

En ese caso el modelo NO SHALL afirmar que un vehículo no existe basándose en el índice.

#### Scenario: Inventario por encima del tope

- **WHEN** la cuenta tiene más vehículos disponibles que el tope
- **THEN** el índice se recorta al tope
- **AND** el prompt indica que la lista está incompleta

#### Scenario: Inventario dentro del tope

- **WHEN** la cuenta tiene menos vehículos disponibles que el tope
- **THEN** el índice los incluye todos
- **AND** el prompt lo declara completo

### Requirement: El índice no consulta la base en cada mensaje

El sistema SHALL cachear el índice durante un intervalo corto, de modo que una ráfaga de mensajes entrantes no genere una consulta por cada uno.

El caché SHALL estar acotado por cuenta, para que una cuenta nunca reciba el inventario de otra.

#### Scenario: Dos mensajes seguidos

- **WHEN** llegan dos mensajes de la misma cuenta dentro del intervalo de caché
- **THEN** el inventario se consulta una sola vez

#### Scenario: Dos cuentas distintas

- **WHEN** llegan mensajes de dos cuentas distintas
- **THEN** cada una recibe su propio inventario
