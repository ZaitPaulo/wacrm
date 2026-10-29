## Context

`MessageComposer` (`src/components/inbox/message-composer.tsx`) tiene hoy un único `draft: MediaDraft | null`. Cada archivo elegido se sube de inmediato al bucket `chat-media` con `uploadAccountMedia` (`stageUpload`) y queda en preparación hasta que el asesor lo envía con `MediaDraftPreview`. Al enviar se llama a `onSendMedia(payload)`, que en `message-thread.tsx` (`handleSendMedia`) pinta una burbuja optimista y hace POST a `/api/whatsapp/send`. Si el envío falla, borra el objeto del bucket.

Las limitaciones que importan aquí:
- `onSendMedia` se tipa como `=> void`, así que el composer no espera el resultado. Si se disparan varias llamadas seguidas, los POST compiten y el orden en que llegan a Meta no está garantizado.
- El id de la burbuja optimista es `temp-${Date.now()}`. Con dos envíos en el mismo milisegundo, `onUpdateMessage(tempId, …)` actualiza la burbuja equivocada.
- La ruta de envío tiene un límite de 60 envíos por minuto por usuario, y la Graph API tarda entre 3 y 5 s bajo ráfaga desde el VPS (ver memoria de latencia). Una tanda de 10 en secuencia puede tardar entre 30 y 50 s en el peor caso.
- No existe hoy ningún `onPaste` ni `onDrop` en la bandeja.

## Goals / Non-Goals

**Goals:**
- Preparar hasta 10 imágenes por tanda desde el selector, arrastrando o pegando.
- Revisar, quitar y ponerle leyenda a cada imagen antes de enviar.
- Enviar en orden, de a una, sin que un fallo frene el resto.
- No dejar objetos huérfanos en `chat-media`.

**Non-Goals:**
- Varios videos o documentos a la vez. Siguen siendo de a uno.
- Reordenar las miniaturas arrastrándolas. Si se pide después, debe seguir la regla de arrastrar desde toda la superficie.
- Comprimir las fotos del chat. El límite de peso por imagen se mantiene. Si fotos de celular pesadas resultan ser un problema real, `compress-image.ts` es candidato para otro cambio.
- Cambios en `/api/whatsapp/send`, en el esquema o en migraciones.

## Decisions

### 1. Estado: lista de imágenes en preparación + borrador único para lo demás
Se agrega `imageDrafts: ImageDraft[]` con `{ localId, file, previewUrl (object URL), status: 'uploading' | 'ready' | 'error', mediaUrl?, path?, caption }`, y `draft` se deja para video, documento y audio. Las dos cosas son mutuamente excluyentes: preparar imágenes descarta el borrador no-imagen (borrando su objeto, como hoy al reemplazar) y viceversa.

*Alternativa descartada:* convertir `draft` en un arreglo genérico para todo tipo de archivo. Agranda el cambio y obliga a resolver casos que nadie pidió, como mezclar un PDF con fotos o la nota de voz.

La miniatura usa `URL.createObjectURL(file)`, así se ve al instante sin esperar la subida. Hay que revocar esa URL al quitar la imagen, enviarla o desmontar el componente.

### 2. Subida inmediata con concurrencia limitada
Cada imagen se sube apenas entra a la tira, igual que hoy, con un máximo de 3 subidas simultáneas. Así se aprovecha el tiempo en que el asesor escribe leyendas sin saturar la conexión. El tope de 10 se aplica **antes** de subir: lo que sobra no se sube nunca. El peso se valida contra `MEDIA_MAX_BYTES_BY_KIND.image` y el tipo contra `PICKER_ACCEPT.image`, también antes de subir.

*Alternativa:* subir todo al pulsar Enviar. Es más simple, pero el asesor esperaría la subida de las 10 fotos más los envíos uno por uno.

### 3. Envío secuencial esperando el resultado
`onSendMedia` pasa a `(payload) => Promise<boolean>`, que devuelve `true` si el POST respondió bien. El composer recorre la tira con `for … await`, una imagen a la vez. Los fallos no cortan el ciclo: `handleSendMedia` ya marca la burbuja como fallida y borra el objeto. Al terminar, la tira se vacía. Las imágenes enviadas pasan a pertenecer al mensaje, así que no se borran. `replyToId` va solo en la iteración 0, y `onClearReply` se llama una vez, al comienzo.

Mientras dura el envío, el composer muestra "Enviando 3 de 7" y bloquea agregar o quitar imágenes. Si el asesor cambia de conversación a mitad de la tanda, el ciclo sigue con el `conversation` capturado en `handleSendMedia`. No se aborta, porque cortar a la mitad dejaría una tanda incompleta sin que el asesor lo note.

*Alternativa descartada:* enviar en paralelo con `Promise.all`. Con 3 a 5 s de latencia por llamada sería más rápido, pero WhatsApp ordena por la llegada a Meta y las fotos de un carro llegarían desordenadas.

### 4. Id temporal único
`temp-${Date.now()}` se reemplaza por `temp-${crypto.randomUUID()}` en los handlers de envío de `message-thread.tsx`. Si algo depende del prefijo `temp-` para reconocer las burbujas optimistas, se conserva el prefijo.

### 5. Arrastrar y pegar
- **Soltar:** la zona de destino es el panel completo del hilo en `message-thread.tsx`, no solo la barra de escritura, porque es un blanco más grande y fácil de acertar. Muestra un velo de "Suelta las imágenes aquí" solo cuando `dataTransfer.types` incluye `Files`, para no interferir con otros arrastres de la página. El hilo le pasa los archivos al composer mediante un método expuesto con `useImperativeHandle` (`addImages(files)`), así la lógica de validación y subida queda en un solo lugar.
- **Pegar:** `onPaste` en el textarea. Si `clipboardData.files` trae imágenes, se hace `preventDefault` y se agregan. Si solo trae texto, no se hace nada y el pegado sigue normal.
- Ambos caminos respetan `inputsDisabled`.

### 6. UI de la tira
Es un componente nuevo a nivel de módulo, `ImageDraftTray`, siguiendo el mismo criterio que `MediaDraftPreview` para que no se pierda el foco al escribir. Tiene una fila de miniaturas con scroll horizontal (de unos 64 px, cuadradas). Cada una muestra un spinner mientras sube, un indicador si dio error y una X para quitarla. La miniatura activa se resalta con un borde, y debajo hay un único campo de leyenda que edita la imagen activa. Al final de la fila, una casilla "+" abre el selector de nuevo mientras haya menos de 10. Enter en la leyenda envía la tanda, como hoy. En el teléfono, la fila se desplaza horizontalmente sin generar scroll en toda la página.

## Risks / Trade-offs

- [Una tanda de 10 tarda entre 30 y 50 s con la Graph API lenta] → El progreso "N de M" queda visible y las burbujas optimistas aparecen a medida que sale cada una. El asesor puede seguir trabajando en otras conversaciones.
- [Cerrar la pestaña a mitad de la tanda] → Las imágenes que no se alcanzaron a enviar quedan como objetos huérfanos en `chat-media`. Es el mismo riesgo que ya existe hoy con un adjunto suelto, así que se acepta.
- [Pegar desde el portapapeles en Safari o iOS] → Algunos navegadores solo exponen `clipboardData.items`. Se leen ambos, `files` e `items` con `kind === 'file'`.
- [Fotos de más de 5 MB] → Se rechazan una por una con aviso, como hoy. No se comprimen (queda fuera de alcance).
- [El velo para soltar se queda pegado si el arrastre sale de la ventana] → Se usa un contador de `dragenter`/`dragleave` y se limpia en `drop` y `dragend`.

## Migration Plan

Es un cambio solo de frontend: no hay migración ni variables de entorno. Se despliega con el flujo habitual (develop → main → VPS). Para revertir, basta con volver al commit anterior.

## Open Questions

Ninguna bloqueante. Si los asesores piden reordenar la tira, eso va como un cambio aparte.
