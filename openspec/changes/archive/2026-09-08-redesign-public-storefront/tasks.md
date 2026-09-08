## 1. Datos y contrato

- [x] 1.1 Crear `supabase/migrations/518_showcase_brand_color.sql` con `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS public_brand_color TEXT`, comentando por qué es nullable y por qué el código funciona sin ella
- [x] 1.2 Agregar `public_brand_color` a `ACCOUNT_COLUMNS` y `created_at` al `select` de vehículos en `src/lib/showcase/data.ts` — la mitad de `created_at` quedó sin efecto al retirarse 4.3; sigue usándose en el `.order()`, que no exige seleccionarlo
- [x] 1.3 Agregar `public_brand_color` a `ShowcaseAccount` y `created_at` a `ShowcaseVehicle` en `src/lib/showcase/format.ts` — `created_at` no se agregó, por lo mismo que 1.2
- [x] 1.4 Escribir `resolveBrandColor(value)` en `format.ts`: valida `/^#[0-9a-fA-F]{6}$/`, devuelve la constante de respaldo si falta o es inválido
- [x] 1.5 Escribir `requestPhotosHref(number, vehicle)` en `format.ts`, hermana de `whatsappHref`, con `formatRefTag` al final y sin código cuando el vehículo no lo tenga
- [x] 1.6 Cubrir `resolveBrandColor` y `requestPhotosHref` en `src/lib/showcase/format.test.ts`, incluyendo color ausente, color inválido, vehículo con `public_ref` y vehículo sin él
- [x] 1.7 Extender `getShowcaseVehicle` para devolver hasta 3 vehículos parecidos (misma `body_type`, misma cuenta, `status = 'available'`, excluyendo el id actual, por cercanía de precio) y devolver lista vacía cuando no haya

## 2. Traducciones

- [x] 2.1 Inventariar todas las cadenas visibles escritas hoy en el código de `src/components/storefront/` y `src/app/vehiculo/[id]/page.tsx`
- [x] 2.2 Agregar al namespace `Storefront` de `messages/es.json` las claves existentes que faltan y las nuevas: buscador, orden y sus cuatro opciones, los tres atajos, conteo de resultados, limpiar, contador de filtros activos, estado vacío, "sin fotos todavía", "pedir fotos", contador de galería, "vehículos parecidos", "volver al inventario", explicación del código de referencia
- [x] 2.3 Replicar las claves nuevas en `messages/en.json` y `messages/ko.json`
- [x] 2.4 Verificar que los tres archivos tienen exactamente el mismo conjunto de claves bajo `Storefront`

## 3. Grupo de rutas público y sistema visual

- [x] 3.1 Crear `src/app/(storefront)/` y mover a él `page.tsx`, `loading.tsx`, `opengraph-image.tsx` y `vehiculo/[id]/`, dejando `robots.ts`, `sitemap.ts` e `icon.png` en la raíz
- [x] 3.2 Crear `src/app/(storefront)/layout.tsx` que cargue Barlow (400/500/600/700) y Barlow Condensed (600/700/800 itálica) con `next/font/google` y `display: swap`
- [x] 3.3 Fijar en ese layout las variables de la vitrina, incluida `--brand` desde `resolveBrandColor(account.public_brand_color)`, y sus superficies propias, sin usar ningún token de `globals.css`
- [x] 3.4 Verificar que `/` y `/vehiculo/<id>` responden, que el `og:image` generado sigue saliendo absoluto, y que `sitemap.xml` y `robots.txt` no cambiaron

## 4. Vitrina: bloque de controles anclado

- [x] 4.1 Reescribir el estado de `Storefront` como un único objeto plano con `q`, `sort`, los seis filtros y los tres atajos, más una función que lo serialice a `Record<string, string>`
- [x] 4.2 Implementar el filtrado combinado (texto + filtros + atajos) y el orden por menor precio, mayor precio, menor kilometraje y año más reciente, dejando los vehículos sin kilometraje al final de ese orden
- [x] ~~4.3 Marcar como "recién ingresado" a los 12 vehículos más recientes~~ — retirado por el negocio; solo quedan la insignia de `condition = 'new'` y el contador de fotos
- [x] 4.4 Construir el contenedor `sticky top-0` con las tres filas: marca y buscador; los seis selectores; atajos, conteo y orden
- [x] 4.5 Conservar `presentOptions` y `niceBudgetTiers`; eliminar el selector de modelo y la lógica que lo limpiaba al cambiar de marca
- [x] 4.6 Implementar el conteo permanente ("N de M vehículos" con filtros, "M vehículos" sin ellos) y la acción de limpiar, que solo se muestra disponible cuando hay algo que limpiar
- [x] 4.7 Quitar el hero y el cálculo de `heroImage` de `page.tsx` — la banda de marca que lo sustituía también se retiró después
- [x] 4.8 Verificar que ningún ancestro entre `<body>` y la barra introduce `overflow` distinto de `visible`

## 5. Vitrina: tarjetas y estados

- [x] 5.1 Rehacer `VehicleCard` con la nueva jerarquía: foto, marca, modelo, línea de specs, regla, precio y CTA, conservando el enlace que cubre la tarjeta con su `aria-label` y el botón de WhatsApp por encima
- [x] 5.2 Implementar la variante sin fotos: bloque de marca del negocio, aviso de fotos pendientes, mismos datos y CTA de pedir fotos con `requestPhotosHref`
- [x] 5.3 Implementar la insignia de la tarjeta: cantidad de fotos, o "recién ingresado", o "nuevo" para `condition = 'new'`, sin superponerlas
- [x] 5.4 Implementar el estado sin resultados con su explicación, la acción de limpiar y una forma de escribirle al negocio
- [x] 5.5 Revisar que todo objetivo táctil de la vitrina mide al menos 44 px en móvil

## 6. Vitrina en teléfono

- [x] 6.1 Reorganizar el bloque anclado para pantallas angostas: marca y buscador, y una fila con el botón de filtros y los atajos
- [x] 6.2 Implementar el panel de filtros que se despliega desde la barra anclada, con los seis selectores, "limpiar" y "ver N vehículos", sin sacar al visitante de la lista ni perder la posición de scroll
- [x] 6.3 Mostrar en el botón de filtros cuántos criterios hay activos
- [x] 6.4 Implementar la barra inferior anclada con filtros y WhatsApp
- [x] 6.5 Probar en un alto de ventana de 667 px que la lista sigue siendo usable con la barra anclada arriba y la de abajo

## 7. Ficha del vehículo

- [x] 7.1 Rehacer el layout de `vehiculo/[id]/page.tsx` con el panel de precio y contacto anclado en escritorio
- [x] 7.2 Implementar la barra inferior anclada con precio y contacto para pantallas angostas
- [x] 7.3 Actualizar `Gallery`: selección de miniatura visible, contador "n de N", sin controles cuando hay una sola foto
- [x] 7.4 Implementar la ficha de un vehículo sin fotos: bloque de marca en lugar de galería, especificaciones completas, CTA de pedir fotos
- [x] 7.5 Mostrar el código de referencia y su explicación de una línea, omitiendo ambos cuando el vehículo no lo tenga
- [x] 7.6 Implementar la sección de vehículos parecidos con los datos de la tarea 1.7, omitiéndola por completo cuando la lista venga vacía
- [x] 7.7 Conservar intacto el JSON-LD de la ficha y de la portada

## 8. Ajustes y cierre

- [x] 8.1 Agregar el campo de color de marca a `src/components/settings/showcase-settings.tsx`, con vista previa del color y validación del formato
- [x] 8.2 Actualizar la ruta de la API que guarda el perfil público para aceptar y validar `public_brand_color`
- [x] 8.3 Actualizar `footer.tsx`, `store-nav.tsx` y `share-vehicle-button.tsx` a la paleta nueva, sin usar tokens del CRM
- [x] 8.4 Revisar que ningún componente de `src/components/storefront/` conserva cadenas visibles escritas en el código ni clases de token del CRM
- [x] 8.5 Correr la suite de tests y el linter, y dejar constancia del resultado
- [x] 8.6 Verificar la vitrina con el inventario real: los 128 vehículos, los 53 sin fotos, una búsqueda sin resultados, y la ficha de un vehículo con y sin fotos
