## Why

Los asesores mandan muchas fotos de un mismo vehículo por chat, pero el composer de la bandeja solo deja adjuntar **una imagen a la vez**. El selector no tiene `multiple`, solo se lee `files?.[0]` y el estado guarda un único borrador. Mandar diez fotos de un carro implica repetir diez veces el ciclo abrir menú → elegir → enviar. Es lento y es justo el tipo de mensaje que más se repite en una compraventa.

## What Changes

- El selector de imágenes del composer acepta **varias imágenes a la vez**, hasta 10 por tanda.
- Se pueden **arrastrar** imágenes desde el explorador o el escritorio y soltarlas sobre el hilo, y también **pegarlas** con Ctrl+V en el campo de texto.
- Las imágenes elegidas se muestran en una **tira de miniaturas**. Ahí se puede ver cada una, quitarla o escribirle su propia leyenda antes de enviar. Se pueden agregar más hasta llegar a 10.
- Al enviar, las imágenes salen **una tras otra, en el orden de la tira**, cada una como un mensaje independiente. La API de Meta no tiene álbumes: es un archivo por mensaje, y el WhatsApp del cliente las agrupa visualmente. Si el asesor estaba respondiendo a un mensaje, la cita va solo en la primera.
- Si un envío falla, el resto sigue saliendo. La burbuja fallida queda marcada como hoy.
- Se corrige el id temporal de las burbujas optimistas (`temp-${Date.now()}`), que choca cuando se envían varios mensajes en el mismo milisegundo.
- Video, documento y nota de voz siguen como hoy: un adjunto a la vez.

## Capabilities

### New Capabilities
- `inbox-multi-image-attachments`: adjuntar, revisar y enviar varias imágenes en una sola tanda desde el composer de la bandeja (selector múltiple, arrastrar, pegar, tira de miniaturas con leyenda por imagen, envío secuencial y ordenado, límite de 10).

### Modified Capabilities
<!-- Ninguna: no existe hoy un spec del composer ni del envío de adjuntos. -->

## Impact

- `src/components/inbox/message-composer.tsx`: el estado pasa de un borrador único a una lista de imágenes en preparación. Hay que agregar el selector múltiple, el manejo de pegado, la tira de miniaturas y el envío secuencial.
- `src/components/inbox/message-thread.tsx`: zona para soltar archivos sobre el hilo. `handleSendMedia` tiene que devolver una promesa con el resultado, para que el composer pueda esperar y conservar el orden. También cambia el id temporal, que ya no puede depender solo de `Date.now()`.
- `messages/es.json`, `en.json`, `ko.json`: textos nuevos (límite alcanzado, enviando N de M, soltar aquí).
- Sin cambios en la API (`/api/whatsapp/send`), ni en la base de datos, ni en migraciones. El límite de 60 envíos por minuto por usuario alcanza de sobra para tandas de 10.
- Sirve para cualquier canal que ya acepte imágenes desde el composer (WhatsApp, Instagram y Facebook), porque se reutiliza la misma ruta de envío.
