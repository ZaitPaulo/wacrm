## Why

Hoy el orden de las fotos de un vehículo es **el orden en que se subieron**, y nadie lo eligió. Eso importa más de lo que parece:

- **Instagram recorta todo el carrusel según la primera foto.** Ya está escrito en `src/lib/social/compose.ts:40`: la primera manda sobre las nueve siguientes.
- **La vitrina pública usa `images[0]` como portada** del vehículo, en el catálogo y en el detalle (`src/components/storefront/gallery.tsx`).
- **Ambas redes topan en 10 fotos y las que sobran se descartan por el final** (`MAX_CAROUSEL_ITEMS`, `MAX_ATTACHED_PHOTOS`). Un vehículo con 15 fotos publica las 10 que se subieron primero — no las 10 mejores. El orden no decide solo la secuencia: decide **cuáles fotos existen** para el público.

La única forma que tiene hoy un vendedor de cambiar ese orden es borrar todas las fotos y volver a subirlas en la secuencia deseada. Con los 136 vehículos que ya están cargados en producción, eso no va a pasar: el resultado real es que se publica lo que quedó.

El momento es ahora porque la infraestructura ya está: `@dnd-kit` está instalado y en uso (`src/components/pipelines/pipeline-settings.tsx`), el orden ya es la fuente de verdad en `inventory_vehicles.images`, y `PATCH /api/inventory/[id]` ya acepta `{ images }` como patch parcial y re-sincroniza las publicaciones pendientes. Falta el gesto, no la plomería.

## What Changes

- **Se puede arrastrar y soltar las fotos de un vehículo para ordenarlas**, en la grilla de imágenes del formulario de inventario (`/inventory`).
- **El mismo arrastre está disponible en la ventana de publicaciones** (`/instagram`), sobre la tira de fotos de cada vehículo con publicaciones pendientes.
- **Hay un solo orden, y vive en el vehículo.** Arrastrar en cualquiera de las dos pantallas escribe en `inventory_vehicles.images`. No existe un orden "para Facebook" distinto del orden "para Instagram".
- **Ese orden es el que sale publicado.** Reordenar desde la ventana de publicaciones refresca el `image_urls` congelado de las pendientes, de modo que lo que se aprueba es lo que se vio.
- **Ese orden también manda en la vitrina pública.** La primera foto pasa a ser la portada del vehículo en el catálogo y en el detalle. Es consecuencia directa de que haya un solo orden, y es deseada.
- **Se puede designar la portada de un clic**, sin arrastrar hasta el primer lugar. En una grilla de quince miniaturas, arrastrar de la última a la primera posición es incómodo justo en el caso que más importa.
- **Solo se reordena lo que todavía no salió.** En la ventana de publicaciones, un vehículo cuyas publicaciones ya salieron muestra sus fotos en modo lectura: el sistema no toca lo publicado.

**Por qué un solo orden y no uno por red.** La alternativa era guardar un orden propio en cada fila de `social_posts`, calcado del par `proposed_caption` / `edited_caption`. Se descartó: exige una columna nueva, obliga a dejar de refrescar `image_urls` en `syncNetworkPost`, y parte la tira de fotos de la cola en una por red — hoy es una sola por vehículo. Todo eso para resolver un problema que nadie tiene: nadie pidió que el Corolla salga con el motor primero en Facebook y con el tablero primero en Instagram. Si algún día se pide, el patrón ya está inventado en el repo y este change no lo estorba.

**Por qué el arrastre en la ventana de publicaciones no es redundante.** Escribe en el mismo lugar que el de inventario, sí, pero el momento es otro: revisar el borrador es exactamente cuando alguien mira las diez fotos juntas y piensa "esta no debería ir primera". Mandarlo a otra pantalla para arreglarlo es la clase de fricción que hace que no se arregle.

**Qué queda igual.** No cambia el esquema, ni el encolado, ni la aprobación, ni la publicación, ni la conversión de formatos, ni la cuota. Ninguna migración. Este change es de interfaz y de una regla de negocio que hasta hoy estaba implícita.

**Fuera de alcance**

- **Orden por red.** Ver arriba.
- **Reordenar publicaciones ya publicadas.** El sistema nunca modifica lo que ya salió a Meta.
- **Editar la foto** (recortar, rotar, filtros). Otro problema.
- **Ordenar automáticamente** por calidad, encuadre o detección de partes del vehículo. Interesante, y no es esto.
- **Reordenar en lote** varios vehículos a la vez.

## Capabilities

### New Capabilities
- `vehicle-photo-ordering`: el orden de las fotos de un vehículo como dato explícito del negocio — quién lo define, desde dónde se edita, qué lo consume y qué pasa con las fotos que exceden el máximo de una red.

### Modified Capabilities
- `vehicle-post-composition`: el requisito hoy dice que el carrusel va "en el orden en que están cargadas". Pasa a ser el orden que **definió el usuario**, y el descarte de las fotos sobrantes deja de ser un efecto del orden de subida para ser una decisión deliberada de quien ordenó.

> `vehicle-post-composition` vive hoy como delta de `add-instagram-publishing` y `add-facebook-publishing`, ninguno archivado (`openspec/specs/` todavía no la tiene). Este change escribe su delta contra esa base; al archivar, el orden es Instagram → Facebook → este.

## Impact

**Base de datos**
- Ninguna. `inventory_vehicles.images` ya es `TEXT[]` y su orden ya es significativo.

**API**
- Ninguna ruta nueva. `PATCH /api/inventory/[id]` ya acepta `{ images: string[] }` como patch parcial (`src/lib/inventory/payload.ts:254`) y ya dispara `syncVehiclePost`, que refresca el `image_urls` de las pendientes (`src/lib/social/queue.ts:213`).
- A vigilar: `RATE_LIMITS.adminAction` es de 30/min por usuario. Reordenar quince fotos de a una soltada por petición lo agota; el guardado no puede ser una petición por arrastre.

**Código**
- `src/app/(dashboard)/inventory/page.tsx` — la grilla de imágenes (líneas ~1369-1416) pasa a ser una lista ordenable; se agrega la acción de portada y se resuelve la convivencia entre arrastrar y el botón de eliminar, que hoy está encima de la miniatura.
- `src/app/(dashboard)/instagram/page.tsx` — la tira de fotos del grupo de vehículo (líneas ~518-535) pasa a ser ordenable y ganar guardado propio, habilitada solo cuando el vehículo tiene pendientes.
- Componente compartido nuevo para la grilla ordenable de fotos: las dos pantallas usan el mismo gesto y las mismas reglas, y duplicarlo garantiza que se separen.
- Mensajes nuevos en `messages/` para ambos namespaces (`Inventory`, `SocialQueue`).

**Dependencias**
- Ninguna nueva. `@dnd-kit/core`, `@dnd-kit/sortable` y `@dnd-kit/utilities` ya están en `package.json` y en uso en `src/components/pipelines/`.

**Riesgos**
- **Táctil.** El caso principal es un vendedor con el celular. Un `PointerSensor` sin restricción de activación pelea con el scroll de la página en una grilla de miniaturas.
- **Accesibilidad.** `@dnd-kit` trae soporte de teclado, pero hay que conectarlo: reordenar no puede quedar disponible solo con mouse.
- **Efecto en la vitrina.** Reordenar desde la ventana de publicaciones cambia la portada pública del vehículo. Es intencional, y la interfaz tiene que decirlo para que no sea una sorpresa.
