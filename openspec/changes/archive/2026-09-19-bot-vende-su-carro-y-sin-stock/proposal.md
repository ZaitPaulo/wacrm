## Why

En la revisión del 2026-09-18 aparecieron dos situaciones sin camino:

- Clientes que quieren **venderle su carro** al concesionario (un Citroën C3 2024 con fotos, una Ford Explorer 2019). El bot mezclaba la venta con ofrecerles inventario y nunca los pasaba a nadie, porque el traspaso exige presupuesto y crédito, que a un vendedor no le aplican.
- Clientes a los que **nada del inventario les sirve**. El bot prometía "te aviso cuando entre uno" o "te guardo el contacto", y nada en el sistema lo hace: el prospecto se perdía.

Decisión del negocio: los dos casos se pasan a un asesor por el reparto normal.

## What Changes

- Motivo de traspaso `vende_su_carro`: el bot pide marca, modelo, año, kilometraje, ciudad de la placa, fotos y precio pedido, sin dar avalúo, y traspasa con nombre y los datos del carro.
- Motivo de traspaso `sin_stock`: después de ofrecer las alternativas más cercanas, traspasa con nombre, presupuesto y lo que busca.
- La nota del traspaso los nombra en español ("quiere vender su carro", "no hay lo que busca") y, para el vendedor, muestra "Su carro:" sin presupuesto ni crédito.
- El prompt base prohíbe prometer seguimientos que nadie hace.

## Capabilities

### Modified Capabilities

- `ai-handoff-readiness`: los datos obligatorios dependen del motivo.

## Impact

- `src/lib/ai/types.ts`, `handoff-gate.ts`, `handoff.ts`, `defaults.ts` y sus pruebas.
- Producción: el `system_prompt` de la base enumera los motivos y promete avisar; hay que ajustarlo al desplegar (ver `prompt-produccion.md`).
