## Why

El 2026-09-07, un cliente pidió un carro de 25 millones y el bot le contestó que **no quedaba nada en ese presupuesto**, ofreciéndole un Renault Kwid de $50.000.000 — el doble. Sí había: un Renault Sandero GT 2010 en $22.000.000, disponible e indexado en el knowledge base. El cliente lo encontró solo, mirando la página, y tuvo que nombrarlo para que el bot lo reconociera.

La causa no es el prompt. `retrieveKnowledge` devuelve **k=5** documentos elegidos por similitud semántica sobre 123 vehículos disponibles, y los embeddings no razonan sobre magnitudes: "25 millones" no acerca vectorialmente una ficha que dice "$22.000.000". El bot vio 5 fichas que no incluían el Sandero y dedujo de buena fe que no existía.

Arreglarlo solo para el precio dejaría el mismo agujero abierto para el resto: kilometraje, año, transmisión, tipo de carrocería, "camioneta automática del 2018 en adelante". Cualquier criterio que no sea parecido de texto falla igual.

Medido sobre el inventario real, el catálogo completo son **7.049 caracteres, unos 2.000 tokens** — alrededor de $0.0015 por mensaje con el modelo actual. Cabe entero, y cuesta menos que una sola venta perdida por decirle a un cliente que no hay lo que sí hay.

## What Changes

- El auto-reply y el borrador reciben en cada respuesta un **índice compacto del inventario disponible completo**: referencia pública, marca, modelo, año, precio, kilometraje, transmisión y tipo de carrocería, una línea por vehículo.
- El bot filtra sobre ese índice con cualquier criterio, en vez de depender de que la recuperación semántica acierte.
- La búsqueda semántica **se conserva** para lo que hace bien: traer la ficha detallada —color, cilindraje, placa, características, enlace con fotos— del vehículo concreto del que se está hablando.
- El prompt gana una regla explícita: ese índice es el inventario completo, y no se afirma que algo no existe sin haberlo mirado.
- Salvaguarda de escala: por encima de un tope de vehículos el índice se recorta y el bot es informado de que está viendo una parte, para que no afirme inexistencia sobre un catálogo truncado.

## Capabilities

### New Capabilities

- `ai-inventory-context`: qué sabe el asistente del inventario en cada respuesta — el índice completo de lo disponible, cómo se compone, cuándo se recorta y qué se le dice al modelo sobre su alcance.

### Modified Capabilities

Ninguna. `ai-reply-gating` cubre cuándo responde el bot y no cambia; esto cambia con qué información responde.

## Impact

- Módulo nuevo que compone el índice desde `inventory_vehicles`, con caché en memoria para no consultar la base en cada mensaje entrante.
- `src/lib/ai/defaults.ts`: `buildSystemPrompt` recibe el índice y la regla que lo acompaña.
- `src/lib/ai/auto-reply.ts` y la ruta del borrador: cargan el índice antes de generar.
- Sin migración: se lee de `inventory_vehicles`, que ya existe.
- Sube el consumo de tokens de entrada por mensaje en ~2.000 con el inventario actual.
