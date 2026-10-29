## 1. Base en el hilo

- [x] 1.1 Reemplazar `temp-${Date.now()}` por un id temporal único (`temp-${crypto.randomUUID()}`) en los handlers de envío de `message-thread.tsx`, y verificar que nada dependa del formato salvo el prefijo `temp-`
- [x] 1.2 Cambiar `handleSendMedia` (y el tipo `onSendMedia` en el composer) para que devuelva `Promise<boolean>`, con `true` si el POST respondió bien, sin cambiar el manejo de fallos actual

## 2. Lógica pura de la tanda

- [x] 2.1 Crear helpers puros y probables (p. ej. `src/components/inbox/image-batch.ts`) con estas funciones: filtrar archivos por tipo admitido y peso, aplicar el tope de 10 sobre la tanda existente y devolver aceptadas, rechazadas por tipo, rechazadas por peso y excedentes
- [x] 2.2 Pruebas unitarias de los helpers: tope exacto, excedente, mezcla de PDF + JPEG, archivo sobre el peso permitido, tanda vacía

## 3. Composer: estado y subida

- [x] 3.1 Agregar el estado `imageDrafts` (localId, file, previewUrl, status, mediaUrl, path, caption) y el índice de la miniatura activa; que sea mutuamente excluyente con `draft`, borrando el objeto del que se reemplaza
- [x] 3.2 Implementar `addImages(files)`: validar con los helpers, avisar lo rechazado, crear las miniaturas con object URL y subir con un máximo de 3 subidas simultáneas, actualizando el estado de cada imagen
- [x] 3.3 Poner `multiple` en el input de imagen y enrutarlo a `addImages`; video y documento siguen como hoy
- [x] 3.4 Quitar una imagen: borrar su objeto, revocar su object URL y reajustar el índice activo
- [x] 3.5 Limpieza al desmontar: borrar los objetos de todas las imágenes en preparación y revocar sus object URL (extender `draftRef`/efecto de limpieza)

## 4. Composer: envío secuencial

- [x] 4.1 Implementar `sendImageBatch`: bloquear mientras haya subidas pendientes, recorrer en orden con `await onSendMedia(...)`, poner `replyToId` solo en la primera, llamar `onClearReply` una vez, y saltarse las imágenes con estado de error
- [x] 4.2 Mostrar el progreso "Enviando N de M" y bloquear agregar, quitar y reenviar mientras dure; al terminar, vaciar la tira sin borrar los objetos enviados

## 5. UI de la tira

- [x] 5.1 Crear `ImageDraftTray` a nivel de módulo: fila de miniaturas con scroll horizontal, spinner o error por imagen, X para quitar, borde en la activa, casilla "+" mientras haya menos de 10 y un campo de leyenda (máx. 1024) para la imagen activa, con Enter para enviar
- [ ] 5.2 Revisar la tira a ancho de teléfono (375 px): que no genere scroll horizontal de la página y que los controles sean tocables

## 6. Arrastrar y pegar

- [x] 6.1 Exponer `addImages` desde el composer con `ref` como prop (React 19) + `useImperativeHandle`
- [x] 6.2 Zona para soltar en el panel del hilo (`message-thread.tsx`): velo solo si el arrastre trae `Files`, contador de dragenter/dragleave, limpieza en drop/dragend, que respete sesión vencida y solo lectura
- [x] 6.3 `onPaste` en el textarea: tomar imágenes de `clipboardData.files` o `items`; si no hay imágenes, dejar el pegado de texto intacto

## 7. Textos

- [x] 7.1 Agregar las claves nuevas en `messages/es.json`, `en.json` y `ko.json`: límite de 10 alcanzado, N ignoradas, tipo no admitido, archivo demasiado pesado, "Enviando {n} de {total}", "Suelta las imágenes aquí", agregar más

## 8. Verificación

- [x] 8.1 `npm run lint`, `npx tsc --noEmit` y la suite de pruebas en verde
- [ ] 8.2 Prueba manual en local: elegir 4 fotos, agregar 2, quitar 1, leyendas distintas, enviar y revisar el orden en el hilo y en el WhatsApp del celular
- [ ] 8.3 Prueba manual: soltar una foto + un PDF sobre el hilo, pegar una captura con Ctrl+V, pasar de 10 fotos, y verificar con sesión vencida que no se agregue nada
- [ ] 8.4 Prueba manual de fallo parcial (p. ej. cortar la red a mitad de la tanda) y revisar que las burbujas fallidas queden marcadas y el resto salga

## Notas de implementación

- Hallazgo fuera del diseño: `inbox/page.tsx` borraba **todas** las burbujas `temp-` cuando llegaba cualquier fila por realtime. En una tanda, eso hacía desaparecer la foto que seguía en vuelo y las burbujas fallidas. Ahora se reemplaza solo la que corresponde (`src/lib/inbox/optimistic-messages.ts`, `mergeIncomingMessage`): primero por `media_url`, después por tipo y, si no hay coincidencia, la más antigua. Un mensaje del cliente o del bot ya no toca las burbujas optimistas.
