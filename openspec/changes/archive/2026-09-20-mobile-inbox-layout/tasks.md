## 1. Alto del viewport

- [x] 1.1 En `src/app/(dashboard)/dashboard-shell.tsx:68`, cambiar `h-screen` por `h-dvh` en el contenedor raíz del panel.
- [x] 1.2 En `src/app/(dashboard)/inbox/page.tsx:619`, cambiar `h-[calc(100vh-3.5rem)]` por `h-[calc(100dvh-3.5rem)]`.
- [x] 1.3 Revisar que el spinner de carga de `dashboard-shell.tsx:57` (que también usa `h-screen`) quede consistente con el contenedor definitivo, para que no haya salto entre el estado de carga y el panel ya montado.
- [x] 1.4 Verificar a 360 px que el header de la aplicación con el botón ☰ queda visible sin desplazar, y que el documento no se desplaza verticalmente.

## 2. Header del hilo en dos filas

- [x] 2.1 En `src/components/inbox/message-thread.tsx:934`, hacer que el contenedor del header envuelva en `<lg` y vuelva a una sola fila desde `lg`. Un solo árbol de JSX: no duplicar los `DropdownMenu` de estado ni de asignado.
- [x] 2.2 Hacer que el bloque de acciones (refrescar + estado + asignado) ocupe el ancho completo en la segunda fila en móvil, y conserve su alineación a la derecha en `lg`.
- [x] 2.3 Mover el badge de canal y el teléfono (`message-thread.tsx:958-968`) a la segunda fila en móvil, dejándolos junto al nombre en `lg`.
- [x] 2.4 Condicionar el `truncate` del nombre (`message-thread.tsx:950`) para que en móvil el nombre use la fila completa y en `lg+` siga truncando como hoy.
- [x] 2.5 Subir los controles de `h-7` a `h-11` en `<lg`, devolviéndolos a `h-7` desde `lg`: el botón de refrescar (`message-thread.tsx:1016`) y los dos disparadores de `DropdownMenu` (`:1036` y `:1057`).
- [x] 2.6 Revisar el badge del temporizador de sesión (`message-thread.tsx:975`), hoy oculto por debajo de `sm`: decidir si con la segunda fila ya cabe y mostrarlo, o dejarlo oculto. Dejar la decisión anotada en el código.
- [x] 2.7 Comparar el header en 1440 px contra `main` y confirmar que no cambió nada.

## 3. Composer: menú de acciones colapsado

- [x] 3.1 En `src/components/inbox/message-composer.tsx:669-771`, marcar `hidden sm:inline-flex` los cuatro disparadores actuales: adjuntar (`:671`), más (`:715`), plantillas (`:744`) y redactar con IA (`:757`).
- [x] 3.2 Agregar un `DropdownMenu` único con clase `sm:hidden` cuyo disparador sea un botón `+`, reutilizando el patrón de `DropdownMenuTrigger` con `render={<Button/>}` que ya usa el archivo (base-ui, **nunca** `asChild`).
- [x] 3.3 Poblar ese menú con los ocho ítems, llamando a las funciones que ya existen: `imageInputRef.current?.click()`, `videoInputRef.current?.click()`, `documentInputRef.current?.click()`, `startRecording()`, `openInteractiveBuilder()`, `setQuickReplyOpen(true)`, `onOpenTemplates()` y `handleDraft()`.
- [x] 3.4 Aplicar el estado deshabilitado **por ítem**, replicando las reglas de hoy: `inputsDisabled` para medios, interactivo y respuestas rápidas; solo `readOnly` para plantillas —que debe seguir disponible con la sesión vencida—; `readOnly || drafting` para redactar con IA. El disparador `+` nunca se deshabilita por `sessionExpired`.
- [x] 3.5 Respetar el gate de permisos: plantillas y redactar con IA hoy pasan por `GatedButton` con `canAct={!readOnly}`. Conservar ese comportamiento en los ítems del menú.
- [x] 3.6 En `message-composer.tsx:812`, esconder el texto de ayuda en `<sm` y conservar su `pl-[5.5rem]` desde `sm`.
- [x] 3.7 Verificar a 360 px que el placeholder "Escribe un mensaje" se lee completo.

## 4. Banner de IA

- [x] 4.1 En `src/components/inbox/ai-thread-banner.tsx:195`, cambiar el contenedor `Banner` para que apile en `<sm` (columna, texto arriba y botón abajo) y conserve la fila con `items-center` desde `sm`.
- [x] 4.2 Ajustar `BannerButton` (`ai-thread-banner.tsx:218`) para que en móvil no se recorte su etiqueta: alineado al inicio o a ancho completo, sin `flex-shrink-0` compitiendo por el ancho.
- [x] 4.3 Verificar con una conversación traspasada por el bot que el resumen desplegado se lee entero en un teléfono.

## 5. Ficha de contacto en móvil

- [x] 5.1 En `src/components/inbox/contact-sidebar.tsx`, agregar una prop opcional `className` y fusionarla con `cn()` sobre las clases de las **dos** ramas de retorno (`:292` y `:305`), para poder anular `w-70` y `border-l` sin tocar el resto.
- [x] 5.2 En `src/components/inbox/message-thread.tsx`, convertir el bloque de avatar + nombre en un `<button>` visible solo en `<lg`, con `aria-label` traducido, que abre el panel. En `lg+` debe seguir siendo texto no interactivo.
- [x] 5.3 Montar un `Sheet` de `@/components/ui/sheet` con `side="right"`, ancho completo en móvil, que renderice `<ContactSidebar contact={contact} className="..." />`. El estado de apertura vive en `MessageThread`.
- [x] 5.4 Darle al `Sheet` un `SheetTitle` (aunque sea solo para lectores de pantalla): base-ui lo exige para la accesibilidad del diálogo.
- [x] 5.5 Cerrar el panel cuando cambia la conversación activa, para que no quede abierto sobre un contacto que ya no es el que se está mirando.
- [x] 5.6 Confirmar que el panel lateral de escritorio (`inbox/page.tsx:684`) sigue funcionando sin cambios, incluido el botón de plegado del header (`message-thread.tsx:984`).

## 6. Traducciones

- [x] 6.1 Agregar a `messages/es.json` las claves nuevas bajo los espacios de nombres existentes de la bandeja: rótulo del menú `+` combinado, `aria-label` del disparador de la ficha y título del panel deslizante.
- [x] 6.2 Replicar esas mismas claves en `messages/en.json` y `messages/ko.json`.
- [x] 6.3 Verificar que no quedó ninguna cadena visible escrita directamente en los componentes tocados.

## 7. Validación

- [x] 7.1 `npm run lint` y `npx tsc --noEmit` sin errores nuevos.
- [x] 7.2 `npm test` (vitest) sin regresiones; prestar atención a `dropdown-menu-group-label.test.tsx`.
- [x] 7.3 `npm run build` completo, para descartar que algo del cambio rompa la compilación de producción.
- [x] 7.4 Recorrido manual a 360 px, 390 px y 430 px: header, composer, banner de IA y ficha de contacto.
- [x] 7.5 Recorrido manual a 768 px, 1024 px y 1440 px, comparando contra `main`: cero cambios visuales en escritorio.
- [x] 7.6 Caso de sesión vencida en móvil: el menú `+` abre y "Plantillas" está habilitada.
- [x] 7.7 Anotar como hallazgo aparte —sin arreglarlo acá— si el teclado virtual tapa el composer, porque la solución toca la etiqueta `meta viewport` de toda la aplicación.

## 8. Ajustes tras la prueba en dispositivo

- [x] 8.1 Chevron `ChevronRight` al final de la fila del nombre, con `hover`/`active` y el botón a `flex-1` + `min-h-11`, para que se note que abre la ficha.
- [x] 8.2 `channelAndPhone` pasa a recibir `withLabel`: sin la palabra del canal en móvil, con ella en `lg`.
- [x] 8.3 Pastilla con fondo para canal+teléfono, y fondo de pastilla en los disparadores de estado y asignado, sólo en móvil.
- [x] 8.4 Mostrar el nombre del asignado en móvil (antes `hidden sm:inline`), acotado con `max-lg:max-w-28`.
- [x] 8.5 Extraer `refreshButton` como función con `className` de visibilidad, y montarlo en la fila 2 de móvil y en el bloque de acciones de escritorio.
- [x] 8.6 Todo el estilo móvil con el prefijo `max-lg:`, para que escritorio quede intacto por construcción.
- [x] 8.7 Verificar escritorio contra `main` por geometría de cada control y por diff de píxeles a 1024/1280/1440.
- [x] 8.8 Compactar el header móvil de 3 filas a 2: el canal y el teléfono vuelven bajo el nombre (conservando la pastilla), refrescar se une a los controles y el padding vertical baja con `max-lg:py-2`. De 173 px a 115 px.
