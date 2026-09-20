# mobile-inbox-layout Specification

## Purpose
Cómo se presenta la bandeja en pantallas angostas: el header del hilo, el composer, el banner de la IA y el acceso a la ficha del contacto. Todo lo específico de móvil se acota por breakpoint, de modo que la vista de escritorio no cambie.
## Requirements

### Requirement: Header del hilo en dos filas en pantallas angostas
En pantallas de menos de `lg` (1024 px), el header de la conversación SHALL repartirse en **dos filas y no más**: la primera con el botón de volver, el avatar, el nombre del contacto —con el canal y el teléfono debajo, igual que en escritorio— y el chevron; la segunda con el botón de refrescar y los desplegables de estado y de asignado.

El header completo SHALL medir menos de 120 px de alto a 360 px de ancho: es una pantalla de conversación, y el alto que se lleva el encabezado se lo quita a los mensajes.

El nombre del contacto SHALL mostrarse completo en esa primera fila, sin truncar, mientras quepa en el ancho de la pantalla.

Desde `lg` en adelante el header SHALL conservar exactamente la disposición actual: una sola fila con todo alineado a los extremos.

#### Scenario: Teléfono de 360 px
- **WHEN** el asesor abre una conversación en una pantalla de 360 px de ancho
- **THEN** el nombre del contacto se lee completo, sin puntos suspensivos
- **AND** el canal y el teléfono quedan bajo el nombre, y refrescar, el estado y el asignado en una segunda fila, todos visibles
- **AND** el header mide menos de 120 px de alto

#### Scenario: Escritorio sin cambios
- **WHEN** se abre la misma conversación en una ventana de 1440 px
- **THEN** el header se ve idéntico a como se veía antes de este cambio, en una sola fila

### Requirement: Área táctil de los controles del header
En pantallas de menos de `lg`, los controles del header del hilo —refrescar, el desplegable de estado y el desplegable de asignado— SHALL tener un área táctil de al menos 44 px de alto. Desde `lg` en adelante conservan su tamaño compacto actual.

#### Scenario: Tocar el estado en móvil
- **WHEN** el asesor toca el desplegable de estado en un teléfono
- **THEN** el menú se abre sin necesidad de apuntar con precisión
- **AND** el control mide al menos 44 px de alto

### Requirement: Acciones del composer agrupadas en pantallas angostas
En pantallas de menos de `sm` (640 px), los cuatro botones de acción del composer —adjuntar, más, plantillas y redactar con IA— SHALL colapsarse en un único botón que abre un menú con todas sus opciones: foto, video, documento, nota de voz, mensaje interactivo, respuestas rápidas, plantillas y redactar con IA.

La fila del composer SHALL quedar entonces con tres elementos: ese botón, el campo de escritura y el botón de enviar.

Desde `sm` en adelante SHALL conservarse los cuatro botones separados tal como están hoy.

Ninguna acción disponible hoy SHALL desaparecer de la interfaz móvil.

#### Scenario: Campo de escritura con ancho
- **WHEN** el asesor abre una conversación en una pantalla de 360 px
- **THEN** el campo de escritura muestra su texto de ayuda completo, sin recortar
- **AND** antes del campo hay un único botón de acciones

#### Scenario: Todas las acciones siguen alcanzables
- **WHEN** el asesor toca el botón de acciones en móvil
- **THEN** el menú lista foto, video, documento, nota de voz, mensaje interactivo, respuestas rápidas, plantillas y redactar con IA

#### Scenario: Tableta y escritorio sin cambios
- **WHEN** se abre el composer en 768 px o más
- **THEN** los cuatro botones aparecen separados, como antes de este cambio

### Requirement: El estado deshabilitado se evalúa por acción
Cuando la ventana de 24 h de la conversación está vencida, el menú de acciones del composer SHALL poder abrirse igual, y **Plantillas** SHALL seguir disponible dentro de él. Las acciones que sí dependen de esa ventana —adjuntar medios, mensaje interactivo, respuestas rápidas— SHALL aparecer deshabilitadas individualmente.

#### Scenario: Sesión vencida
- **WHEN** el asesor abre una conversación cuya ventana de 24 h se cerró y toca el botón de acciones
- **THEN** el menú se abre
- **AND** "Plantillas" está habilitada
- **AND** las acciones que requieren la ventana abierta están deshabilitadas

#### Scenario: Solo lectura
- **WHEN** quien mira no tiene permiso para enviar mensajes
- **THEN** las acciones del menú quedan deshabilitadas, igual que hoy lo están los botones sueltos

### Requirement: El texto de ayuda del composer no roba alto en móvil
El texto de descubrimiento que hoy aparece bajo el campo de escritura SHALL ocultarse en pantallas de menos de `sm` y mantenerse desde `sm` en adelante. La acción que describe SHALL seguir siendo alcanzable desde el menú de acciones, con su rótulo.

#### Scenario: Móvil
- **WHEN** el asesor abre el composer en un teléfono
- **THEN** no aparece el texto de ayuda bajo el campo de escritura
- **AND** el menú de acciones incluye "Redactar con IA" rotulada

### Requirement: El banner de IA se apila en pantallas angostas
En pantallas de menos de `sm`, el banner de estado de la IA SHALL disponer su texto y su botón en filas separadas: el texto ocupa el ancho completo y el botón va debajo. El resumen del traspaso SHALL poder leerse sin truncar cuando el asesor lo despliega.

Desde `sm` en adelante SHALL conservar la disposición en una fila que tiene hoy.

#### Scenario: Resumen de traspaso en móvil
- **WHEN** el bot traspasó la conversación dejando un resumen y el asesor abre el hilo en un teléfono
- **THEN** el título y el resumen ocupan el ancho completo del banner
- **AND** el botón de acción queda debajo, completamente visible, sin cortar su etiqueta

#### Scenario: Desplegar el resumen
- **WHEN** el asesor toca "Ver resumen completo"
- **THEN** el resumen se muestra entero, en varias líneas, sin truncar

### Requirement: Ficha del contacto accesible desde el teléfono
En pantallas de menos de `lg`, tocar el nombre o el avatar del contacto en el header del hilo SHALL abrir la ficha del contacto como panel deslizante, mostrando la misma información y las mismas acciones que el panel lateral de escritorio: datos del contacto, etiquetas, negocios y notas.

El disparador SHALL ser un control enfocable con teclado y con etiqueta accesible.

En `lg` y más ancho, el nombre y el avatar SHALL seguir sin ser interactivos, porque el panel lateral ya está a la vista.

#### Scenario: Abrir la ficha en móvil
- **WHEN** el asesor toca el nombre del contacto en el header del hilo en un teléfono
- **THEN** se abre un panel deslizante con la ficha del contacto
- **AND** puede ver y editar etiquetas, ver los negocios y agregar notas, igual que en escritorio

#### Scenario: Cerrar la ficha
- **WHEN** el asesor cierra el panel
- **THEN** vuelve a la conversación en el mismo punto en que estaba

#### Scenario: Escritorio sin disparador
- **WHEN** se abre la conversación en 1440 px
- **THEN** el nombre del contacto no es un botón, y la ficha sigue mostrándose como panel lateral fijo

### Requirement: Todo texto visible viene de next-intl
Las etiquetas, títulos y descripciones accesibles que este cambio introduzca SHALL definirse en los archivos de traducción del proyecto —español, inglés y coreano— bajo los espacios de nombres existentes de la bandeja. Ninguna SHALL quedar escrita directamente en el componente.

#### Scenario: Cambio de idioma
- **WHEN** se usa la aplicación en inglés
- **THEN** el menú de acciones del composer, la etiqueta accesible del disparador de la ficha y el título del panel deslizante aparecen en inglés

### Requirement: El acceso a la ficha se anuncia como tal
En pantallas de menos de `lg`, el bloque de avatar y nombre SHALL mostrar un indicador visual de que abre algo —un chevron al extremo derecho de su fila— y SHALL reaccionar al toque con un cambio de fondo. El área tocable SHALL abarcar la fila completa y medir al menos 44 px de alto.

En `lg` y más ancho no SHALL aparecer indicador alguno, porque ahí el bloque no es interactivo.

#### Scenario: Se nota que abre algo
- **WHEN** el asesor mira el header del hilo en un teléfono
- **THEN** ve un chevron al final de la fila del nombre
- **AND** al tocar cualquier punto de esa fila se abre la ficha del contacto

#### Scenario: Escritorio sin indicador
- **WHEN** se abre la conversación en 1440 px
- **THEN** no hay chevron y el bloque no responde al puntero

### Requirement: Las etiquetas del header se leen completas
En pantallas de menos de `lg`, el canal y el teléfono SHALL presentarse juntos como una pastilla con fondo, y el estado y el asignado como sendas pastillas, de modo que se distingan entre sí y del fondo del header.

El nombre del asesor asignado SHALL ser visible sin desplegar el menú, acotado para que un nombre largo no desplace al control de estado.

El nombre del canal SHALL omitirse en esas pantallas —basta el icono, que lo distingue por color y forma— conservando su etiqueta accesible.

#### Scenario: Se sabe quién atiende
- **WHEN** el asesor abre en un teléfono una conversación asignada
- **THEN** la pastilla de asignado muestra el nombre del asesor, no sólo un icono

#### Scenario: El teléfono no compite con el canal
- **WHEN** se mira la pastilla de canal en un teléfono
- **THEN** muestra el icono del canal y el número completo, sin la palabra del canal

#### Scenario: Escritorio intacto
- **WHEN** se abre la conversación en 1024, 1280 o 1440 px
- **THEN** el header se ve exactamente igual que antes del cambio: sin fondos de pastilla, con el nombre del canal, y con los controles en sus mismas posiciones
