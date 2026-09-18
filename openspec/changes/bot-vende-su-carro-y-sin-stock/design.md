## Context

`evaluateHandoffGate` exigía los mismos cuatro datos (nombre, presupuesto, interés, crédito) a todo traspaso no urgente. Eso encaja con quien compra, no con quien vende ni con quien no encontró nada.

## Decisions

- **Tabla de datos por motivo** (`FIELDS_BY_REASON`) en vez de una condición por caso: un motivo nuevo con requisitos propios es una línea.
- **Los datos del carro del vendedor van en `interes`**, sin campos nuevos en el marcador. La nota cambia la etiqueta a "Su carro:". Agregar campos (km, placa, precio) al marcador solo para este caso agrandaría el formato que el modelo tiene que respetar en todos los traspasos.
- **`sin_stock` con salvaguarda en el prompt**: no se usa porque falte el año o el color exacto; primero se ofrecen las alternativas más cercanas. El gate no puede verificarlo.
- **El perfil de crédito sigue aplicando** si alguno de estos declara crédito = sí.

## Risks / Trade-offs

- [El prompt de la base enumera los motivos válidos y todavía promete avisar] → Mientras no se ajuste, el modelo ve dos listas distintas. Por eso el ajuste va en la lista de despliegue.
