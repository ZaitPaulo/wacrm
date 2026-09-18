## ADDED Requirements

### Requirement: Los datos obligatorios dependen del motivo

El sistema SHALL exigir para cada motivo de traspaso los datos que tienen sentido para él:

- `vende_su_carro` (el cliente quiere venderle su carro al concesionario): nombre y datos del carro, declarados en `interes`. Presupuesto y crédito NO SHALL exigirse.
- `sin_stock` (nada del inventario le sirve): nombre, presupuesto y lo que busca. Crédito NO SHALL exigirse.
- Los demás motivos no urgentes conservan los cuatro datos obligatorios.

La nota del traspaso SHALL nombrar el motivo en español; para `vende_su_carro` SHALL mostrar el carro que ofrece en lugar de presupuesto, interés y crédito.

#### Scenario: Cliente que vende su carro

- **WHEN** el modelo pide transferir con motivo `vende_su_carro`, nombre "Luis Miguel" e interés "Citroën C3 2024, 50 mil km, placa de Sincelejo", sin presupuesto ni crédito
- **THEN** la conversación se transfiere
- **AND** la nota dice "Motivo: quiere vender su carro · Nombre: Luis Miguel · Su carro: Citroën C3 2024, 50 mil km, placa de Sincelejo"

#### Scenario: Vendedor sin datos del carro

- **WHEN** el modelo pide transferir con motivo `vende_su_carro` y sin interés
- **THEN** la conversación no se transfiere y falta `interes`

#### Scenario: Nada del inventario le sirve

- **WHEN** el modelo pide transferir con motivo `sin_stock`, nombre, presupuesto "20 millones de contado" e interés "carro 1.2 económico", sin crédito
- **THEN** la conversación se transfiere con la nota "Motivo: no hay lo que busca"
