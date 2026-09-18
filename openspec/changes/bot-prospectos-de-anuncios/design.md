## Context

La revisión del 2026-09-18 cubrió las primeras ~16 h de la campaña de anuncios de Meta con clic a WhatsApp. El anuncio es **general del concesionario**, no de un vehículo, y Meta prellena el mensaje con su texto por defecto: "Hola. ¿Puedo obtener más información sobre esto?".

Estado actual:

- `route.ts` no declara ni lee `messages[].referral`: el dato llega en el payload y se pierde.
- La automatización "Bienvenida" (`first_inbound_message`) manda dos mensajes. El auto-reply ve un saliente posterior al entrante (`hasOutboundSince`) y se abstiene. Así funciona el spec `ai-reply-gating`, "exactamente una respuesta por mensaje entrante", y el cambio no lo modifica.
- El gate de traspaso (`handoff-gate.ts`) exige `nombre`, `presupuesto`, `interes` y `credito`. `ai_handoff_attempts` cuenta los rechazos.
- El índice de inventario (`inventory-index.ts`) arma una línea por vehículo sin enlace. El enlace solo sale en los extractos de RAG (`knowledge-sync.ts`: "Ficha con fotos: <base>/vehiculo/<id>").

## Goals / Non-Goals

**Goals:**

- Que el prospecto de anuncio reciba de la IA una respuesta a su primer mensaje con contexto del anuncio.
- Que el asesor reciba el perfil de crédito ya preguntado.
- Que cada vehículo nombrado llegue con su enlace, garantizado por código y no solo por el prompt.

**Non-Goals:**

- Atribución de conversiones a Meta (Conversions API con `ctwa_clid`). Se guarda el dato, pero no se reporta.
- Reportes de rendimiento por anuncio.
- Transcripción de audios y el punto D de la revisión (insistencia en el nombre); van en cambios aparte.
- Instagram y Messenger: los anuncios de la campaña son de WhatsApp.

## Decisions

### 1. Cómo se guarda el referral: columna `messages.referral jsonb`

El referral es un dato del mensaje que lo trajo, igual que `interactive_payload`. Tener el JSON completo permite leer después campos que hoy no se usan (`image_url`, `ctwa_clid`).

- *Alternativa descartada: guardarlo en `conversations`.* Pierde cuál mensaje lo trajo, y una conversación puede recibir clics de dos anuncios en días distintos.
- *Alternativa descartada: una tabla `ad_referrals`.* Es más estructura de la que hace falta para leerlo en el prompt y en la bandeja.

`NormalizedInbound` gana un campo opcional `referral`, y `persistInbound` lo escribe en el upsert. Instagram y Facebook no lo llenan.

### 2. Quién atiende el primer turno: la automatización cede con una condición nueva

Se agrega el sujeto de condición `from_ad` al motor de automatizaciones: es verdadero si el mensaje disparador trae referral. El contexto de la automatización ya lleva `message_text`, y se le suma `from_ad`. La Bienvenida de producción se reconfigura así: raíz "viene de un anuncio" → sí: nada; no: la condición de etiqueta `propietario` y el saludo actual.

- *Alternativa descartada: que la IA responda aunque la automatización ya haya respondido cuando hay referral.* Rompe `ai-reply-gating`, y el cliente recibiría bienvenida y respuesta de IA pegadas: tres mensajes para un "más información".
- *Alternativa descartada: saltarse la automatización de forma fija en código para los mensajes de anuncio.* Le quita el control al usuario, que es quien arma la Bienvenida desde el builder.

La bienvenida no se pierde: el prompt ya obliga a la IA a saludar y dar la bienvenida en su primer mensaje. El prompt de sistema no lleva el link al catálogo ni las redes; se agrega al `system_prompt` que, si viene de anuncio, mencione la vitrina `loramotors.co`.

### 3. Qué ve la IA del anuncio: una sección del prompt, no un mensaje

`buildSystemPrompt` recibe un `adContext` opcional (titular y texto del referral más reciente de la conversación) y agrega una sección corta: "El cliente llegó desde un anuncio: <titular> / <texto>. Si pregunta por 'esto', se refiere a ese anuncio". Se lee con una consulta al último mensaje de cliente con `referral` no nulo. Va en el system prompt porque el contexto de conversación (`context.ts`) solo lleva texto de mensajes.

### 4. Perfil de crédito: dos campos opcionales en el sentinel y una salida propia

- `HandoffRequest` gana `ocupacion` e `ingresos` (string o null).
- El parser del sentinel los lee.
- `evaluateHandoffGate` exige esos dos campos solo cuando `credito === true`.
- La salida: si `attempts >= 1` y los únicos campos que faltan son `ocupacion` o `ingresos`, se transfiere. `attempts` no distingue el motivo del rechazo anterior. Lo aceptamos: al llegar a ese punto los cuatro datos de venta ya están, y el perfil de crédito ahorra tiempo pero no es condición para vender.
- `buildHandoffSummary` agrega "Ocupación · Ingresos" cuando hay crédito.
- `buildGateRetryInstruction` ya pide "los campos que faltan"; se le agregan nombres legibles para los dos nuevos.

### 5. Enlaces garantizados: índice con URL, más un post-proceso determinista

- **Índice:** cada línea agrega ` · <base>/vehiculo/<id>`. La base es la misma `SITE_URL` que usa `knowledge-sync`. `buildInventoryIndex` devuelve también las entradas estructuradas (`{ id, model, year, price, url }`) para el post-proceso.
- **Post-proceso** (`ensureVehicleLinks(text, entries)`): función pura que corre sobre el texto final, antes de enviarlo.
  - Normaliza el texto (minúsculas y sin tildes).
  - Por cada entrada cuyo modelo **y** año aparezcan en el texto y cuya URL no esté, agrega "Ficha: <url>".
  - Si varias entradas coinciden en modelo y año, busca el precio en el texto para desempatar; si no desempata, agrega las de todas, hasta 3.
- *Alternativa descartada: regenerar con una instrucción de reintento.* Cuesta una generación más y no garantiza nada.
- *Alternativa descartada: solo reforzar el prompt.* Es lo que falla hoy, y aunque el índice traiga URL, el modelo puede omitirla.

Match por modelo: se usa el modelo del inventario tal cual ("SORENTO RADICAL", "MARCH ADVANCE"), normalizado. "Kia Sorento 2015" no coincide con "SORENTO RADICAL"; se prueba primero el modelo completo y después su primera palabra, junto con el año.

## Risks / Trade-offs

- **[Riesgo] La primera palabra del modelo es ambigua** ("NEW", "ALL"): "Kia New Sportage 2011" contra "NEW SPORTAGE LX". → Se descartan las primeras palabras genéricas (`new`, `all`, `nuevo`) al tomar el token de match.
- **[Riesgo] Enlaces agregados que rompen el estilo "humano".** → Solo se agregan cuando faltan, y al final. Con el índice llevando URL, el caso debería volverse raro.
- **[Riesgo] Más tokens.** Unos 45 caracteres por vehículo, ~2.000 tokens más por respuesta con 136 vehículos. El promedio medido el 2026-09-17 es ~10.800 tokens por respuesta. → Se acepta.
- **[Riesgo] Meta cambia la forma del referral.** → Se guarda el JSON crudo, y el prompt solo usa `headline` y `body`, con guardias.
- **[Trade-off] La Bienvenida de producción hay que reconfigurarla a mano** después del despliegue. Hasta entonces, el prospecto de anuncio sigue recibiendo la bienvenida genérica y la IA no contesta su primer mensaje.

## Migration Plan

1. Migración `5NN_message_referral.sql`, con el siguiente número libre verificado contra `supabase/migrations` y los cambios abiertos: `ALTER TABLE messages ADD COLUMN IF NOT EXISTS referral jsonb`.
2. Desplegar código (`develop` → `main` → VPS).
3. En producción:
   - Ajustar la Bienvenida: la condición `from_ad` como raíz.
   - Ajustar el `system_prompt`: la regla de crédito pide ocupación e ingresos, y los enlaces vienen en el índice.
4. Rollback: revertir el commit. La columna nueva es inofensiva y puede quedar.

## Open Questions

- ¿El mismo texto sirve para todos los anuncios, o conviene que cada anuncio lleve un mensaje prellenado propio? Hoy es uno general.
- ¿Qué rango de ingresos considera viable el aliado financiero? Hoy solo se recoge el dato, sin filtrar.
