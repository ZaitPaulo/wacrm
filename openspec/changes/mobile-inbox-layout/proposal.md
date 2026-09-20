## Why

La bandeja es la pantalla donde el asesor pasa el día, y una parte del trabajo se hace desde el celular. Hoy, desde un teléfono, esa pantalla está rota de formas concretas y verificables:

- **El alto está mal calculado.** `dashboard-shell.tsx:68` usa `h-screen` y `inbox/page.tsx:619` usa `h-[calc(100vh-3.5rem)]`. En Chrome Android `100vh` es el viewport **grande** —el que existe cuando la barra de direcciones está oculta—, así que mientras esa barra se ve, el documento mide más que la pantalla. El resultado es que el `body` se desplaza unos 60 px, **el header global de la aplicación desaparece de vista** (no hay cómo abrir el menú lateral) y el composer queda recortado contra el borde inferior. En todo el repositorio no hay un solo uso de `dvh` o `svh`.
- **El header del hilo no cabe.** `message-thread.tsx:934` pone en una sola fila el botón de volver, el avatar, el nombre, el badge de canal, el teléfono, refrescar, el estado y el asignado. A 360 px el nombre y el teléfono se truncan, y los controles miden `h-7` (28 px), muy por debajo del mínimo táctil razonable.
- **El campo de escritura queda sin espacio.** El composer (`message-composer.tsx:669-812`) reserva cuatro botones de 36 px antes del `textarea`; lo que queda son ~140 px, donde ni el placeholder completo entra. Encima, el texto de ayuda de la línea 812 lleva un `pl-[5.5rem]` fijo que en móvil lo parte en dos renglones y se come otro tanto de alto.
- **El banner de IA se corta.** `ai-thread-banner.tsx:195` fuerza una fila con `items-center`, así que el resumen del traspaso sale truncado a mitad de frase y compite por el ancho con el botón de acción.
- **La ficha del contacto no existe en móvil.** `inbox/page.tsx:684` envuelve la `ContactSidebar` en `hidden lg:block`. Desde el celular no hay ninguna forma de ver etiquetas, negocios ni notas del contacto con el que se está conversando.

## What Changes

- **El alto del shell pasa a unidades dinámicas.** `h-screen` → alto basado en `100dvh`, y la bandeja ajusta su `calc()` en consecuencia. Es un arreglo del contenedor global: beneficia a todas las pantallas del panel, no solo a la bandeja.
- **El header del hilo se reorganiza en dos filas cuando la pantalla es angosta.** Arriba, volver + avatar + nombre sin truncar. Abajo, canal + teléfono + refrescar + estado + asignado, con área táctil de 44 px. En `lg` y más ancho queda **exactamente como hoy**, en una sola fila.
- **El composer colapsa sus acciones en un único botón `+` en móvil.** Ese menú reúne foto, video, documento, nota de voz, mensaje interactivo, respuestas rápidas, plantillas y redactar con IA. La fila queda `+ | textarea | enviar`, y el `textarea` recupera el ancho. Desde `sm` hacia arriba se mantienen los cuatro botones separados de hoy.
- **El texto de ayuda del composer deja de robar alto en móvil**, ya sea por sangría condicional o por no mostrarse en pantallas angostas.
- **El banner de IA se apila en móvil**: el texto ocupa su renglón completo y el botón va debajo, sin truncar el resumen del traspaso.
- **Nueva: la ficha del contacto es accesible desde el celular** como panel deslizante a pantalla completa, que se abre tocando el nombre o el avatar en el header del hilo. Reutiliza el componente `ContactSidebar` que ya existe; no se duplica su lógica.

**Fuera de alcance**

- El resto de las pantallas del panel (contactos, embudos, inventario, ajustes). Reciben el arreglo de alto por venir del shell, pero su maquetación móvil se revisa en cambios propios.
- Rediseñar la lista de conversaciones. Hoy ya ocupa el ancho completo en móvil (`conversation-list.tsx:338`) y se comporta de forma aceptable.
- Cualquier cambio de comportamiento de negocio: qué se puede enviar, a quién se asigna, cuándo corre el bot. Este cambio es de presentación.

## Capabilities

### New Capabilities
- `app-shell-viewport`: cómo el contenedor del panel calcula su alto para que la barra de direcciones móvil no desplace ni recorte el contenido.
- `mobile-inbox-layout`: cómo se presentan el header del hilo, el composer, el banner de IA y la ficha del contacto en pantallas angostas.

### Modified Capabilities
<!-- Ninguna. El comportamiento especificado por las capacidades existentes de la bandeja
     (conversation-visibility, inbox-assignee-filter, inbox-deal-creation, ai-handoff-assignment)
     no cambia: cambia dónde se dibujan sus controles, no qué hacen. -->

## Impact

**Código afectado**

- `src/app/(dashboard)/dashboard-shell.tsx` — alto del contenedor raíz.
- `src/app/(dashboard)/inbox/page.tsx` — `calc()` del alto y montaje del panel deslizante de contacto en móvil.
- `src/components/inbox/message-thread.tsx` — header en dos filas y disparador de la ficha de contacto.
- `src/components/inbox/message-composer.tsx` — menú `+` colapsado y sangría del texto de ayuda.
- `src/components/inbox/ai-thread-banner.tsx` — apilado del banner.
- `src/components/inbox/contact-sidebar.tsx` — se reutiliza tal cual; a lo sumo admite una variante de presentación.
- `messages/*.json` — claves nuevas de next-intl para las etiquetas que aparezcan.

**Sin impacto**

- Base de datos: ninguna migración.
- API y RLS: sin cambios.
- Dependencias: sin paquetes nuevos; el panel deslizante se arma con los primitivos de `src/components/ui` que ya están en el proyecto.

**Riesgo principal**

Una regresión en `lg+`, que es donde se trabaja la mayor parte del tiempo. Toda clase que se toque debe quedar acotada por prefijo de breakpoint, y la validación tiene que comparar la vista de escritorio antes y después.
