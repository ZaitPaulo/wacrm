## Context

`POST /api/whatsapp/webhook` valida la firma, responde `200` y encola el trabajo con `after()`. Ese orden fue una decisión deliberada y está comentada en el archivo: procesar antes de responder colgaba la respuesta a Meta, y una confirmación lenta dispara reintentos y trabajo duplicado. La elección de `after()` sobre una promesa suelta también fue deliberada, y arregló un bug real (issue #301): en serverless el proceso puede congelarse apenas sale la respuesta, y las escrituras de una promesa flotante no llegaban a completarse.

Lo que ninguna de esas dos decisiones cubre es qué pasa cuando el trabajo **corre completo y falla**. Ahí el `200` ya salió, Meta considera el mensaje entregado, y no hay nadie que reintente. El 2026-09-08 el DNS del contenedor empezó a fallar de a ratos y esa combinación borró mensajes de clientes reales sin dejar rastro.

Restricciones que enmarcan el diseño:

- **El núcleo es compartido.** `processInboundMessage` en `src/lib/inbound/core.ts` lo usan los tres canales. Cualquier cambio de forma los afecta a todos.
- **La idempotencia ya existe y está probada.** El índice único `(conversation_id, message_id)` de la migración 037, con `ignoreDuplicates`, hace que un replay no inserte nada y que el `.select()` vuelva vacío. Todo el corte de replay del issue #367 cuelga de ahí.
- **Meta ya reintenta.** Ante una respuesta que no es `200`, reentrega con frecuencia decreciente **hasta 7 días** (Cloud API; el webhook genérico de Graph API son 36 h, que no es nuestro caso). La propia documentación advierte que esos reintentos pueden llegar duplicados. Es un mecanismo de durabilidad que ya está pagado y hoy no se usa.
- **La difusión es lenta y externa.** Verificación de medios contra Meta, motor de flujos, automatizaciones, IA y webhooks de terceros. Los tests ya documentan despachos de IA que se sostienen 8 segundos.

## Goals / Non-Goals

**Goals:**

- Que un mensaje entrante no se pierda cuando la persistencia falla.
- Que el fallo se traduzca en un reintento de Meta, no en un `200` mentiroso.
- Que un reintento nunca duplique un mensaje ni vuelva a hablarle al cliente.
- Que un fallo de difusión no arrastre a la respuesta.
- No cambiar el comportamiento observable cuando todo funciona.

**Non-Goals:**

- **No** se garantiza que la difusión ocurra. Si el proceso muere entre el guardado y la difusión, el mensaje queda en la bandeja sin respuesta automática. Es un resultado degradado y visible —una persona lo ve y lo atiende—, no una pérdida. Cerrarlo pediría una cola persistente, y eso es otro cambio.
- **No** se introduce tabla de eventos, cola ni reintento propio.
- **No** se toca el orden de despacho entre flujos y automatizaciones (`inbound-response-ownership` sigue igual).
- **No** se toca la verificación de firma.

## Decisions

### 1. Partir en dos fases y apoyarse en el reintento de Meta, en vez de una cola propia

La frontera es el insert del mensaje. Antes de responder corre lo que es solo base y rápido: contacto, conversación, insert, y los ajustes que cuelgan de él (contador de no leídos, reapertura, respuesta a difusión, atribución de vehículo). Después de responder corre lo lento y externo.

*Alternativa considerada — tabla `webhook_events` con reintento por cron:* guardar el cuerpo crudo, responder `200`, procesar aparte y reintentar lo que falló. Es más robusto: sobrevive a que el contenedor muera a mitad. Se descarta por ahora porque exige migración, un runner de reintentos, y trae un modo de fallo nuevo que hoy no existe —el rezago silencioso, una cola que crece sin que nadie mire—. Meta ya ofrece backoff durante días sin que tengamos que operar nada. Si algún día hace falta la garantía sobre la difusión, esa es la puerta.

*Alternativa considerada — procesar todo dentro de la petición:* es lo más simple de leer y lo peor de operar. Con IA y verificación de medios adentro, la respuesta se va por encima de la ventana de Meta; Meta reentrega por timeout, y cada reentrega vuelve a arrancar el mismo trabajo lento. Es exactamente el problema que el `after()` vino a resolver.

### 2. Fallo transitorio responde 500; fallo permanente responde 200

No todo fallo merece reintento. Un `phone_number_id` que no corresponde a ninguna configuración va a dar el mismo resultado en cada intento hasta que Meta se rinda, y solo llena el panel de entregas fallidas con ruido que tapa los fallos que sí importan. Se registra y se descarta con `200`, que es lo que ya hace hoy.

La misma lógica para varias configuraciones con el mismo número, y para un cuerpo sin mensajes.

Lo que sí devuelve `500` es lo que puede salir bien en el siguiente intento: la base inalcanzable, un error inesperado de escritura, una excepción no prevista.

### 3. Un fallo en un lote arrastra al lote entero

Un cuerpo puede traer varias `entry`, varios `changes` y varios mensajes. Hoy cada `change` está aislado en su `try/catch` para que el fallo de uno no se lleve los demás — eso se mantiene, pero deja de ser el final de la historia: si **alguno** falló al persistir, la respuesta es `500`.

Meta reentrega el lote completo, y los mensajes que sí se habían guardado se reconocen como replay y no hacen nada. Es la idempotencia haciendo su trabajo, y es lo que permite que "reintentar todo" sea seguro. La alternativa —responder `200` y perder solo el mensaje que falló— es justo el agujero que este cambio cierra.

### 4. La forma del resultado de la fase de persistencia

`processInboundMessage` hoy devuelve `void` y se traga todo. Pasa a devolver un resultado discriminado que distingue los cuatro desenlaces que el llamador necesita separar: se guardó (con lo que la difusión necesita), era un replay, se descartó por una razón permanente, o falló de forma transitoria.

Un booleano no alcanza: "replay" y "descartado" también son "no se guardó", y los tres piden respuestas distintas.

### 5. La verificación de medios se vuelve no bloqueante, no se mueve de fase

`verifyAndBuildUrl` ya atrapa su propio fallo y devuelve `null`, así que un medio que no verifica **ya** deja pasar el mensaje con su texto. Lo que falta es que no pueda demorar la confirmación: se le pone un tiempo límite corto y explícito, y al agotarse se sigue como si hubiera fallado.

*Alternativa considerada — mover la verificación a la fase de difusión* y guardar el mensaje con `media_url` nulo, actualizándolo después. Se descarta: reintroduce la burbuja vacía en la bandeja que ya se arregló una vez, a cambio de una latencia que el tiempo límite resuelve sin efectos visibles.

### 6. `conversation.created` se despacha en la difusión, antes que `message.received`

Hoy sale entre la creación de la conversación y el insert, y su comentario explica por qué: un suscriptor tiene que ver el hilo abierto antes de su primer mensaje. Es una llamada HTTP a un tercero, así que se va a la fase de difusión — pero de primera, para que esa garantía de orden se mantenga. La bandera de "conversación recién creada" cruza la frontera dentro del resultado de la fase de persistencia.

## Risks / Trade-offs

- **La confirmación a Meta ahora incluye escrituras a la base** → Son locales: con la ruta interna a `api-gw` no hay DNS externo, ni TLS, ni proxy en el camino. Del orden de milisegundos contra una ventana de segundos.
- **Con la base caída, Meta acumula reintentos** → Es el comportamiento buscado. Cuando la base vuelve, los mensajes entran; hoy se pierden. El costo es ruido en el panel de entregas de Meta mientras dura la caída, que además sirve de alerta.
- **Un `500` mal clasificado pide reintentos eternos** → Por eso la decisión 2 es explícita sobre qué es permanente. Un fallo permanente clasificado como transitorio no pierde datos, pero ensucia; la clasificación tiene que quedar cubierta por tests.
- **Persistencia sí, difusión no, si el proceso muere en el medio** → No-goal declarado. El mensaje está guardado y visible; lo que falta es la respuesta automática, y una persona lo ve en la bandeja. Muy preferible al estado actual, donde no queda nada.
- **El resultado discriminado toca los tres canales** → Instagram y Messenger todavía no tienen manejador conectado, así que el radio real es WhatsApp. Conviene hacerlo ahora, antes de que haya tres llamadores.

## Migration Plan

Sin migración de base: se apoya en el índice único que ya existe desde la 037.

Despliegue: reconstrucción normal de la imagen. Conviene que vaya **después** de los arreglos de DNS y de la ruta interna a Supabase — no porque dependa de ellos, sino porque con la red inestable el cambio se manifestaría como una tanda de `500` y reintentos de Meta, y sería difícil distinguir el arreglo funcionando de un problema nuevo.

Reversión: revertir el commit y reconstruir. No deja estado que limpiar.

## Open Questions

- **El tiempo límite de la verificación de medios — medido. Los 5 s se quedan, y por la razón contraria a la esperada.** Se midió el 2026-09-09 desde dentro de `wacrm-app-1`, que es la red que importa:

  | Escenario | Tiempo |
  |---|---|
  | Conexión sin auth (`/me` → 400) | ~250 ms, estable |
  | Nodo autenticado, en frío, tras una ráfaga de ~30 llamadas | 3.0 – **5.3 s** |
  | Nodo autenticado, en frío, en reposo | 0.51 – 0.96 s |
  | Nodo autenticado, en caliente | p50 393 ms, p90 575 ms |
  | Id inexistente (rechazo) | 65 – 158 ms |

  Tres cosas quedan claras. **El DNS no es el problema hoy**: resuelve en 0 ms dentro del contenedor, y aunque `graph.facebook.com` devuelve una IPv6 que este contenedor no puede enrutar, forzar `ipv4first` no cambió nada — la sospecha de Happy Eyeballs queda descartada. **La conexión cuesta ~240 ms fijos** (TCP 207 + TLS 30), que es la distancia de Contabo NY a Meta y no baja. **Lo variable es el procesamiento autenticado del lado de Meta**, que en reposo es medio segundo y bajo ráfaga se degrada a 3–5 s.

  La tarea 1.1 se escribió esperando poder **bajar** el número. El dato dice lo contrario: una muestra dio 5270 ms, o sea que el límite actual ya se agotó al menos una vez. En reposo sobrarían 2 s, pero el timeout no existe para el caso en reposo — existe para el caso degradado, que es justo donde 5 s se queda corto. Bajarlo convertiría una degradación pasajera de Meta en pérdida sistemática de fotos. Se deja en 5 s como compromiso conocido: cubre el caso normal con holgura de 5x, y en degradación cae al camino ya definido — el mensaje se guarda con su texto, sin el medio.

  *Salvedad del método:* se midió `GET /<phone_number_id>` y no `GET /<media-id>`, porque producción no tiene **ningún** mensaje con medio (0 de 59) y no hay un id real que consultar. Es la misma forma de llamada —lectura de nodo por id, mismo token, misma red— y lo que domina el tiempo (conexión y latencia autenticada de Meta) es idéntico en ambas, pero es un sustituto. Si algún día hay medios reales en la base, la medición exacta sale sola.
- **La ventana de respuesta de Meta — verificada: no existe como número publicado.** La documentación vigente (`whatsapp/cloud-api/guides/set-up-webhooks`, `business-messaging/whatsapp/webhooks/overview` y `graph-api/webhooks`) no fija ningún plazo en segundos para confirmar con `200`. Lo que sí fija es lo de atrás: ante cualquier cosa que no sea `200` —o una entrega que no se logra por otro motivo— **reintenta con frecuencia decreciente hasta 7 días**, y avisa explícitamente que «estos reintentos pueden resultar en notificaciones duplicadas». Tampoco documenta que el webhook se apague ni se limite por fallar repetido.

  Tres consecuencias para este diseño. La primera: los **7 días** son de Cloud API; el webhook genérico de Graph API dice 36 h, y confundirlos subestimaría por mucho la durabilidad con la que contamos. La segunda: que Meta prometa duplicados es la confirmación de que la idempotencia del índice único de la 037 no es una precaución nuestra, sino el contrato — la decisión 3 se apoya en algo que la plataforma promete, no en algo que observamos. La tercera: **no se puede afinar un tiempo límite contra un número que no está publicado.** Un plazo existe — Meta corta —, pero al no documentarlo puede cambiar sin aviso, así que el diseño correcto es no acercarse: la fase de persistencia se queda en escrituras locales de milisegundos, y todo lo lento vive del otro lado de la frontera. Es lo que ya hace.
- **Registrar los `500` de persistencia de forma distinguible — resuelto.** Cada fallo transitorio se acumula con su `externalMessageId` y su motivo, y se emite una sola línea antes de responder, con el prefijo `[webhook]` y el conteo. Alcanza para alertar sin confundirlo con cualquier otro error del servidor. No se agregó métrica ni instrumentación aparte: no hay hoy dónde mandarla.
