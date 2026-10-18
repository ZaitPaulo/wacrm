## ADDED Requirements

### Requirement: La venta se puede registrar desde la ficha del contacto

La ficha del contacto SHALL ofrecer "Registrar venta" a miembros con rol `agent` o superior. La acción SHALL abrir el mismo cierre de venta que el Inventario, con el contacto ya elegido como comprador y un selector de vehículos limitado a los que están en estado `available` o `reserved`. Las reglas de cierre (precio final, fecha por defecto hoy, comprador de la misma cuenta) SHALL ser las mismas que desde el Inventario.

#### Scenario: Vender desde la ficha
- **WHEN** un asesor pulsa "Registrar venta" en la ficha de "Juan Pérez", elige la CX-30 2022, indica el precio final y confirma
- **THEN** la CX-30 queda vendida con Juan como comprador, y la venta aparece en su hoja de vida

#### Scenario: Cancelar desde la ficha
- **WHEN** el asesor abre "Registrar venta" desde la ficha y cancela
- **THEN** ningún vehículo cambia de estado

#### Scenario: Un vehículo vendido no se ofrece
- **WHEN** el asesor abre "Registrar venta"
- **THEN** el selector no incluye vehículos en estado `sold` ni `hidden`
