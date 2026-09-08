## Context

El bot conoce el inventario por RAG: `knowledge-sync.ts` escribe un documento por vehículo disponible y `retrieveKnowledge` devuelve `k = 5` extractos por similitud, semánticos si la cuenta tiene embeddings key y léxicos si no.

Eso funciona para "cuéntame del Sandero" y falla para "quiero algo de 25 millones", porque la similitud vectorial no ordena magnitudes. Con 123 vehículos disponibles, el modelo ve el 4% del catálogo y no tiene forma de saber que existe el 96% restante — así que cuando dice "no queda nada en ese presupuesto" no está mintiendo, está informando sobre lo único que le mostraron.

Medición real del inventario de LoraMotors: 123 vehículos disponibles, 7.049 caracteres como índice de una línea por vehículo, ~2.000 tokens.

## Goals / Non-Goals

**Goals:**

- Que el modelo pueda responder sobre CUALQUIER criterio del inventario, no solo los que la similitud acierta.
- Que nunca afirme que algo no existe cuando sí está disponible.
- Que el detalle rico de un vehículo concreto se siga sirviendo por el RAG que ya funciona.

**Non-Goals:**

- Tool calling / function calling. Sería lo canónico, pero exige un bucle de herramientas y varios turnos por respuesta sobre una capa OpenAI-compatible de un solo turno. El catálogo entero cabe en el contexto y hace innecesaria toda esa maquinaria hoy.
- Extraer criterios del mensaje con una llamada previa al modelo. Es una llamada extra, una fuente de error extra, y solo para reproducir un filtro que el modelo puede hacer mirando la lista.
- Quitar la sincronización de inventario al knowledge base. Sigue siendo lo que da el detalle y el enlace a la ficha.
- Paginar o buscar dentro del índice. Mientras quepa completo, no hace falta.

## Decisions

### El índice va en el system prompt, no como extracto más

Los extractos del knowledge base llegan con la etiqueta de "referencia recuperada para esta pregunta". El índice es otra cosa: es el estado del inventario, y su valor está justamente en ser exhaustivo. Va en su propio bloque, con su propia frase declarando que es la lista completa.

### Una línea por vehículo, con las columnas que se filtran

`XGCW8S RENAULT SANDERO GT 2010 $22M 179k manual hatchback`

Precio en millones abreviado y kilometraje en miles: son las dos columnas que se leen para comparar, y en formato largo triplican el tamaño del índice sin añadir precisión útil para elegir. El precio exacto para decírselo al cliente sale del extracto del RAG, y el prompt ya obliga a la cifra completa la primera vez que se nombra un carro.

La referencia pública va primera porque es lo que permite al modelo cruzar una línea del índice con el extracto detallado del mismo vehículo.

### Tope de 400 vehículos

Con el formato medido, 400 son unos 23.000 caracteres (~6.500 tokens): sigue siendo cómodo y deja margen para que LoraMotors triplique su inventario sin tocar nada.

Pasado el tope se recorta y **se le dice al modelo que la lista está incompleta**, lo que le retira el permiso de afirmar inexistencia. Un índice truncado que se presenta como completo sería peor que el problema actual: hoy el bot no sabe lo que no vio, y así creería saberlo.

### Caché en memoria por cuenta, 60 segundos

El inventario cambia pocas veces al día; los mensajes llegan en ráfagas. Un caché corto por `account_id` evita 123 filas por cada mensaje de una ráfaga y, al ser tan corto, un vehículo vendido desaparece del índice en menos de un minuto.

Se descartó invalidar el caché desde las escrituras de inventario: acopla el módulo de inventario al de IA para ahorrar una consulta barata.

El caché vive en el proceso, como `checkRateLimit`, que ya usa ese patrón en este mismo camino.

### El precio ordena el índice

Ascendente. Es el criterio más frecuente en la conversación real y hace que "lo más barato que tienes" sea la primera línea, que es donde el modelo mira con menos esfuerzo.

## Risks / Trade-offs

- **~2.000 tokens más por mensaje** → ~$0.0015 con Flash. Frente a perder una venta por negar un carro que existe, no hay comparación.
- **Más contexto puede diluir la atención del modelo** → el índice va en un bloque propio y rotulado, no mezclado con la conversación; y sustituye a nada, así que lo que ya funcionaba sigue igual.
- **El caché puede servir un vehículo recién vendido** → hasta 60 segundos. El prompt ya obliga a coordinar la visita con un asesor antes de prometer nada, y la ficha del RAG es la fuente para el detalle.
- **Un inventario que crezca mucho** → el tope lo cubre, y avisar de la lista incompleta mantiene la honestidad del bot aunque el índice deje de ser exhaustivo.

## Migration Plan

1. Sin migración de base de datos.
2. Desplegar. El efecto es inmediato en la siguiente conversación.
3. Rollback: revertir el despliegue. El RAG queda como estaba.

## Open Questions

- ¿Debería el índice incluir también los vehículos reservados, marcados como tales? Hoy solo entran los disponibles, igual que en la sincronización al knowledge base.
- Si el inventario crece por encima del tope, ¿conviene entonces sí extraer criterios y filtrar por SQL antes de armar el índice? Sería el momento de reconsiderar el tool calling que aquí se descarta.
