## Context

La bandeja ya tiene una estructura móvil pensada: `inbox/page.tsx:611-687` muestra **un solo panel** por debajo de `lg` —la lista, o el hilo— y `message-thread.tsx:937` pinta un botón de volver que solo existe en móvil. Es decir, la navegación móvil no hay que inventarla; ya está y funciona.

Lo que falla es todo lo demás: el alto del contenedor, la densidad del header, el ancho que le queda al campo de escritura, el banner que trunca y una ficha de contacto que directamente no se monta. Son cinco arreglos de maquetación sobre una arquitectura que se conserva.

Tres restricciones marcan el terreno:

- **Tailwind v4 y Next 16.** No hay archivo de configuración de Tailwind que extender con breakpoints propios; se usan los que trae por defecto (`sm` 640, `lg` 1024).
- **El repositorio no usa Server Actions.** Nada de lo que se hace acá necesita servidor, así que la restricción no aprieta, pero vale nombrarla: todo esto es cliente.
- **Los diálogos son base-ui, no Radix.** `src/components/ui/sheet.tsx` envuelve `Dialog` de `@base-ui/react/dialog`, y el patrón de composición es `render={<Button/>}`, **no** `asChild`. Equivocarse acá rompe en tiempo de ejecución, no en compilación.

## Goals / Non-Goals

**Goals:**

- Que a 360 px de ancho el header global de la aplicación siga visible y el composer no quede recortado.
- Que el nombre del contacto se lea completo y los controles del header se puedan tocar sin apuntar.
- Que el campo de escritura tenga ancho de sobra, sin esconder ninguna acción que hoy exista.
- Que el resumen del traspaso de la IA se pueda leer sin truncar.
- Que desde el celular se llegue a etiquetas, negocios y notas del contacto.
- Que en `lg+` **no cambie nada**, ni un píxel.

**Non-Goals:**

- Rediseñar la lista de conversaciones.
- Llevar esta revisión a las otras pantallas del panel en este cambio.
- Introducir una biblioteca de gestos, de `bottom sheet` o de detección de dispositivo.
- Cambiar cualquier comportamiento de negocio de la bandeja.

## Decisions

### 1. El alto se resuelve con `dvh`, no con JavaScript

`h-screen` (`dashboard-shell.tsx:68`) pasa a `h-dvh`, y `h-[calc(100vh-3.5rem)]` (`inbox/page.tsx:619`) pasa a `h-[calc(100dvh-3.5rem)]`.

`100dvh` sigue al viewport **dinámico**: vale menos mientras la barra de direcciones se ve y crece cuando se oculta. Es exactamente la semántica que se necesita y está soportada en todos los navegadores que el producto alcanza.

*Alternativas descartadas:*
- **`visualViewport` + variable CSS por JS** (el viejo truco del `--vh`). Funciona, pero agrega un `resize listener`, un reflow por cada cambio de la barra y un parpadeo en la primera pintura. `dvh` hace lo mismo desde el motor.
- **`100svh`** (viewport chico, el valor mínimo constante). Evita el reajuste pero desperdicia permanentemente la franja de la barra de direcciones cuando está oculta. En una pantalla de chat, donde el alto es el recurso escaso, eso se nota.
- **Dejar `100vh` y compensar con `padding`.** Es adivinar la altura de una barra que varía por navegador y por versión.

*Sobre el reajuste:* con `dvh`, cuando la barra se oculta al hacer scroll, el contenedor crece y el hilo de mensajes se reacomoda. Es el comportamiento que tiene cualquier aplicación de chat en el navegador y se prefiere sobre perder alto de forma permanente.

### 2. El breakpoint del header es `lg`, el del composer es `sm`

No es arbitrario ni es inconsistencia:

- El **header** se parte en dos filas en `<lg` porque `lg` es el mismo umbral donde aparece la lista de conversaciones al lado y desaparece el botón de volver (`message-thread.tsx:944`). Usar otro valor dejaría un rango de anchos con el botón de volver visible y el header ya en una fila, o al revés.
- El **composer** colapsa sus botones en `<sm` porque el problema es de ancho puro: a 640 px los cuatro botones y el `textarea` conviven sin apretarse. Colapsarlos hasta `lg` le quitaría acciones de un toque a las tabletas, que tienen espacio de sobra.

### 3. El header en dos filas se hace con `flex-wrap`, no con dos árboles

Se conserva **un solo** árbol de JSX y se cambia su comportamiento con clases. La alternativa —renderizar un bloque para móvil y otro para escritorio con `hidden`/`lg:flex`— duplicaría los dos `DropdownMenu` de estado y asignado, y con ellos su estado y sus manejadores. Eso es exactamente el tipo de duplicación que después se desincroniza.

El contenedor pasa de `flex items-center justify-between` a envolver en móvil y volver a una fila en `lg`, con el bloque de acciones ocupando el ancho completo en la segunda fila.

*Sobre el nombre sin truncar:* hoy el `truncate` de `message-thread.tsx:950` es correcto en `lg+`, donde el header compite con la lista y la ficha. En móvil, con la fila entera disponible, el nombre debe poder usarla. El `truncate` queda condicionado al breakpoint, no eliminado.

*Sobre los 44 px:* los controles suben de `h-7` a `h-11` en móvil y vuelven a `h-7` en `lg`. El área táctil se agranda de verdad; no se simula con `padding` invisible ni con pseudo-elementos, porque eso genera solapamientos difíciles de depurar entre dos controles vecinos.

### 4. El menú `+` del composer reutiliza los `DropdownMenu` que ya existen

El composer ya tiene dos menús desplegables: el de adjuntar (`message-composer.tsx:671`) y el de `+` (`message-composer.tsx:715`). En móvil se funden en uno solo que suma, además, plantillas y redactar con IA —que hoy son botones sueltos (`message-composer.tsx:744` y `message-composer.tsx:757`).

Los cuatro disparadores actuales se marcan `hidden sm:inline-flex` y aparece un disparador único `sm:hidden` con el menú combinado. Las acciones que ejecutan los ítems son las mismas funciones ya definidas (`imageInputRef.current?.click()`, `startRecording()`, `openInteractiveBuilder()`, `onOpenTemplates()`, `handleDraft()`); no se escribe lógica nueva.

**Cuidado con el estado deshabilitado.** Hoy cada disparador tiene su propia regla: adjuntar y `+` se apagan con `inputsDisabled` (que incluye `sessionExpired`), plantillas **no** se apaga con la sesión vencida —justamente porque las plantillas son la salida cuando la ventana de 24 h se cerró—, y redactar con IA se apaga con `drafting`. El menú combinado tiene que preservar esas reglas **por ítem**, no aplicar una sola al disparador. Si se apaga el botón entero con `inputsDisabled`, se rompe el flujo de sesión vencida que hoy funciona, que es precisamente lo que muestra la segunda captura del reporte.

*Alternativa descartada:* un `Sheet` inferior con las acciones en cuadrícula. Se ve mejor en una demostración, pero introduce un patrón que el proyecto no usa para menús de acciones y obliga a mantener dos presentaciones de la misma lista.

### 5. El texto de ayuda se esconde en móvil

`message-composer.tsx:812` lleva `pl-[5.5rem]`, una sangría calculada para alinearse bajo el `textarea` cuando hay cuatro botones de 36 px a su izquierda. Con un solo botón esa cuenta deja de valer, y el texto ("Toca la ✨ para redactar una respuesta con IA — puedes editarla antes de enviar") ocupa dos renglones en una pantalla donde el alto escasea.

Se esconde en `<sm` y se mantiene desde `sm` con su sangría actual. Es un texto de descubrimiento, no una instrucción necesaria: la acción sigue estando en el menú `+`, rotulada.

### 6. La ficha de contacto en móvil usa `Sheet`, con `ContactSidebar` intacto

`Sheet` (`src/components/ui/sheet.tsx`) ya está en el proyecto y en uso en tres lugares (`contact-detail-view.tsx`, `flow-canvas.tsx`, `deal-form.tsx`). Se monta con `side="right"`, ancho completo en móvil.

`ContactSidebar` fija hoy su propia presentación: `w-70` y `border-l` en sus dos ramas de retorno (`contact-sidebar.tsx:292` y `:305`). Para que quepa en el panel deslizante se le agrega una prop **opcional** `className` que se fusiona con `cn()` sobre esas clases. Es el patrón que ya usan los componentes de `src/components/ui`; el llamador de escritorio no cambia ni una línea.

*Alternativa descartada:* extraer el contenido a un `ContactSidebarContent` y envolverlo desde dos lados. Es más limpio en teoría, pero mueve casi 28 000 caracteres de componente para resolver dos clases de CSS, y cada línea movida es una oportunidad de regresión en el panel de escritorio, que hoy funciona.

**El disparador** es el bloque del nombre y el avatar en el header del hilo, solo en `<lg`. Tiene que ser un `<button>` de verdad con su `aria-label`, no un `div` con `onClick`: es el único acceso a esa información desde el celular y tiene que existir para un lector de pantalla y para el teclado.

**Dónde se monta.** El estado de apertura vive en `MessageThread`, no en la página, porque el disparador está en el header del hilo y el contacto (`contact`) ya llega como prop a ese componente. Subirlo a `inbox/page.tsx` obligaría a pasar un manejador más hacia abajo sin ganar nada.

### 7. Todo texto visible pasa por next-intl

Las etiquetas nuevas —el rótulo del menú `+` combinado, el `aria-label` del disparador de la ficha, el título del panel deslizante— se agregan a `messages/es.json`, `messages/en.json` y `messages/ko.json`, bajo los espacios de nombres que ya existen (`Inbox.messageThread`, `Inbox.composer`). Ninguna cadena queda escrita en el componente.

## Risks / Trade-offs

**[Regresión en escritorio] → Toda clase nueva de maquetación va con prefijo de breakpoint (`sm:`, `lg:`), y el valor previo se conserva como el valor del breakpoint alto.** La validación compara la bandeja en escritorio antes y después. Es el riesgo más caro del cambio: `lg+` es donde se trabaja todo el día.

**[El menú combinado apaga acciones que hoy funcionan con la sesión vencida] → El estado deshabilitado se evalúa por ítem del menú, nunca en el disparador.** Escenario de prueba obligatorio: conversación con la ventana de 24 h cerrada; el menú `+` debe abrir y "Plantillas" debe estar disponible.

**[`dvh` reacomoda el hilo al mostrarse u ocultarse la barra de direcciones] → Se acepta.** Es el comportamiento de cualquier chat en el navegador y es preferible a perder alto de forma permanente con `svh`. Si en la práctica molesta al escribir, la respuesta es fijar el composer, no volver a `vh`.

**[El teclado virtual tapa el composer] → Fuera del alcance de este cambio, pero hay que mirarlo al validar.** `dvh` no responde al teclado; quien responde es el viewport visual. Si aparece, se anota como hallazgo y se trata aparte: la solución es `interactive-widget=resizes-content` en el `meta viewport`, y tocar esa etiqueta afecta a toda la aplicación.

**[El panel deslizante de contacto dispara consultas al abrirse] → Aceptable.** `ContactSidebar` carga negocios, notas y etiquetas en un efecto. En escritorio se monta siempre; en móvil se montará solo al abrir el panel, lo que en realidad **reduce** el trabajo en el dispositivo más débil.

**[`h-dvh` toca el shell de todas las pantallas] → Es un cambio de una clase y el efecto es estrictamente una corrección.** Cualquier pantalla que hoy dependa de que `100vh` sea más alto que la ventana está rota igual, solo que todavía no se reportó.

## Migration Plan

Sin migración de base de datos ni cambios de contrato. Se despliega como cualquier cambio de interfaz. La reversión es revertir el commit: no queda estado persistido de este cambio en ninguna parte.

## Open Questions

**El teclado virtual y el composer — sin verificar, y hace falta un teléfono de verdad.**

`src/app/layout.tsx:65` exporta `viewport` sin `interactiveWidget`, así que rige el
valor por omisión, `resizes-visual`: al abrir el teclado, Android Chrome encoge el
*viewport visual* pero no el de maquetación. `100dvh` no se entera, y como la raíz
del panel es `overflow-hidden`, el desplazamiento automático que el navegador hace
hacia el campo enfocado puede no tener a dónde ir — el composer quedaría detrás del
teclado.

No se pudo comprobar en esta tanda: el recorrido se hizo con Chrome headless por CDP,
que emula tamaño de pantalla pero no teclado virtual. Queda para revisar en un
dispositivo real.

Si se confirma, el arreglo es una línea —`interactiveWidget: 'resizes-content'` en ese
mismo `export const viewport`—, pero afecta a **toda** la aplicación, así que merece su
propio cambio y su propia validación, no un agregado a éste.
