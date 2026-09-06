## Context

La vitrina pública (`/` y `/vehiculo/[id]`) se construyó como réplica de un handoff de Stitch —el comentario de cabecera de `storefront.tsx` lo dice literal: *"Réplica del diseño Loramotors Storefront (Stitch)"*— y arrastra la paleta de esa plantilla: `#0059bb` como primario, `#f7f9fb` de fondo, `#191c1e` de texto, `#c5c6cd` de bordes, e Inter del layout raíz. Ninguno de esos valores viene de la marca del negocio, que es negra y roja.

**Estado actual, en concreto:**

- `src/app/page.tsx` (server) llama a `getShowcase()` y pasa `vehicles`, `whatsapp`, `heroImage`, `currency`, `baseUrl` a `<Storefront>`.
- `src/components/storefront/storefront.tsx` (client, 490 líneas) tiene ocho `useState` de filtro, deriva las opciones del inventario con `presentOptions`, calcula tramos de presupuesto con `niceBudgetTiers`, y pinta hero + `aside` de filtros + grilla. El `aside` es `lg:sticky lg:top-24 lg:block` y `hidden` en móvil detrás de un botón que no es pegajoso.
- `getShowcase()` ya trae los vehículos ordenados por `created_at` descendente, pero no selecciona esa columna.
- `accounts` tiene `public_name`, `public_logo_url`, `public_address`, `public_phone`, `public_email`, `public_hours`, `public_whatsapp` (migración 505). **No tiene color de marca.**
- El layout raíz carga Inter, aplica `data-theme`/`data-mode` en `<html>` y corre un script de arranque que lee la preferencia del CRM de `localStorage` antes del primer pintado.

**Restricciones que este diseño no puede romper:**

- `spanish-locale` exige que ningún componente lleve cadenas visibles escritas en el código. `storefront.tsx` hoy la incumple en una docena de sitios; el rediseño no puede sumar más.
- `vehicle-lead-attribution` exige que el CTA lleve el código de referencia. Se conserva y se extiende al CTA nuevo.
- La vitrina es **multi-cuenta**: cualquier cuenta con `showcase_enabled` la sirve. Nada de la marca puede quedar escrito en el código.
- El proyecto no usa Server Actions ni patrones que no estén ya en el repo.

**Referencia visual:** el prototipo interactivo aprobado —vitrina y ficha, escritorio y teléfono, con los filtros fijos y los controles funcionando— está en https://claude.ai/code/artifact/319dbdcf-9283-49e7-8d7e-b087a85cb267 (página "Prototipo"; las tres direcciones que se compararon quedaron en la página "Bocetos"). Los datos de ese prototipo son de muestra.

## Goals / Non-Goals

**Goals:**

- Que los controles de búsqueda acompañen al visitante durante todo el recorrido, en escritorio y sobre todo en teléfono, que es de donde llega la mayoría del tráfico.
- Que la vitrina se vea del negocio, con el color de marca como dato de la cuenta y no como constante del código.
- Que los 53 vehículos sin fotos dejen de ser tarjetas rotas y pasen a ser inventario con su propia llamada a la acción, atribuible.
- Que el precio y el botón de contacto no se pierdan de vista en la ficha.
- Dejar la vitrina en cumplimiento de `spanish-locale`, en vez de sumar cadenas nuevas al incumplimiento.

**Non-Goals:**

- Mover el estado de búsqueda a la URL. Cambiaría la arquitectura de la página y merece su propio change (ver Decisión 3).
- Paginar o cargar la grilla por tramos. Hoy se pintan los 128 y este change no lo empeora.
- Tocar el CRM privado, su tema o su tipografía.
- Cualquier trabajo de contenido: fotos, textos comerciales definitivos, datos de contacto reales.

## Decisions

### 1. Un solo bloque anclado con tres filas, en lugar de la barra lateral

La barra lateral desaparece. En su lugar, un único contenedor `position: sticky; top: 0` que agrupa tres filas: **(a)** marca y buscador, **(b)** los selectores de filtro, **(c)** atajos, conteo y orden. En escritorio el bloque mide ~158 px; en teléfono las filas se reorganizan y los selectores se mueven a un panel que se despliega desde la misma barra anclada.

*Por qué no la barra lateral pegajosa de hoy:* funciona en escritorio y no funciona en teléfono, que es el caso mayoritario. Arreglarla en móvil significaría de todos modos convertirla en una barra o en un panel; hacerlo en los dos anchos con la misma estructura es menos código y una sola cosa que mantener.

*Por qué no un panel modal a pantalla completa en móvil:* saca al visitante de los resultados y le hace perder la posición de scroll. El panel desplegable desde la barra mantiene la lista debajo y el conteo a la vista mientras se elige.

*Por qué tres filas y no dos:* meter los atajos y el orden en la fila de selectores obliga a recortar filtros. Las tres filas caben en 1280 px y el bloque anclado sigue siendo menos del 18 % de una ventana de 900 px.

*Riesgo asumido:* 158 px anclados es bastante altura. Se compensa quitando el hero de `55vh` que hay hoy: la banda de marca nueva es de altura fija y modesta, y se pasa por alto con un scroll.

### 2. El estado de búsqueda sigue en el cliente, dentro de un solo componente

`Storefront` mantiene su estado local y el filtrado sigue siendo en memoria sobre `vehicles`, que ya llegan completos del server component. Se agregan al estado `q` (texto), `sort` y los tres atajos.

*Por qué no mover el filtrado al servidor:* los datos ya vienen enteros y son 128 filas; una ida al servidor por cada tecla del buscador sería más lento y más caro que filtrar en memoria.

*Por qué un solo componente y no varios con contexto:* el estado es plano y lo consume un solo árbol. Un contexto aquí sería ceremonia.

### 3. La búsqueda NO va a la URL en este change

Tentador —enlaces compartibles, SEO de "camionetas en Montería", el asesor mandando un filtro por WhatsApp— pero implica convertir `page.tsx` en una página que lee `searchParams`, decidir qué se filtra en servidor y qué en cliente, y qué pasa con `dynamic = 'force-dynamic'` y el `cache()` de `getShowcase`. Es un cambio de arquitectura, no un detalle del rediseño, y mezclarlo aquí haría imposible revisar ninguno de los dos.

*Qué se deja preparado:* el estado de búsqueda queda en un único objeto plano dentro de `Storefront`, con una función que lo serializa a un `Record<string, string>`. Pasar eso a `useSearchParams` después es mecánico.

### 4. El color de marca es una columna de `accounts`, no una constante

Migración `518_showcase_brand_color.sql`: `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS public_brand_color TEXT`. Se agrega a `ACCOUNT_COLUMNS` en `src/lib/showcase/data.ts`, a `ShowcaseAccount` en `format.ts`, y al panel de Ajustes → Public showcase.

*Por qué una columna y no una constante:* la vitrina es multi-cuenta. Escribir el rojo de Lora Motors en el código haría que la próxima cuenta que active `showcase_enabled` se viera de Lora Motors.

*Por qué no derivar el color del logo:* extraer el color dominante de un JPEG en tiempo de render es caro, frágil (el logo de Lora Motors tiene el fondo blanco horneado, como ya documenta el comentario de `footer.tsx`) y da resultados impredecibles. Un campo que el negocio elige es más barato y más correcto.

*Validación:* el valor se sanea antes de usarse contra `/^#[0-9a-fA-F]{6}$/`. Ausente o inválido resuelve a la constante de respaldo, en un único helper (`resolveBrandColor`) junto a `formatPrice` en `format.ts`. La vitrina nunca deja de pintar por un color mal guardado.

### 5. El color llega al CSS como variable, no como clase de Tailwind

Tailwind genera clases en tiempo de compilación: `bg-[${color}]` con un valor de runtime no existe. El contenedor raíz de la vitrina fija la variable en un `style` inline —`style={{ '--brand': brandColor }}`— y los componentes la usan con valores arbitrarios estáticos (`bg-(--brand)`, `text-(--brand)`, `border-(--brand)`), que Tailwind sí puede generar porque la clase es literal.

*Alternativa descartada:* una hoja de estilos por cuenta o un `<style>` inyectado con reglas generadas. Más superficie, mismo resultado.

### 6. La vitrina no participa del theming del CRM

El layout raíz seguirá poniendo `data-theme` y `data-mode` en `<html>` —no se puede quitar sin tocar el CRM— pero la vitrina no usará ningún token de `globals.css` (`bg-background`, `text-foreground`, `bg-card`, …). Sus superficies se declaran con sus propios valores en el contenedor de la vitrina.

*Consecuencia a respetar en la implementación:* ningún componente de `src/components/storefront/` puede usar clases de token del CRM. Si aparece una, el modo oscuro del CRM se filtra a la página pública de un cliente.

### 7. Las fuentes de marca se cargan en un layout propio, no en el raíz

`/` y `/vehiculo/[id]` se mueven a un grupo de rutas `src/app/(storefront)/`, con su propio `layout.tsx` que carga Barlow y Barlow Condensed con `next/font/google` y fija las variables de la vitrina. Las URLs no cambian: los grupos entre paréntesis no aparecen en la ruta.

*Por qué no declararlas en el layout raíz:* el layout raíz sirve también al CRM, y `next/font` emite el preload donde se declara. El CRM pagaría dos familias que no usa en ninguna pantalla.

*Qué se mueve con ellas:* `loading.tsx`, `opengraph-image.tsx` y `vehiculo/[id]/*` acompañan a sus páginas. `robots.ts`, `sitemap.ts` e `icon.png` se quedan en la raíz, que es donde Next los espera.

### 8. "Recién ingresado" son los N más nuevos, no una ventana de días

`getShowcase()` ya ordena por `created_at` descendente; solo falta seleccionar la columna. El atajo marca los **12 más recientes**.

*Por qué no "ingresados en los últimos 30 días":* el inventario real entró en una sola carga masiva el 2026-08-26. Una ventana temporal marcaría los 128 vehículos a la vez, o ninguno, según el día — el atajo no significaría nada. Un tope fijo siempre significa lo mismo, sin importar cómo entró el inventario.

*No confundir con `condition = 'new'`:* eso es un vehículo nuevo de agencia, y es otra etiqueta con otro texto. La tarjeta puede llevar las dos y no son sinónimos.

### 9. El filtro de modelo se reemplaza por el buscador de texto

Hoy `models` se recalcula según la marca elegida y `setBrand` limpia `model`. Todo eso desaparece. Escribir "duster" es más rápido que abrir marca, elegir Renault y luego abrir modelo — y en la barra anclada, un selector menos es espacio que vale.

*Qué se pierde:* el visitante ya no ve la lista de modelos disponibles sin escribir. Se compensa con los atajos y con que el buscador acepta coincidencias parciales.

### 10. "Vehículos parecidos" sale de una consulta acotada, no del inventario completo

`getShowcaseVehicle` pasa a devolver además hasta 3 vehículos parecidos: misma `body_type`, misma cuenta, `status = 'available'`, excluyendo el id actual, ordenados por cercanía de precio. Es una consulta más sobre la misma tabla y los mismos filtros que ya usa.

*Por qué no reutilizar `getShowcase()` y filtrar en cliente:* traería los 128 vehículos a una página que necesita tres, en cada ficha.

*Si no hay ninguno,* la sección no se pinta (lo exige la spec), no se rellena con "los más recientes": un cupé al lado de tres camionetas no es una sugerencia, es relleno.

### 11. El mensaje de "pedir fotos" vive junto a `whatsappHref`

Se agrega `requestPhotosHref(number, vehicle)` en `src/lib/showcase/format.ts`, hermana de `whatsappHref` y con la misma regla: el texto se lee natural y `formatRefTag` va al final. Ponerla en el mismo módulo es lo que garantiza que las dos evolucionen juntas — el módulo `public-ref.ts` ya documenta que el formato del tag es contrato compartido con el webhook.

### 12. El hero deja de usar la foto del primer vehículo

Hoy `page.tsx` calcula `heroImage` con `vehicles.find(v => v.images?.[0])` y lo pinta a `100vw` con `priority`. Eso hace que el LCP de la portada sea una foto de WhatsApp de un vehículo cualquiera, elegido por orden de inserción. La banda de marca nueva es texto sobre color plano.

*Beneficio medible:* desaparece una imagen `priority` a ancho completo del camino crítico.

## Risks / Trade-offs

- **[El bloque anclado come 158 px de alto en escritorio y más en móvil]** → Se compensa eliminando el hero de `55vh`. En móvil las filas se compactan y el panel de filtros solo ocupa alto mientras está abierto. Verificar en un teléfono real de 667 px de alto antes de dar por buena la implementación.
- **[`position: sticky` se rompe si un ancestro tiene `overflow` distinto de `visible`]** → El árbol entre `<body>` y la barra es corto y está bajo control (`layout.tsx` → `(storefront)/layout.tsx` → `page.tsx`). Hay que revisar que ninguno introduzca `overflow-hidden`, un error fácil de cometer y silencioso.
- **[Mover páginas a un grupo de rutas puede romper enlaces o metadatos]** → Los grupos no cambian la URL, pero sí cambian qué layout aplica. Comprobar después del movimiento: `/` y `/vehiculo/<id>` responden, el `og:image` generado sigue saliendo, `sitemap.xml` y `robots.txt` no cambian, y el `metadataBase` sigue resolviendo absoluto.
- **[Una cuenta elige un color de marca ilegible sobre blanco, o casi blanco]** → El saneo valida el formato, no el contraste. Se acota poniendo el color solo en superficies donde va texto blanco encima y usando negro para el texto principal; aun así, un amarillo dará un botón feo. Se acepta: es la decisión del negocio sobre su marca, y el respaldo cubre el caso de no elegir.
- **[La reescritura de `storefront.tsx` puede perder comportamiento que hoy funciona]** → Lo que debe sobrevivir está identificado: `presentOptions`, `niceBudgetTiers`, el enlace que cubre la tarjeta con su `aria-label`, el botón de WhatsApp por encima con `z-20`, `formatPrice` con la moneda de la cuenta, y el JSON-LD de `page.tsx`, que no se toca.
- **[Sumar dos familias tipográficas empeora el arranque de la vitrina]** → Se cargan solo en el grupo de rutas público, con `display: swap`, y se limitan a los pesos que se usan (Barlow 400/500/600/700; Barlow Condensed 600/700/800 itálica).
- **[La columna nueva se despliega en un VPS con datos reales]** → `ADD COLUMN IF NOT EXISTS` sobre una columna nullable no bloquea ni reescribe la tabla. Sin ella, la vitrina usa el color de respaldo, así que el código nuevo funciona antes de aplicar la migración.

## Migration Plan

1. **Migración `518_showcase_brand_color.sql`** — aditiva y nullable. Se puede aplicar antes o después del despliegue del código: sin la columna, `resolveBrandColor` devuelve el respaldo.
2. **Traducciones primero.** Las claves nuevas del namespace `Storefront` en `es.json`, `en.json` y `ko.json`, antes de tocar los componentes, para que ninguna cadena nueva nazca escrita en el código.
3. **Grupo de rutas y layout público**, con las fuentes y los tokens, verificando que `/` y `/vehiculo/[id]` siguen respondiendo y que el `og:image` sale.
4. **La vitrina**, luego **la ficha**. Son pantallas independientes y se pueden revisar por separado.
5. **El campo de color en Ajustes**, al final: hasta que exista, la vitrina ya se ve bien con el respaldo.
6. **Vuelta atrás:** el change es todo front salvo una columna nullable que nadie más lee. Revertir el despliegue devuelve la vitrina anterior sin tocar datos; la columna puede quedarse sin usar.

## Open Questions

- **¿Qué color exacto configura Lora Motors?** El prototipo usa `#e21b22`, tomado a ojo del logo. Antes de cargarlo en producción conviene confirmarlo con el negocio o muestrearlo del archivo original.
- **¿"Vender mi carro" lleva a algún lado?** El botón aparece en el prototipo porque la barra lo pedía. Si no hay página ni flujo detrás, se quita o se convierte en un enlace de WhatsApp con un mensaje propio. Decidir antes de implementar la barra.
- **¿El atajo "con fotos" debería venir encendido por defecto?** Escondería 53 vehículos vendibles de entrada, pero la primera pantalla se vería mucho mejor. Es una decisión comercial, no técnica.
- **¿Los tramos de precio y kilometraje siguen derivándose o se fijan?** `niceBudgetTiers` funciona y es agnóstico de la moneda; se conserva. Queda por decidir si los tramos de kilometraje, que hoy están fijos en el código (`10.000 / 30.000 / 50.000 / 100.000 / 200.000`), deberían derivarse igual.
