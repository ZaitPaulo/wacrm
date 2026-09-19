## Why

El 2026-09-17 arrancó una campaña de anuncios de Meta con clic a WhatsApp. La revisión del 2026-09-18 mostró tres fallas del bot con esos prospectos:

- **A.** De 36 prospectos del anuncio, 17 (47 %) no volvieron a escribir después de la bienvenida. Nadie contesta su "¿más información sobre esto?": el CRM descarta los datos del anuncio que manda Meta, y la automatización "Bienvenida" le quita el turno a la IA.
- **E.** 6 de los 7 traspasos fueron por crédito, y lo primero que pregunta el asesor es a qué se dedica el cliente y cuánto gana. El bot podía haberlo preguntado antes.
- **I.** El bot a veces nombra un carro sin mandar su enlace, aunque el prompt se lo exige. La causa no es de redacción: el índice de inventario que recibe no trae los enlaces, y solo los traen los 5 extractos de la búsqueda semántica.

## What Changes

- **A.**
  - El webhook guarda el `referral` que Meta adjunta al primer mensaje de un anuncio (titular, texto, URL, id del anuncio, `ctwa_clid`).
  - La IA recibe ese contexto y contesta el primer mensaje del prospecto: saludo, bienvenida y respuesta a "esto".
  - Las automatizaciones ganan una condición nueva, "el mensaje viene de un anuncio". Con ella la Bienvenida puede ceder el turno, y se conserva la regla de una sola respuesta por mensaje entrante.
  - El resumen del traspaso y la conversación muestran que el prospecto vino de un anuncio.
- **E.** Cuando el cliente necesita crédito, el traspaso también pide ocupación e ingresos mensuales aproximados. Nunca se piden cédula, datos bancarios ni documentos. Si el cliente no quiere darlos, el traspaso no se queda bloqueado.
- **I.**
  - Cada línea del índice de inventario lleva el enlace de la ficha.
  - Si una respuesta nombra un vehículo del inventario y no trae su enlace, se agrega antes de enviar.

## Capabilities

### New Capabilities

- `ai-ad-lead-context`: guardar el origen publicitario del prospecto, pasárselo a la IA, que la IA atienda el primer turno de un prospecto de anuncio, y la condición de automatización "viene de un anuncio".

### Modified Capabilities

- `ai-handoff-readiness`: con crédito, el traspaso exige además ocupación e ingresos aproximados, con una salida si el cliente se niega; el asesor los recibe en el resumen.
- `ai-inventory-context`: el índice lleva el enlace de la ficha de cada vehículo, y ninguna respuesta nombra un vehículo del inventario sin su enlace.

## Impact

- **Código:**
  - `src/app/api/whatsapp/webhook/route.ts`: tipo del mensaje y persistencia del referral.
  - `src/lib/inbound/core.ts`
  - `src/lib/ai/`: `auto-reply.ts`, `defaults.ts`, `inventory-index.ts`, `handoff-gate.ts`, `handoff.ts`, `types.ts` y el parser del sentinel.
  - `src/lib/automations/`: la condición nueva y su editor.
- **Base de datos:** una migración nueva (numerada desde 500 y sin chocar con otro número) con la columna del referral en `messages`.
- **Producción:**
  - Hay que reconfigurar la Bienvenida para que, con un mensaje de anuncio, no haga nada.
  - Hay que ajustar el `system_prompt` (reglas de crédito y enlaces), que vive en la base.
- **Tokens:** el índice crece unos 45 caracteres por vehículo, ~2.000 tokens más por respuesta con 136 vehículos.
