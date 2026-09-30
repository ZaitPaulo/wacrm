## Context

`dispatchInboundToAiReply` (`src/lib/ai/auto-reply.ts`) hace lo siguiente: agrupa la ráfaga de mensajes, reclama un turno de respuesta, arma el contexto y llama a `generateReply`. Con lo que responde el modelo hay tres caminos:

1. **Pide traspaso y la compuerta lo acepta.** Llama a `handOffToHuman`, que asigna al asesor y manda el aviso con `notifyCustomerOfHandoff`. **El `text` que acompañaba al marcador se descarta.**
2. **Pide traspaso y la compuerta lo rechaza.** Envía `text` (o una regeneración que pide los datos que faltan).
3. **No pide traspaso.** Envía `text`.

Cualquier excepción cae en el `catch`, que traspasa con la nota "⚠️ La IA no pudo responder".

El aviso (`src/lib/handoff/notify-customer.ts`) lee `Handoff.customerNotice*` de `messages/<locale>.json` y lo usan tanto la IA como los flujos. Para el horario ya existen `parseHorario`, `dentroDeHorario` y `proximaApertura` en `src/lib/outbound/business-hours.ts`, que calculan con la hora local del proceso. El contenedor corre con `TZ=America/Bogota`.

El selector de plantillas (`src/components/inbox/template-picker.tsx`) exige llenar cada variable, no conoce al contacto y no valida el contenido. Lo usan `message-thread.tsx` y `contact-detail-view.tsx`.

## Goals / Non-Goals

**Goals:**
- Que ninguna respuesta de la IA llegue al cliente con fugas de sus instrucciones.
- Que un traspaso no deje sin contestar la última pregunta del cliente.
- Que un fallo pasajero del proveedor no termine en traspaso.
- Que el cliente sepa cuándo lo contactan tras el traspaso.
- Que no vuelvan a salir plantillas con valores de relleno como "Hola 1".

**Non-Goals:**
- Que el bot siga respondiendo después del traspaso (estado "esperando asesor"). Eso es la Fase 2.
- Las alertas por traspasos sin atender y los cambios en la compuerta de datos (nombre como peaje). También Fase 2.
- Las reglas de negocio del prompt y de la base de conocimientos (crédito por año, cifras de inicial). Eso es la Fase 3 y son datos, no código.
- Las variables de las difusiones: el caso "Hola 1" salió del selector manual. `resolveVariables` de las difusiones no se toca.

## Decisions

### 1. Filtro de salida como función pura en `src/lib/ai/output-guard.ts`

`detectLeak(text): { leaked: boolean; reason?: string }`. Es pura y sin I/O, igual que `evaluateHandoffGate`, así que se prueba con casos reales del log. Aplica tres reglas, en orden de certeza:

1. `\[\[` o una asignación de campo del marcador (`/\b(nombre|presupuesto|interes|credito|motivo|ocupacion|ingresos)\s*=/i`).
2. Términos internos: `handoff`, `sentinel`, `system prompt`, `gate` como palabra suelta.
3. Proporción de palabras funcionales en inglés (una lista cerrada de ~40: the, you, if, is, are, and, only, once, while, missing, must, should, this, that…) sobre el total de palabras. Marca fuga si es ≥ 15 % y hay al menos 6 coincidencias.

La regla 3 usa **palabras funcionales**, no una detección de idioma genérica, porque los nombres de vehículos ("GT Line", "Touring", "Active Tourer") son sustantivos y no suben esa cuenta.

*Alternativa descartada:* pedirle al modelo que se autoevalúe. Duplica el costo y el modelo que se equivocó es el mismo que juzga.

### 2. Dónde se aplica el filtro

La función `generateSafeReply` en `auto-reply.ts` envuelve `generateReply`:

- genera la respuesta;
- si `text` tiene fuga, regenera una vez agregando al system prompt `LEAK_RETRY_INSTRUCTION` (responder solo al cliente, en español, sin explicar el razonamiento ni las reglas);
- si la segunda respuesta también tiene fuga, devuelve `SAFE_FALLBACK_TEXT` y hace `console.error` con el id de la conversación.

La regeneración conserva el `handoff` que haya declarado. Si la segunda llamada no trae marcador pero la primera sí, se usa el de la primera, porque la fuga está en el texto y no en la intención.

Se usa en los tres caminos:

- en el camino 2 también se filtra la regeneración con `buildGateRetryInstruction`;
- `SAFE_FALLBACK_TEXT` vive en `messages/es.json` bajo `AiReply.safeFallback` y se lee como `notice()`: import dinámico por locale, con constante de respaldo.

### 3. Reintento ante fallo del proveedor

El reintento va en `auto-reply.ts`, no en `generate.ts`, porque necesita `hasNewerCustomerMessage` (acceso a la BD) y `generate.ts` es agnóstico. `generateSafeReply` captura `AiError` con código `timeout`, `network_error`, `rate_limited`, `provider_error` o `empty_response`, espera `aiProviderRetryDelayMs()` (3 s por defecto; variable `AI_PROVIDER_RETRY_DELAY_MS`; 0 en pruebas, igual que `aiReplyDebounceMs`) y vuelve a comprobar si el cliente escribió algo nuevo:

- si escribió, abandona el dispatch lanzando `SupersededError`, que el `catch` principal ignora sin traspasar;
- si no, reintenta una vez;
- `invalid_key` y los errores que no son `AiError` se propagan de inmediato.

El reintento de `generateReply` por fotos rechazadas sigue igual. Se anida: en el peor caso, dos intentos por fotos × dos por fallo.

*Alternativa descartada:* reintentar en el `catch` general. Ese `catch` también atrapa errores de la BD y de envío, y reintentarlos repetiría envíos.

`hasNewerCustomerMessage` se vuelve a comprobar después de generar, como ya se hace hoy.

### 4. El traspaso manda primero el texto

En el camino 1, antes de `handOffToHuman`: si `text` no está vacío, se envía con `engineSendText(... withVehicleLinks(text, inventory) ...)` y `aiGenerated: true`. Si ese envío falla, se registra y **el traspaso sigue**, porque el aviso y la asignación importan más.

### 5. Aviso con expectativa de tiempo

`notifyCustomerOfHandoff` recibe `accountId`, que ya tiene. Una función pura nueva, `handoffWhen(config, now): { kind: 'soon' } | { kind: 'today' | 'tomorrow' | 'weekday'; weekday?: number; time: string } | null`, vive en `src/lib/handoff/when.ts` y se prueba con fechas fijas. La lectura de `accounts` (`quiet_hours_enabled`, `business_hours`, `holiday_calendar`) se hace en `notify-customer.ts` con `supabaseAdmin`. Si la lectura falla, `when` queda `null` y el aviso sale como hoy.

Los textos van en `messages/*.json`, con las claves `Handoff.whenSoon`, `whenToday`, `whenTomorrow` y `whenWeekday`, y los días en `Handoff.weekdays`. El aviso final es la frase actual más una frase de tiempo, así cada idioma decide el orden. La hora se formatea como `h:mm a. m.` en español: `Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit' })`.

### 6. Selector de plantillas

`TemplatePicker` recibe una prop opcional `contactName?: string | null`. La lógica pura va en `src/lib/whatsapp/template-prefill.ts`:

- `greetingVariableIndices(bodyText): number[]` busca `{{n}}` precedido por un saludo;
- `firstNameForGreeting(name): string | null`;
- `isPlaceholderValue(v): boolean`, que marca `/^\d+$/` o un solo carácter tras `trim`.

Al elegir la plantilla, se llenan esos índices con el primer nombre. `canConfirm` exige además `!isPlaceholderValue` para cada variable del cuerpo, y el campo muestra el aviso `Inbox.templatePicker.placeholderValueHint`. Quien llama pasa `conversation.contact?.name` o `contact.name`.

## Risks / Trade-offs

- **[El filtro marca una respuesta legítima como fuga]** → Se regenera una vez, así que el costo de un falso positivo es una llamada extra y no un mensaje perdido. Las pruebas usan las 1.879 respuestas del log como corpus negativo, y la regla 3 exige un umbral doble (proporción y cantidad).
- **[El reintento suma hasta ~3 s + otra generación de latencia]** → Solo cuando algo ya falló. La alternativa hoy es un traspaso que tarda horas en atenderse.
- **[Mandar texto + aviso son dos mensajes seguidos]** → Es lo que el cliente necesita: la respuesta y luego quién lo atiende. El orden se garantiza porque los envíos se esperan uno tras otro.
- **[La hora del servidor]** → `business-hours.ts` usa la hora local, y el despliegue fija `TZ=America/Bogota`. Si alguien quita esa variable, el aviso diría una hora corrida. Ese riesgo ya existe hoy en el silencio fuera de horario.
- **[El primer nombre sale raro, por ejemplo "Dios" de "Dios es amor"]** → Es editable, y el asesor lo ve antes de enviar. Es mejor que un campo vacío que invita a escribir "1".
