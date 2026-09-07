## Context

El orden de `inventory_vehicles.images` ya es significativo en tres lugares del sistema, y en ninguno lo eligió una persona:

| Consumidor | Qué hace con el orden | Dónde |
|---|---|---|
| Composición de publicaciones | arma el carrusel y recorta a `maxImages` por el final | `src/lib/social/compose.ts:47` |
| Vitrina pública | `images[0]` es la portada del vehículo | `src/components/storefront/gallery.tsx` |
| Ficha de inventario | la grilla de miniaturas, con badge "principal" en la primera | `src/app/(dashboard)/inventory/page.tsx:1371` |

La cadena de escritura ya está completa y no hace falta tocarla:

```
  arrastrar y soltar
        │
        ▼
  PATCH /api/inventory/[id]  { images: [...orden nuevo] }
        │                      ← patch parcial, payload.ts:254
        ├──▶ inventory_vehicles.images        (orden canónico)
        │
        └──▶ syncVehiclePost()                (best-effort, ya existe)
                  │  syncNetworkPost() pisa image_urls siempre — queue.ts:213
                  ├──▶ social_posts (instagram).image_urls
                  └──▶ social_posts (facebook).image_urls
                            │
                            ▼
                   lo que sale publicado
```

Ese `image_urls` sobreescrito incondicionalmente es, en este diseño, una **ventaja**: es exactamente lo que hace que reordenar el vehículo se propague solo a las pendientes. En el diseño alternativo (orden por red) sería el primer obstáculo a remover.

Restricciones que enmarcan el trabajo:

- **`@dnd-kit` ya está en el proyecto** (`core`, `sortable`, `utilities`) y en uso en `src/components/pipelines/pipeline-settings.tsx` con `verticalListSortingStrategy`. No se introduce nada nuevo al stack.
- **`RATE_LIMITS.adminAction` = 30 peticiones/min por usuario** (`src/lib/rate-limit.ts:158`). Una petición por soltada agota el presupuesto acomodando una sola grilla.
- **`refreshPendingCaptions` corre en cada `GET /api/social/queue`** pero solo reescribe texto: no toca `image_urls`. No hay riesgo de que la pantalla de publicaciones pise un orden al recargarse.
- **136 vehículos ya cargados en producción**, ninguno con orden elegido.

## Goals / Non-Goals

**Goals:**

- Que una persona pueda decidir el orden de las fotos de un vehículo arrastrándolas, desde el inventario y desde la pantalla de publicaciones.
- Que ese orden sea el que sale publicado en Facebook e Instagram, sin un paso intermedio.
- Que reordenar funcione con el dedo y con el teclado, no solo con mouse.
- Que quede visible qué fotos quedan fuera del corte de 10 cuando el vehículo tiene más.
- Reutilizar el mismo componente en las dos pantallas, para que el gesto y las reglas no se bifurquen.

**Non-Goals:**

- Un orden distinto por red. Ver decisión 1.
- Tocar el esquema. Este change no lleva migración.
- Modificar publicaciones ya realizadas.
- Editar la imagen (recorte, rotación, filtros) ni ordenar automáticamente por calidad.
- Reordenar en lote varios vehículos.

## Decisions

### 1. Un solo orden, en el vehículo — no uno por publicación

El orden vive en `inventory_vehicles.images` y nada más. Arrastrar en cualquiera de las dos pantallas escribe ahí.

**Alternativa considerada: orden por fila de `social_posts`.** El repo ya tiene el patrón exacto para esto —`proposed_caption` (lo que armó el sistema) contra `edited_caption` (lo que escribió la persona, que `syncNetworkPost` nunca pisa)—, así que sería `image_urls` contra un `edited_image_urls` nuevo. Se descartó por tres costos concretos contra un beneficio que nadie pidió:

- una columna nueva y su migración;
- dejar de refrescar `image_urls` cuando hay override, lo que reintroduce el problema que ese refresco resuelve (un borrador con fotos que ya no existen);
- partir la tira de fotos de la cola, que hoy es **una por vehículo** (`source.image_urls`, `instagram/page.tsx:477`) aunque debajo haya dos filas de red, en **una por red**.

El beneficio sería poder ordenar distinto para Facebook que para Instagram. Ambas redes topan en 10 fotos (`MAX_CAROUSEL_ITEMS` = `MAX_ATTACHED_PHOTOS` = 10) y publican la misma ficha del mismo auto: no hay caso de negocio a la vista. Si aparece, el patrón está inventado y este diseño no lo estorba — se agrega la columna y el override gana sobre el vehículo.

### 2. Reordenar desde publicaciones escribe en el vehículo, no en la fila

Consecuencia directa de la decisión 1, pero conviene decirla porque es contraintuitiva: el botón está en la pantalla de publicaciones y la petición va a `/api/inventory/[id]`, no a `/api/social/queue/[id]`.

Es lo correcto: reordenar no es una edición de esta publicación, es una corrección sobre el vehículo que además arregla la publicación. Y `syncVehiclePost`, que ya se dispara ahí, propaga el orden a **todas** las pendientes del vehículo — que es justo lo que pide el spec.

El efecto lateral —cambia también la portada en la vitrina pública— **se declara en la interfaz** antes de guardar. No se esconde ni se evita.

### 3. Un solo componente ordenable, usado por las dos pantallas

`src/components/inventory/vehicle-photo-order.tsx` (nombre tentativo): recibe `images: string[]`, `onChange`, y banderas para lo que difiere entre las dos pantallas — si permite eliminar (inventario sí, publicaciones no), si es de solo lectura, y cuál es el corte a señalar.

**Alternativa considerada: implementarlo dos veces.** Es menos código de golpe y garantiza que en seis meses el gesto se comporte distinto en cada pantalla. El spec dice explícitamente "el mismo comportamiento en ambas"; un componente compartido es la forma barata de que eso siga siendo cierto.

`rectSortingStrategy` en vez de la vertical de `pipeline-settings.tsx`: acá la grilla envuelve en varias filas.

### 4. Guardado explícito en publicaciones; implícito en inventario

**En inventario no hay nada que decidir:** el diálogo ya acumula en `draft.images` y guarda todo al enviar. Arrastrar solo toca estado local. Cero peticiones extra, cero riesgo de rate limit.

**En publicaciones no hay diálogo**, y hay que elegir cuándo se persiste. Se opta por un **botón de guardar propio de la tira de fotos**, visible solo cuando hay cambios sin guardar.

**Alternativa considerada: guardado automático con debounce.** Menos fricción, pero: (a) con 30 peticiones/min por usuario, un debounce mal calibrado en una grilla de quince fotos es un `429` esperando; (b) un guardado que se dispara solo no tiene dónde poner la advertencia sobre la vitrina pública de la decisión 2; (c) el editor de texto que está en **la misma tarjeta** ya usa `dirty` + botón de guardar (`saveCaption`, `instagram/page.tsx:365`). Un guardado automático al lado de un guardado manual, sobre la misma tarjeta, es peor que dos botones.

Dos botones de guardar en una tarjeta no es ideal. Se mitiga con etiquetas que digan qué guarda cada uno ("Guardar texto" / "Guardar orden"), y el de orden solo aparece cuando el orden cambió. La opción de un botón único que guarde ambos se descartó: son dos recursos distintos, en dos endpoints distintos, y un fallo parcial dejaría a la persona sin saber qué se guardó.

### 5. Se arrastra desde toda la miniatura; los botones frenan el evento

**Revisada tras probar la primera versión.** El diseño original ponía un asa de arrastre dedicada y solo desde ahí se arrastraba, para que un toque sobre la X no terminara arrastrando. Al usarlo, el asa resultó un blanco chico y poco natural: la expectativa es agarrar **la foto**.

Ahora `attributes` y `listeners` van sobre el contenedor de la miniatura entera, con `cursor-grab` / `active:cursor-grabbing` para que se vea que se agarra. El conflicto con los botones que van encima se resuelve donde nace: la X y "hacer portada" frenan `pointerdown` (y `keydown`) con `stopPropagation`, así que el sensor del contenedor nunca los ve. Siguen valiendo los `activationConstraint` — `{ distance: 8 }` en puntero y `{ delay: 200, tolerance: 5 }` en táctil — como segunda línea.

La accesibilidad no se pierde con el asa: `attributes` aporta `role="button"` y `tabIndex`, así que la miniatura misma es el elemento que recibe el foco y activa el `KeyboardSensor`.

**Alternativa considerada: conservar el asa y además permitir el arrastre desde la foto.** Dos activadores para el mismo gesto, y un icono que ya no explica nada. Se quitó el asa.

### 6. El corte de 10 se señala, no se impone

Cuando el vehículo tiene más fotos que el máximo de alguna red conectada, la grilla marca visualmente dónde cae el corte: las que quedan afuera se atenúan (opacidad y escala de grises) y una nota debajo dice cuántas son y qué hacer al respecto.

Se descartó el separador dentro de la grilla: forzar un salto de línea en un `flex-wrap` cambia el alto del contenedor, y `rectSortingStrategy` mide rectángulos durante el arrastre — un separador que aparece y desaparece hace saltar la grilla justo mientras se arrastra sobre él.

No se impide subir más de 10, ni se ofrece eliminar las sobrantes. Sirven en la vitrina pública, que no tiene ese tope. Lo que hace falta es que quien ordena **sepa** qué está dejando afuera de las redes.

El máximo se toma de las redes conectadas que informa `GET /api/social/queue` (`stateOf(network).limits`). En la pantalla de inventario no hay ese dato a mano: ahí se usa el mínimo de los máximos conocidos del sistema, y si no hay ninguna red conectada no se señala corte alguno.

### 7. Designar portada, además de arrastrar

Un botón "hacer portada" en cada miniatura que no sea la primera, que la mueve al frente conservando el orden relativo del resto.

Arrastrar de la posición 15 a la 1 en una grilla que hace scroll es el caso más incómodo del gesto, y es exactamente el más frecuente: lo que la gente quiere casi siempre es cambiar la foto de portada. Es también la ruta accesible más simple para ese caso.

### 8. Teclado, por `KeyboardSensor` de `@dnd-kit`

`@dnd-kit` trae `KeyboardSensor` con `sortableKeyboardCoordinates` y anuncios ARIA, pero hay que conectarlo — `pipeline-settings.tsx` hoy no lo hace. Acá sí, con los anuncios en español a través de `next-intl`.

### 9. La cola ordena sobre la lista COMPLETA del vehículo, no sobre el carrusel

`GET /api/social/queue` devolvía del vehículo `id, brand, model, year, price, status` — todo menos `images`. La pantalla solo conocía `social_posts.image_urls`, que es el carrusel **ya recortado a 10**.

Como reordenar desde ahí guarda con `PATCH /api/inventory/[id] { images }`, y ese patch **reemplaza el arreglo entero**, ordenar un vehículo de quince fotos habría guardado diez y **borrado las otras cinco**. Es pérdida de datos silenciosa, y la descubrió la implementación, no el diseño.

Se agrega `images` al select del vehículo en `QUEUE_COLUMNS` y la tarjeta ordena sobre esa lista. Como efecto secundario bueno, es lo que vuelve útil el corte de la decisión 6 en esta pantalla: se ven las quince y se ve dónde caen las diez. Mostrar solo el carrusel recortado haría que el corte no tuviera nada que señalar.

### 10. Sin migración, sin retrocompatibilidad que resolver

Todo vehículo existente ya tiene un orden válido: el de subida. No hay estado "sin ordenar" que distinguir del estado "ordenado", y por lo tanto no hay dato nuevo, ni backfill, ni bandera. Los 136 vehículos de producción funcionan igual el día del despliegue y mejoran cuando alguien los toca.

## Risks / Trade-offs

- **Reordenar desde publicaciones cambia la vitrina pública** → Es intencional (decisión 1), pero puede sorprender. Se mitiga con una advertencia explícita en esa pantalla, junto al botón de guardar.
- **El arrastre táctil pelea con el scroll de la página** → `activationConstraint` en el `TouchSensor` (`delay: 200`), y los botones frenan el `pointerdown` (decisión 5). Sin el asa dedicada, este riesgo pesa más que en la versión original: **verificar en un teléfono real** antes de dar el change por cerrado. El caso principal es un vendedor con el celular, no un escritorio.
- **Dos botones de guardar en la tarjeta de la cola** → Etiquetas explícitas y el de orden visible solo cuando hay cambios (decisión 4). Es el costo aceptado de no acoplar dos recursos distintos.
- **`syncVehiclePost` es best-effort: si falla, el vehículo se guarda con el orden nuevo pero las pendientes conservan el viejo** → Es el comportamiento que ya tiene el sistema para el resto de los campos y no se cambia acá. El riesgo real es que la persona apruebe un carrusel con el orden anterior. Se mitiga recargando la cola después de guardar el orden: si la sincronización falló, la pantalla lo muestra con el orden viejo en vez de mentir.
- **Guardado explícito = orden que se pierde si se navega sin guardar** → El indicador de cambios sin guardar es obligatorio (spec). No se agrega bloqueo de navegación: el proyecto no lo usa en ninguna otra pantalla.
- **El orden guardado desde la cola incluye fotos que esa red no publica** → Es correcto: el orden es del vehículo, no del carrusel (decisión 9). La grilla lo hace visible atenuando lo que queda fuera del corte.
- **La grilla ordenable en el diálogo de inventario compite por espacio** → El diálogo ya es largo. Las miniaturas de 80px se mantienen; si hace falta, la grilla gana altura máxima con scroll propio.

## Migration Plan

No hay migración. Es un change de interfaz sobre datos existentes:

1. Se despliega junto con el resto de la aplicación; no hay orden de pasos ni ventana de mantenimiento.
2. Vehículos existentes: ninguno cambia. El orden de subida sigue siendo el orden, hasta que alguien lo cambie.
3. Rollback: revertir el despliegue. Los órdenes que se hayan guardado mientras tanto **persisten** y siguen siendo válidos — son solo arreglos de `images` como los que ya escribía el formulario.

## Open Questions

- **¿El botón de portada va también en la pantalla de publicaciones, o solo en inventario?** Inclinación: en las dos, es donde más se usa. Se resuelve al construirlo, mirando cuánto satura la tarjeta de la cola.
- **¿La advertencia sobre la vitrina pública es permanente o descartable?** Permanente al principio; si molesta, se convierte en texto de ayuda.
- **¿Conviene que el corte de 10 se señale también en el inventario?** Ahí no se conocen las redes conectadas sin una petición extra. La decisión 6 propone usar el mínimo de los máximos del sistema; verificar que no confunda cuando el negocio no publica en redes.
