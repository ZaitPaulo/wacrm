## ADDED Requirements

### Requirement: Aptitud para crédito vehicular por antigüedad

Con `ai_configs.credit_max_vehicle_age_years = N` no nulo y el año en curso `A`, cada vehículo SHALL clasificarse por su año de modelo `Y`:

- `Y > A - N`: apto ("sí");
- `Y = A - N`: por confirmar, porque depende de la fecha de matrícula;
- `Y < A - N`: no apto ("no").

Con `N` nulo, no se clasifica ningún vehículo y el bot se comporta como antes.

#### Scenario: Regla de 10 años en 2026

- **WHEN** el máximo es 10 y el año en curso es 2026
- **THEN** un Kia Picanto 2023 es apto, una Duster 2016 queda por confirmar y un Chevrolet Aveo 2013 no es apto

#### Scenario: Regla apagada

- **WHEN** `credit_max_vehicle_age_years` es nulo
- **THEN** las líneas del inventario no traen la marca de crédito

### Requirement: El bot ofrece crédito vehicular solo en vehículos aptos

Cuando la regla está activa, las instrucciones del modelo SHALL:
- prohibir ofrecer financiación bancaria para un vehículo no apto, o decir que todos los vehículos aplican;
- indicar que un vehículo no apto se compra de contado o que el asesor puede revisar otras opciones, como un crédito de libre inversión;
- indicar que, en un vehículo "por confirmar", el crédito depende de la fecha de matrícula y la confirma el asesor.

#### Scenario: Crédito para un Aveo 2013

- **WHEN** un cliente pide financiar el Chevrolet Aveo 2013 con la regla de 10 años
- **THEN** el prompt del modelo marca ese vehículo como "no" para crédito vehicular
- **AND** trae la instrucción de no ofrecerle financiación bancaria

### Requirement: Sin lo que busca, el bot ofrece un asesor en vez de negarse

Las instrucciones fijas del modelo MUST NOT llevarlo a responder que no guardan contactos. Cuando nada del inventario le sirve al cliente, el modelo SHALL ofrecerle que un asesor le ayude a buscarlo (traspaso con `motivo=sin_stock`), sin prometer avisos automáticos.

#### Scenario: El cliente pide que le avisen

- **WHEN** el cliente dice "cuando tengas algo parecido me avisas"
- **THEN** el prompt fijo no contiene la instrucción de no guardar contactos
- **AND** contiene la de ofrecer que un asesor le ayude a buscarlo
