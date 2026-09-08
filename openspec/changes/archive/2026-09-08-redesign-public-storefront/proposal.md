## Why

La vitrina pública es la única pantalla del sistema que ve un cliente que todavía no compró, y hoy tiene dos problemas que se refuerzan: **no se ve del negocio** y **no ayuda a encontrar el carro**.

- **No se ve del negocio.** El diseño actual salió de una plantilla de Stitch y quedó con su paleta intacta: azul Material `#0059bb`, grises `#f7f9fb` / `#191c1e` / `#c5c6cd`, Inter. El logo real de Lora Motors es negro y rojo, con tipografía condensada itálica. Un visitante que llega desde WhatsApp ve una página que no se parece a la marca que le escribió.
- **No ayuda a encontrar el carro.** Los filtros viven en una barra lateral pegajosa a `lg:top-24`, pero **en móvil están colapsados detrás de un botón y no son pegajosos**: hay que volver hasta arriba del todo para cambiar un filtro. No hay buscador por texto ni forma de ordenar, y con **128 vehículos publicados** el visitante recorre una grilla sin control sobre ella. La mayoría del tráfico llega por WhatsApp, es decir desde el teléfono, que es justo donde peor funciona.

Hay un tercer problema, más silencioso: **53 de los 128 vehículos no tienen ninguna foto**. Hoy esas tarjetas muestran un rectángulo gris con el texto "Sin foto" y compiten en desventaja con las demás, cuando en realidad son inventario vendible cuyo cliente potencial solo necesita pedir las fotos.

El rediseño ya se exploró y se aprobó como prototipo interactivo en el canvas de diseño: se compararon tres direcciones y se eligió combinar la identidad de marca con la mecánica de un marketplace, con los filtros fijos.

## What Changes

- **La vitrina toma la identidad del negocio.** Negro, blanco y un color de acento **por cuenta**, no una paleta fija en el código. Tipografía condensada para títulos y precios, bordes duros, bloques de color plano.
- **Los controles de búsqueda quedan fijos en pantalla**, en escritorio y en móvil: buscador por texto, filtros, conteo de resultados y orden acompañan al visitante durante todo el scroll. Deja de existir la barra lateral y deja de existir el estado "filtros escondidos arriba".
- **Se agrega buscar por texto** (marca, modelo o año) y **ordenar** (menor precio, mayor precio, menos kilometraje, año más reciente). Ninguna de las dos existe hoy.
- **El vehículo sin fotos deja de ser un hueco.** Muestra un bloque con la marca del negocio y su propia llamada a la acción: pedir las fotos por WhatsApp, con el código de referencia del vehículo.
- **La ficha del vehículo mantiene la acción de compra siempre visible**: en escritorio, el panel de precio y contacto queda fijo mientras sube la galería; en móvil, una barra inferior fija lleva el precio y el botón de WhatsApp. Además muestra el código de referencia y una fila de vehículos parecidos.
- **El filtro "Modelo" se reemplaza por el buscador de texto.** Un desplegable de modelos dependiente de la marca es más lento de usar que escribir "duster", y ocupa un espacio que en la barra fija es caro.
- **No se agregan atajos de un toque.** Se probaron —con fotos, automáticos, recién ingresados— y el negocio los descartó: con siete selectores a la vista, una segunda fila de filtros repetía criterios que los desplegables ya cubren.
- **Toda la copia nueva pasa por el catálogo de mensajes**, y de paso se corrigen las cadenas que hoy están escritas directamente en `storefront.tsx` ("Inventario Destacado", "Todas", "Todos", "Sin límite", "Limpiar", "Filtros", "No hay vehículos que coincidan con tu búsqueda", el subtítulo del hero).

**Qué NO cambia.** El origen de los datos (`getShowcase`, `getShowcaseVehicle`), los metadatos y el `og:image` generado, el JSON-LD de schema.org, el `sitemap`/`robots`, el bucket de imágenes, el panel de Ajustes → Public showcase salvo el campo nuevo, y la atribución por código de referencia, que se conserva y se extiende.

**Fuera de alcance**

- **Paginación o carga incremental de la grilla.** Hoy se pintan los 128 vehículos de una vez y eso no empeora con este change: el filtrado sigue siendo en cliente sobre datos ya cargados y `next/image` difiere lo que está debajo del pliegue. Si el inventario crece hasta que duela, es su propio change.
- **Filtrar por URL (enlaces compartibles del tipo `?marca=mazda`).** Es deseable para SEO y para que el asesor mande "míralos todos aquí", pero es un cambio de arquitectura de la página —hoy `page.tsx` es un server component y el estado vive en `Storefront`— y merece decidirse aparte.
- **Fotos reales, edición de imágenes o rellenar los 53 vehículos sin foto.** Es trabajo de contenido, no de código.
- **Rediseñar el CRM privado.** Este change toca solo lo público: `/`, `/vehiculo/[id]` y los componentes de `src/components/storefront/`.
- **Tema oscuro de la vitrina.** La vitrina siempre se ve igual, independiente del `data-mode` del CRM.
- **Página "Vender mi carro".** El prototipo muestra el botón porque la barra lo pedía visualmente; la página detrás no existe y no se crea acá.

## Capabilities

### New Capabilities

- `storefront-discovery`: cómo un visitante encuentra un vehículo en la vitrina — qué controles hay, cuáles permanecen accesibles durante todo el recorrido, cómo se le informa cuántos resultados quedan y qué ve cuando no queda ninguno.
- `storefront-brand-identity`: cómo la vitrina se presenta como el negocio y no como el producto — de dónde sale el color de marca, qué se muestra cuando un vehículo no tiene fotos, y qué coherencia deben guardar la portada y la ficha.
- `storefront-vehicle-detail`: qué garantiza la ficha de un vehículo — que la acción de contacto y el precio nunca se pierdan de vista, qué muestra la galería, y cómo se ofrece seguir buscando sin volver atrás.

### Modified Capabilities

- `vehicle-lead-attribution`: hoy la especificación cubre el CTA de consulta ("me interesa") y la prueba de manejo. Se agrega el CTA de **pedir fotos**, que es el único disponible en 53 vehículos y que hasta ahora no existía: también debe llevar el código de referencia, o esas consultas llegan sin atribuir.

## Impact

**Código**

- `src/components/storefront/storefront.tsx` — reescritura: barra fija, buscador, orden, tarjetas nuevas, estado vacío.
- `src/components/storefront/store-nav.tsx` — se integra a la barra fija; deja de ser un `header` independiente en la portada, pero sigue sirviendo a la ficha.
- `src/components/storefront/gallery.tsx` — miniaturas y contador; versión móvil con puntos.
- `src/app/vehiculo/[id]/page.tsx` — panel de compra fijo, referencia visible, vehículos parecidos.
- `src/app/page.tsx` — desaparece el hero: ni foto del inventario ni banda de marca. La portada abre en la cabecera fija.
- `src/components/storefront/footer.tsx`, `share-vehicle-button.tsx` — ajuste de paleta.
- `src/lib/showcase/format.ts` — helper del mensaje de "pedir fotos" (junto a `whatsappHref`).

**Datos**

- Migración `518_showcase_brand_color.sql`: `accounts.public_brand_color TEXT`. Nullable, con respaldo al color actual si viene vacío. Se expone en Ajustes → Public showcase y viaja en `ShowcaseAccount`.

**Traducciones**

- `messages/es.json`, `messages/en.json`, `messages/ko.json` — namespace `Storefront`: claves nuevas y las que hoy están escritas en el código.

**Sin impacto**

- API pública (`/api/v1`), webhooks de WhatsApp, automatizaciones, publicación en Instagram/Facebook. La vitrina lee; no escribe nada.
