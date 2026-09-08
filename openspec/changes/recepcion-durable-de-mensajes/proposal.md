## Why

El webhook de WhatsApp le responde `200` a Meta **antes** de procesar el mensaje: el trabajo corre después, dentro de `after()`. Cuando ese trabajo falla —DNS caído, base inalcanzable, una excepción cualquiera— el mensaje desaparece sin dejar rastro, porque Meta ya recibió su confirmación y no reintenta nunca.

No es hipotético. El 2026-09-08 la resolución DNS del contenedor empezó a fallar de a ratos en producción y se perdieron mensajes de clientes reales: escribieron al concesionario, vieron el doble check en su teléfono, y del lado del CRM no quedó ni el contacto, ni la conversación, ni un error en el log. Nadie podía enterarse de que esas personas habían escrito.

Los arreglos de infraestructura que acompañan a este cambio (resolvers DNS explícitos y ruta interna a Supabase) bajan mucho la probabilidad de que vuelva a fallar, pero **no la llevan a cero**: mientras el `200` salga antes de guardar, cualquier fallo futuro vuelve a perder mensajes en silencio. Esto es lo único que cierra el agujero.

## What Changes

- La recepción se parte en dos fases con una frontera explícita:
  - **Persistencia** — resolver el contacto, resolver la conversación y guardar el mensaje. Son escrituras a la base, rápidas y sin dependencias externas. Ocurre **antes** de responderle a Meta.
  - **Difusión** — flujos, automatizaciones, respuesta de IA, webhooks públicos y los eventos de conversación creada. Es lento y habla con servicios de afuera. Sigue ocurriendo después de la respuesta, en `after()`.
- Si la persistencia falla, el webhook responde **no-200**, para que Meta reintente con su propio backoff en vez de dar el mensaje por entregado.
- Un reintento de Meta no puede duplicar nada: el índice único `(conversation_id, message_id)` de la migración 037 ya hace idempotente el insert, y el camino de replay ya existe y está probado.
- Un fallo en la fase de difusión **no** cambia la respuesta. Ese trabajo es reintentable por otras vías y ya no puede costar el mensaje.
- La verificación de medios contra Meta (`getMediaUrl`) deja de estar en el camino que decide la respuesta: es una llamada de red a un tercero y no puede ser lo que obligue a Meta a reintentar.

## Capabilities

### New Capabilities
- `inbound-message-durability`: qué garantiza el sistema sobre un mensaje entrante entre que Meta lo entrega y queda guardado — cuándo se confirma la recepción, qué se persiste antes de confirmar, qué pasa cuando falla, y por qué un reintento no duplica.

### Modified Capabilities
<!-- Ninguna. `inbound-response-ownership` describe QUÉ responde el sistema ante un
     mensaje ya recibido; este cambio es anterior a esa pregunta y no toca ninguno
     de sus requisitos. -->

## Impact

- `src/app/api/whatsapp/webhook/route.ts` — el `POST` pasa a esperar la fase de persistencia antes de responder, y a devolver no-200 si falla. Es el archivo que hoy documenta por qué se usa `after()`; ese comentario tiene que reescribirse, no borrarse: la razón original (no colgar la respuesta a Meta) sigue siendo válida para la fase de difusión.
- `src/lib/inbound/core.ts` — `processInboundMessage` se separa en las dos fases. Hoy devuelve `void` y se traga todos los fallos; la fase de persistencia tiene que poder informar que no pudo.
- El mismo núcleo lo comparten los tres canales (WhatsApp, Instagram, Messenger). El cambio de forma los afecta a todos aunque solo WhatsApp tenga hoy un manejador conectado.
- `maxDuration = 60` en la ruta: hay que revisar el reparto entre lo que ahora corre dentro de la petición y lo que sigue en `after()`.
- Sin migración. Se apoya en el índice único que ya existe.
