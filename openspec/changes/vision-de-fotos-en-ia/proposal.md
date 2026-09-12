## Why

El 2026-09-12 un cliente mandó por WhatsApp la captura de nuestra propia publicación de Instagram —un Chevrolet Onix Activ 2019, con kilometraje, precio y placas a la vista— y escribió en el pie de foto que le interesaba el crédito. El bot le contestó que le asignaba un asesor sin haber leído nada: el modelo solo recibe texto, y además el pie de foto se descartaba por venir en un mensaje de tipo `image`. Gemini recibió una conversación sin la pregunta, respondió 400 y el hilo se traspasó como "fallo del proveedor".

El pie de foto ya está arreglado (`src/lib/ai/context.ts` lo entrega como `[Foto] …`), pero eso solo cubre al cliente que escribe el modelo del carro. El que manda la captura con un "¿este cuánto?" —o la foto sola, que hoy ni siquiera despierta al bot— sigue sin respuesta útil. Y la foto trae justo lo que hace falta: con el índice completo del inventario ya en el prompt, un modelo que la vea puede reconocer el vehículo sin preguntarle nada al cliente. Gemini, el proveedor de la cuenta, entiende imágenes.

## What Changes

- El auto-reply **ve las fotos nuevas del cliente**: las que llegaron después de nuestra última respuesta, con un tope por generación. Las fotos ya respondidas y las que enviamos nosotros no se vuelven a mandar.
- **Una foto sin texto despierta al bot**, igual que un mensaje escrito. Los stickers no, aunque se guarden como imagen.
- El botón ✨ de redactar recibe las mismas fotos, para que el borrador que se le propone al asesor también sepa de qué carro se habla.
- El prompt gana una regla: ante una foto, identificar el vehículo contra el índice del inventario; si no hay coincidencia clara, preguntar, y nunca atribuirle a la foto un vehículo que no está en el índice.
- Las fotos se reducen antes de enviarlas, para acotar el costo en tokens de la clave del titular.
- **Si una foto no se puede usar, se responde igual con el texto.** Descarga lenta, medio vencido en Meta o un modelo sin visión degradan a la etiqueta `[Foto]`; nunca terminan en un traspaso por fallo técnico.
- Se publica junto con el arreglo del pie de foto, que es su base.

**Fuera de alcance**

- Videos, documentos y audios: siguen entrando solo por su texto (pie, nombre del archivo). Un PDF de extracto o una nota de voz son otro análisis.
- Instagram y Messenger como canales de entrada (`add-meta-multichannel`). Este cambio es solo WhatsApp, pero no debe atar la visión a la API de medios de WhatsApp más de lo necesario.
- Guardar las imágenes. Se descargan de Meta en el momento y no se persisten.

## Capabilities

### New Capabilities

- `ai-photo-understanding`: qué ve el asistente de los adjuntos del cliente — el texto de cualquier adjunto, las fotos nuevas como imagen, cuándo una foto despierta al bot, y cómo se degrada cuando una foto no se puede usar.

### Modified Capabilities

Ninguna. `ai-reply-gating` no cambia sus requisitos: una foto sin texto pasa a ser un mensaje entrante más, sujeto a las mismas compuertas, ventana de agrupación y regla de una respuesta por entrante. `ai-inventory-context` tampoco: el índice sigue siendo el mismo, solo que ahora también se usa para reconocer lo que aparece en una foto.

## Impact

- `src/lib/ai/types.ts`: un turno de conversación puede llevar imágenes además de texto.
- `src/lib/ai/context.ts`: marca qué fotos del cliente son nuevas y las carga.
- Módulo nuevo en `src/lib/ai/` que baja la foto de Meta (`getMediaUrl` + `downloadMedia` de `src/lib/whatsapp/meta-api.ts`) y la reduce con `sharp`, que ya es dependencia.
- `src/lib/ai/providers/openai-compatible.ts` y `anthropic.ts`: cada uno arma la imagen en su propio formato.
- `src/lib/ai/generate.ts`: reintento sin imágenes cuando el proveedor las rechaza.
- `src/lib/ai/defaults.ts`: la regla de la foto en el prompt.
- `src/lib/inbound/core.ts` y el webhook: la foto sin texto despierta al bot; el sticker no.
- `src/app/api/ai/draft/route.ts`: el borrador recibe las fotos.
- Sin migración.
- **Latencia:** cada foto son dos llamadas a Meta, que desde el VPS tardan 0.5–1 s en reposo y 3–5 s bajo ráfaga. Se suman a la respuesta del bot.
- **Costo:** sube el consumo de tokens de entrada solo en las respuestas que llevan fotos, acotado por el tope y la reducción.
