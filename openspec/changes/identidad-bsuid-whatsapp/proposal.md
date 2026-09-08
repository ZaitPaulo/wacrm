## Why

WhatsApp dejó de entregar el teléfono de algunas personas. Cuando alguien adopta un **nombre de usuario**, Meta omite `wa_id` y `from` del webhook y en su lugar manda un **BSUID** (*business-scoped user ID*): un identificador opaco por negocio, con la forma `CO.4481978948757066`.

Todo el camino de entrada asume que el remitente ES un teléfono. `normalizePhone(message.from)` sobre un `from` ausente devuelve cadena vacía, la resolución del contacto no encuentra a quién atribuirle el mensaje, y **el mensaje se descarta**. Hasta el 2026-09-08 ese descarte era mudo: ni fila, ni log, ni forma de enterarse de que esa persona escribió.

Se detectó en producción con un caso real (`HumbertoR` / `RosalesHumberto`, `CO.4481978948757066`), y no es un caso de borde que se vaya a quedar quieto: cada cliente que active la función desaparece del CRM en silencio.

Meta omite el teléfono cuando se cumplen **todas** estas condiciones a la vez, y por eso el síntoma parecía aleatorio:

- la persona adoptó un nombre de usuario,
- no hubo interacción en los últimos 30 días,
- no está en la libreta de contactos del negocio,
- el número del negocio no le ha escrito ni llamado recientemente.

Es decir: **prospectos nuevos**. Justo la gente que un concesionario menos puede permitirse perder.

## What Changes

- La identidad de una persona en WhatsApp deja de ser necesariamente su teléfono. Cuando el webhook no trae número, se usa el BSUID como identidad de canal, y el contacto se crea sin teléfono — algo que el modelo ya admite desde la migración 513.
- El nombre de usuario que informa Meta (`profile.username`) se conserva: para un contacto sin teléfono, es el único identificador legible que un asesor puede reconocer.
- **El envío aprende a hablarle a un BSUID.** Meta pide `recipient` en lugar de `to` para estos destinatarios. Sin esta mitad, los mensajes entrarían a la bandeja y nadie —ni el bot ni el asesor— podría contestar: se cambiaría una pérdida silenciosa por una conversación muerta.
- El reintento por variantes de teléfono (`phoneVariants`) se salta cuando el destinatario es un BSUID: no hay prefijo troncal que corregir en un identificador opaco.
- **El BSUID se registra para TODOS los contactos de WhatsApp, no solo para los que llegan sin teléfono.** Meta lo incluye en todos los webhooks de mensajes, tenga la persona nombre de usuario o no. Registrarlo siempre es lo que evita que la misma persona se duplique el día que active la privacidad: se resuelve al contacto que ya existe.

## Capabilities

### New Capabilities
- `whatsapp-bsuid-identity`: cómo se identifica y cómo se le responde a una persona de WhatsApp cuyo teléfono el negocio no recibe — qué se usa como identidad, qué se guarda, cómo se envía, y por qué la misma persona no se duplica al cambiar de forma de identificarse.

### Modified Capabilities
<!-- Ninguna. La resolución multicanal de la 513 ya contempla identidades
     que no son teléfonos; este cambio la EXTIENDE a un caso que WhatsApp
     no tenía cuando se escribió, sin alterar sus requisitos. -->

## Impact

- `src/app/api/whatsapp/webhook/route.ts` — de dónde sale `sender.externalId`, hoy `normalizePhone(message.from)` a secas. También el guardia de diagnóstico que hoy registra el descarte, que deja de tener sentido en su forma actual.
- `src/lib/inbound/core.ts` — la creación del contacto puebla `phone` con el `externalId` asumiendo que es un número.
- `src/lib/contacts/channel-identity.ts` — el respaldo por teléfono de WhatsApp (`findExistingContact`) no debe correr con un identificador que no es un teléfono: haría comparaciones de dígitos sobre algo que no lo es.
- `src/lib/whatsapp/send-message.ts` — carga el contacto, aborta con `Contact phone number not found` cuando no hay teléfono, y reintenta con variantes del número.
- `src/lib/whatsapp/meta-api.ts` — las siete funciones de envío arman `{ recipient_type, to, ... }`.
- La interfaz de contactos y de la bandeja, donde hoy se muestra el teléfono como identificador de la persona.
- **Sin migración.** `contacts.phone` ya admite NULL y `contact_channels` ya guarda identidades arbitrarias por canal, ambas desde la 513.

## Referencias

- [Business-scoped user IDs](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/)
- [messages webhook reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages)
