# storefront-discovery Specification

## Purpose
Cómo un visitante encuentra un vehículo en la vitrina: controles de búsqueda siempre accesibles, texto libre, filtros que solo ofrecen valores existentes, orden, conteo permanente de resultados y un estado vacío accionable.
## Requirements

### Requirement: Los controles de búsqueda permanecen accesibles durante todo el recorrido

La vitrina SHALL mantener sus controles de búsqueda —buscador, filtros, conteo de resultados y orden— accesibles sin que el visitante tenga que volver al inicio de la página, en cualquier ancho de pantalla.

En pantallas anchas los filtros SHALL permanecer anclados en pantalla mientras la grilla se desplaza —el mecanismo concreto, barra superior o columna lateral, es decisión de diseño—. En pantallas angostas SHALL alcanzarse desde un control anclado que viaje con el visitante, y el panel que abra SHALL montarse sobre la lista sin sacarlo de los resultados ni perder su posición de scroll.

Ningún control de búsqueda SHALL quedar disponible únicamente en una zona que se pierde al hacer scroll.

#### Scenario: El visitante cambia un filtro después de recorrer la grilla

- **WHEN** un visitante hace scroll hasta el final del inventario y decide cambiar la marca
- **THEN** el control de marca sigue visible en pantalla y puede cambiarlo sin volver arriba

#### Scenario: El visitante filtra desde el teléfono

- **WHEN** un visitante en un teléfono ha bajado por la lista y abre los filtros
- **THEN** el panel de filtros se abre desde la barra anclada, sobre la lista, y al cerrarlo el visitante sigue viendo resultados sin haber perdido su posición

#### Scenario: Los resultados se actualizan sin recargar

- **WHEN** el visitante cambia cualquier control de búsqueda
- **THEN** la grilla, el conteo de resultados y el estado del control se actualizan de inmediato, sin recarga de página

### Requirement: La vitrina permite buscar por texto libre

La vitrina SHALL ofrecer un campo de búsqueda por texto que filtre el inventario por marca, modelo y año. La búsqueda SHALL ignorar diferencias de mayúsculas y SHALL aceptar coincidencias parciales.

La búsqueda por texto SHALL combinarse con los demás filtros: acota los resultados, no los reemplaza.

#### Scenario: Búsqueda parcial por modelo

- **WHEN** el visitante escribe `dust` en el buscador
- **THEN** la grilla muestra los vehículos cuyo modelo contiene ese texto, sin importar mayúsculas

#### Scenario: Búsqueda combinada con un filtro

- **WHEN** el visitante tiene seleccionada una carrocería y además escribe una marca en el buscador
- **THEN** los resultados cumplen las dos condiciones a la vez

### Requirement: Los filtros por atributo solo ofrecen valores que existen en el inventario

La vitrina SHALL construir las opciones de cada filtro a partir del inventario publicado en ese momento, y NO SHALL ofrecer un valor que no corresponda a ningún vehículo disponible.

Los tramos de precio y de kilometraje SHALL derivarse de los valores reales del inventario, de forma que sirvan igual con precios en miles o en millones según la moneda de la cuenta.

#### Scenario: Una carrocería sin vehículos no se ofrece

- **WHEN** ningún vehículo publicado es convertible
- **THEN** el filtro de carrocería no ofrece la opción convertible

#### Scenario: Los tramos de precio se ajustan a la moneda de la cuenta

- **WHEN** los precios del inventario están en pesos colombianos, con valores de decenas de millones
- **THEN** los tramos ofrecidos son cifras redondas legibles dentro de ese rango, no tramos pensados para otra escala

### Requirement: La vitrina permite ordenar los resultados

La vitrina SHALL ofrecer al visitante ordenar los resultados por al menos: menor precio, mayor precio, menor kilometraje y año más reciente. El orden elegido SHALL aplicarse sobre el conjunto ya filtrado y SHALL mantenerse al cambiar cualquier filtro.

Un vehículo sin kilometraje registrado NO SHALL desplazar a los demás al ordenar por kilometraje.

#### Scenario: Ordenar y luego filtrar

- **WHEN** el visitante ordena por menor precio y después selecciona una marca
- **THEN** los resultados de esa marca siguen apareciendo de menor a mayor precio

### Requirement: El visitante siempre sabe cuántos resultados quedan y cómo deshacer

La vitrina SHALL mostrar de forma permanente cuántos vehículos cumplen los criterios actuales y cuántos hay publicados en total. SHALL ofrecer además una acción para quitar todos los criterios a la vez, que SHALL indicar visualmente cuándo hay algo que limpiar.

En pantallas angostas, el control que abre los filtros SHALL indicar cuántos criterios hay activos.

#### Scenario: Hay filtros aplicados

- **WHEN** el visitante tiene criterios activos que dejan 41 de 128 vehículos
- **THEN** la vitrina indica ambas cifras y la acción de limpiar se muestra disponible

#### Scenario: No hay filtros aplicados

- **WHEN** el visitante no ha aplicado ningún criterio
- **THEN** la vitrina indica el total publicado y la acción de limpiar no se ofrece como disponible

### Requirement: Ningún resultado es un estado accionable, no un error

Cuando ninguna combinación de criterios produce resultados, la vitrina SHALL explicarlo en los términos del visitante y SHALL ofrecer al menos una salida: quitar los criterios, o contactar al negocio para que busquen el vehículo por él.

La vitrina NO SHALL mostrar una grilla vacía sin explicación ni salida.

#### Scenario: Una combinación imposible

- **WHEN** el visitante combina criterios que ningún vehículo cumple
- **THEN** se muestra un mensaje que lo explica junto a la acción de limpiar los criterios y una forma de escribirle al negocio
