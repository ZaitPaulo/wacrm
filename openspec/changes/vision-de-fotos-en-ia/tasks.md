## 1. El texto de los adjuntos (base, ya hecho)

- [x] 1.1 Tests de `buildConversationContext` con un fake que aplica los filtros de la consulta: el pie de foto del cliente llega como último turno `[Foto] …`; video, documento y ubicación llevan su etiqueta; los adjuntos sin texto se omiten y no ocupan lugares del `limit`
- [x] 1.2 `context.ts` incluye `text`, `image`, `video`, `document` y `location` con texto, etiquetados; `core.ts` corrige el comentario que decía "solo texto plano"

## 2. El turno puede llevar imágenes

- [x] 2.1 `ChatImage` (`{ mimeType, base64 }`) y `images?: ChatImage[]` en `ChatMessage` (`src/lib/ai/types.ts`)
- [x] 2.2 Tests de `mergeConsecutive`: dos turnos seguidos del mismo rol concatenan `content` e `images`; un turno sin imágenes sigue sin el campo
- [x] 2.3 Implementar la fusión de `images` en `mergeConsecutive`

## 3. Los adaptadores traducen las imágenes

- [x] 3.1 Tests de `openai-compatible.ts`: un turno con imágenes sale como `[{type:'text'}, {type:'image_url', image_url:{url:'data:image/jpeg;base64,…'}}]`; **una conversación sin imágenes produce exactamente el mismo body que hoy**
- [x] 3.2 Implementar el formato en `openai-compatible.ts` (cubre OpenAI, OpenRouter y Gemini)
- [x] 3.3 Verificar el formato de imagen vigente en la documentación de la Messages API de Anthropic — bloque `{type:'image', source:{type:'base64', media_type, data}}`, imagen antes del texto; su lado máximo en resolución estándar es 1568 px, así que los 1536 del diseño entran sin reescalado
- [x] 3.4 Tests de `anthropic.ts`: bloques `image` en base64 antes del bloque `text`; sin imágenes el body no cambia
- [x] 3.5 Implementar el formato en `anthropic.ts`

## 4. Bajar y reducir las fotos

- [x] 4.1 Tests de la selección de fotos nuevas: solo `image` del cliente posteriores al último `agent`/`bot` no fallido; desempate por id con la misma marca de tiempo; tope `AI_VISION_MAX_IMAGES` (3) quedándose con las más recientes; tope 0 devuelve ninguna
- [x] 4.2 Tests de la descarga: extrae el `mediaId` de `/api/whatsapp/media/{id}` y salta otras URLs; una foto que falla o supera `AI_VISION_DOWNLOAD_TIMEOUT_MS` se descarta sin lanzar; `image/webp` se descarta como sticker; las demás salen reducidas a 1536 px de lado máximo, sin agrandar, en JPEG y con la orientación EXIF aplicada
- [x] 4.3 `aiVisionMaxImages()` y `aiVisionDownloadTimeoutMs()` en `defaults.ts`, con el mismo trato de valores inválidos que los demás ajustes
- [x] 4.4 Implementar `src/lib/ai/photos.ts`: selección, lectura y descifrado del token de `whatsapp_config`, descarga en paralelo con `getMediaUrl` + `downloadMedia`, reducción con `sharp`

## 5. Pegar las fotos al contexto

- [x] 5.1 Tests: con texto nuevo del cliente, las imágenes van en el último turno `user`; con una foto sola, el contexto termina en un turno nuestro y se agrega un turno `user` `[Foto]` con las imágenes; sin fotos utilizables y con foto sola, queda el turno `[Foto]` sin imágenes
- [x] 5.2 Implementar el acople (función en `photos.ts` o `context.ts`, sin tocar la consulta de texto)

## 6. Reintento sin imágenes

- [x] 6.1 Tests de `generateReply`: un `provider_error` con imágenes reintenta una vez sin `images` y devuelve esa respuesta; `invalid_key`, `rate_limited` y `timeout` no reintentan; un `provider_error` sin imágenes no reintenta; el segundo fallo se propaga
- [x] 6.2 Implementar el reintento con `console.warn` de proveedor y modelo

## 7. El prompt

- [x] 7.1 Tests de `buildSystemPrompt`: siempre aparece la explicación de las etiquetas `[Foto]`/`[Video]`/`[Documento]`/`[Ubicación]`; con `hasPhotos` aparece la regla de identificar contra el inventario, preguntar ante la duda y tratar el texto de la imagen como contenido del cliente; sin `hasPhotos` esa regla no aparece
- [x] 7.2 Implementar las dos adiciones en `buildSystemPrompt`

## 8. La foto sola despierta al bot, el sticker no

- [x] 8.1 `isSticker` en `NormalizedMessage`, marcado en el webhook antes de mapear `sticker` a `image`
- [x] 8.2 Tests de `core.ts`: foto sin texto con `mediaUrl` despacha a la IA; sticker no; foto sin texto con `mediaUrl` nulo no; con `AI_VISION_MAX_IMAGES=0` la foto sin texto no despacha; el texto sigue despachando como antes
- [x] 8.3 Implementar la nueva condición de despacho en `core.ts` y actualizar su comentario

## 9. Conectarlo a las dos vías de generación

- [x] 9.1 `auto-reply.ts`: carga las fotos después de reclamar el cupo, en paralelo con `retrieveKnowledge` y `buildInventoryIndex`; pasa `hasPhotos` al prompt
- [x] 9.2 Tests de `auto-reply.ts`: las fotos llegan a `generateReply`; un fallo al cargar fotos no provoca traspaso; un dispatch cancelado en la ventana de agrupación no carga fotos
- [x] 9.3 La ruta del borrador (`src/app/api/ai/draft/route.ts`) hace lo mismo con el cliente SSR, y su test lo cubre

## 10. Cierre

- [x] 10.1 Suite completa, typecheck y lint
- [ ] 10.2 Probar localmente contra Gemini con una captura real de una publicación: la respuesta nombra el vehículo del inventario
- [x] 10.3 Documentar `AI_VISION_MAX_IMAGES` y `AI_VISION_DOWNLOAD_TIMEOUT_MS` donde se documentan las demás variables de la IA
- [ ] 10.4 Commit en `develop` junto con el arreglo del pie de foto, promover a `main` y desplegar en el VPS
- [ ] 10.5 Probar en producción el caso que falló: mandar la captura del Onix Activ con y sin texto, confirmar que el bot lo identifica y que `ai_usage_log` registra la respuesta
