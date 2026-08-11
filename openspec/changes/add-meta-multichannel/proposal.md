## Why

Un cliente preguntó en la demostración si el sistema recibe mensajes de Instagram y Messenger además de WhatsApp. Hoy la respuesta es no, y no de forma parcial: **no hay ninguna noción de canal en todo el producto**.

Tres hechos del código lo delimitan:

- El webhook (`src/app/api/whatsapp/webhook/route.ts:219-231`) recorre `entry[].changes[]`, que es la forma de WhatsApp Cloud API. Instagram y Messenger llegan como `entry[].messaging[]`: el código actual no reconocería el cuerpo.
- `conversations` (`001_initial_schema.sql:140`) no tiene columna de canal, plataforma ni origen. Toda conversación asume WhatsApp implícitamente.
- La identidad de una persona **es su teléfono**: `contacts.phone` es `NOT NULL` y `findExistingContact()` deduplica normalizando ese número. Instagram y Messenger no entregan teléfono, entregan un identificador interno de Meta. Un contacto que escribe por Instagram hoy no tendría con qué crearse.

Lo que juega a favor es que los tres canales son de Meta y comparten registro de aplicación, verificación de firma de webhook y Graph API. Y todo lo que da valor al producto —inventario, márgenes, tablero, asistente con IA, vitrina— es indiferente al canal por el que llegó el mensaje. Lo que falta es la capa de entrada y salida.

## What Changes

- **La identidad deja de ser el teléfono.** Una persona pasa a poder tener varias identidades, una por canal. El teléfono queda como una de ellas, no como la llave.
- **La conversación declara su canal.** Cada hilo sabe por dónde entró, porque de eso dependen las reglas de qué se puede responder y por dónde sale la respuesta.
- **El webhook enruta por tipo de evento** en lugar de asumir que todo cuerpo es de WhatsApp.
- **El envío se resuelve por canal**, detrás de una única puerta de salida, en vez de hablarle directo a la API de WhatsApp.
- **Cada canal declara su ventana de respuesta** y qué se permite fuera de ella. No son iguales entre canales y hoy la regla de WhatsApp está incrustada como si fuera universal.
- **La bandeja muestra el canal** de cada conversación, y permite filtrar por él.

**Compatibilidad.** Las instalaciones existentes siguen operando sin intervención: toda conversación y todo contacto actual se tratan como WhatsApp, y la URL de webhook ya registrada en Meta sigue siendo válida. Este change **no rompe nada de lo que hoy funciona**.

**Fuera de alcance**

- Unificación automática de la misma persona entre canales. Se registra la sospecha y se ofrece vincular; fusionar sin intervención humana mezcla historiales de clientes distintos y es un daño difícil de revertir.
- Canales fuera de Meta (Telegram, correo, chat web). El diseño no debe impedirlos, pero no se construyen aquí.
- Difusiones por Instagram y Messenger. Las políticas de mensajería masiva son distintas por canal y merecen su propio análisis.
- Publicación o gestión de contenido en redes. Esto es mensajería, no manejo de redes sociales.

## Capabilities

### New Capabilities
- `channel-identity`: cómo se identifica a una persona en cada canal, cuándo dos identidades son la misma y por qué la fusión no es automática.
- `multichannel-inbox`: recepción, atención y respuesta de conversaciones de varios canales en una sola bandeja.
- `channel-messaging-rules`: la ventana de respuesta de cada canal y qué puede enviarse dentro y fuera de ella.

### Modified Capabilities
<!-- Ninguna. Las capacidades documentadas (`ai-reply-gating`, `flow-handoff-routing`, `spanish-locale`, y las cuatro de compraventa) no cambian sus requisitos: operan sobre la conversación con independencia del canal. -->

## Impact

**Base de datos**
- Migración en el rango 510+ (la última es `509` si se implementa antes `package-commercial-offering`; si no, `509`).
- Tabla de identidades por canal; columna de canal en `conversations`. `contacts.phone` deja de ser la llave pero **no se elimina**: sigue siendo válido y poblado para WhatsApp.

**Código afectado**
- `src/app/api/whatsapp/webhook/route.ts` — enrutado por tipo de evento; el núcleo de procesamiento se extrae para reutilizarlo.
- `src/lib/contacts/dedupe.ts` — la búsqueda deja de asumir teléfono.
- `src/lib/whatsapp/resolve-conversation.ts` — resolver por identidad de canal, no por número.
- `src/lib/whatsapp/send-message.ts` — puerta de salida única con selección de canal.
- `src/lib/automations/meta-send.ts` y `src/lib/flows/meta-send.ts` — **dos rutas de envío paralelas ya existentes**; ambas hablan directo con la API de WhatsApp y las dos tendrían que pasar por la puerta común.
- `src/lib/ai/reply-window.ts` — la ventana pasa a depender del canal.
- Bandeja y lista de conversaciones — indicador y filtro por canal.
- `messages/{es,en,ko}.json`.

**Riesgos**
- **Responder por el canal equivocado.** Es el peor fallo posible: contestarle por Instagram a quien escribió por WhatsApp, o peor, a otra persona. El canal debe resolverse desde la conversación y nunca inferirse.
- **Fusionar dos clientes distintos.** Por eso la unificación no es automática.
- **Tres caminos de envío.** Ya hoy conviven `send-message.ts` y dos `meta-send.ts`. Sumar canales sin unificarlos multiplica el problema por tres.
- **Las reglas de ventana cambian del lado de Meta.** Los plazos y las condiciones fuera de ventana los fija Meta y varían con el tiempo; deben leerse de la documentación vigente al implementar y quedar en un solo lugar del código, no repartidas.

**Esfuerzo estimado**
- Del orden de 3 a 5 semanas. El punto delicado no es técnico sino de modelo: decidir cuándo dos identidades son la misma persona.
