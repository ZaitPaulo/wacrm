## Context

La migración 513 ya hizo el trabajo pesado: `contacts.phone` admite NULL y `contact_channels(account_id, channel, external_id)` guarda la identidad de una persona en cada canal, con unicidad por cuenta. Se construyó para Instagram y Messenger, donde nunca hay teléfono. Lo que no previó es que **WhatsApp también dejaría de darlo a veces**.

Hoy el camino de entrada de WhatsApp arma la identidad así:

```ts
externalId: normalizePhone(message.from)
```

Con `from` ausente eso es cadena vacía, y el mensaje se descarta. El diagnóstico agregado el 2026-09-08 lo dejó a la vista:

```
{"type":"text","contact":{"profile":{"name":"HumbertoR","username":"RosalesHumberto"},
 "user_id":"CO.4481978948757066"}}
```

El lado del envío está más comprometido con el teléfono que el de entrada. `send-message.ts` carga el contacto, aborta con `Contact phone number not found` si no hay número, y reintenta el envío recorriendo variantes de prefijo troncal. Las siete funciones de `meta-api.ts` arman `{ messaging_product, recipient_type, to, ... }`.

Restricciones:

- **El BSUID viene en todos los mensajes entrantes**, tenga la persona nombre de usuario o no. Eso no es un detalle: es lo que hace posible resolver la identidad sin ambigüedad y evitar duplicados.
- **El BSUID es por negocio.** La misma persona tiene identificadores distintos frente a dos empresas. Encaja con la unicidad por `(cuenta, canal, identificador)` que ya tiene `contact_channels`.
- **Para enviar, Meta pide `recipient` en lugar de `to`**, con el BSUID completo y sin `to`.
- El teléfono puede aparecer y desaparecer entre un mensaje y otro de la misma persona, según las condiciones de Meta.

## Goals / Non-Goals

**Goals:**

- Que un mensaje sin teléfono entre y quede guardado.
- Que a ese contacto se le pueda responder por todos los caminos: asesor, IA, flujos, automatizaciones.
- Que la misma persona no se duplique cuando cambia de forma de identificarse, en cualquiera de los dos sentidos.
- Que el asesor pueda reconocer a un contacto sin teléfono.
- No cambiar nada para los contactos que sí traen teléfono.

**Non-Goals:**

- **No** se unifican contactos ya duplicados por este motivo. Si alguien ya existe dos veces, este cambio no los fusiona; para eso está `contact_identity_links` (migración 514) y es otra conversación.
- **No** se toca Instagram ni Messenger.
- **No** se agrega búsqueda por nombre de usuario en la interfaz. Mostrarlo sí; buscar por él, después.
- **No** se cambia el modelo de identidad: la 513 ya lo dejó listo. (La 522 sí agrega una columna, pero es para el nombre de usuario, que es un dato de presentación — ver la corrección más abajo.)

## Decisions

### 1. La identidad se resuelve en cascada: teléfono, y si no, BSUID

`sender.externalId` pasa a ser el teléfono normalizado cuando lo hay, y el BSUID tal cual cuando no. Ese valor es el que va a `contact_channels.external_id`.

*Por qué el teléfono conserva la prioridad:* es lo que ya está guardado en todas las instalaciones que funcionan. Invertir el orden —BSUID primero— obligaría a repoblar `contact_channels` para cada contacto existente, y cualquier error ahí parte historiales. La cascada deja intacto el caso que hoy funciona.

*Alternativa considerada — usar SIEMPRE el BSUID como identidad:* es más limpio conceptualmente, porque el BSUID nunca falta. Se descarta por lo mismo: exige migrar la identidad de todos los contactos existentes, y el beneficio se consigue igual con la decisión 2, sin tocar lo que ya está.

### 2. El BSUID se registra siempre, como identidad adicional

Cuando el mensaje trae teléfono **y** BSUID, se guarda el contacto por teléfono (decisión 1) y además se le vincula el BSUID como una segunda fila en `contact_channels`.

Eso es lo que resuelve los dos sentidos del cambio de identificación. Un contacto conocido que mañana escriba sin teléfono se resuelve por su BSUID ya vinculado. Y uno creado por BSUID que después traiga su número se encuentra por el BSUID antes de que la búsqueda por teléfono llegue a crear un duplicado.

Consecuencia que hay que aceptar: `contact_channels` pasa a admitir **más de una fila por contacto y canal**. Hoy la unicidad es `(cuenta, canal, identificador)`, que ya lo permite — no hay unicidad por `(cuenta, canal, contacto)`. Conviene confirmarlo contra el esquema antes de escribir código.

### 3. El orden de resolución al recibir

1. Identidad exacta por el `externalId` de este mensaje.
2. Si el mensaje trae BSUID y el paso 1 no encontró nada, identidad exacta por el BSUID.
3. **Solo si el `externalId` es un teléfono**, el respaldo difuso que ya existe (`findExistingContact`, tolerante a prefijos troncales).
4. Crear.

El paso 2 es el que evita el duplicado cuando la persona cambia de forma. El paso 3 tiene que quedar condicionado: hoy corre siempre en WhatsApp, y con un BSUID compararía dígitos de un identificador opaco contra teléfonos, que es como se hace coincidir a dos personas que no tienen nada que ver.

### 4. El envío elige el campo según la identidad, en un solo lugar

Las siete funciones de `meta-api.ts` dejan de recibir `to: string` y pasan a recibir un destinatario que sabe qué es: un teléfono o un BSUID. Ese tipo se traduce a `{ to }` o a `{ recipient }` en un único punto compartido.

*Por qué en un solo lugar y no en cada función:* son siete funciones que hoy repiten la misma construcción de payload. Resolverlo en cada una es siete oportunidades de olvidarse en la octava, que además sería la que se agregue dentro de seis meses.

El reintento por variantes de teléfono queda condicionado al caso teléfono, por la decisión 5 de la spec.

### 5. `contacts.phone` no se puebla con un BSUID

Suena obvio y por eso conviene decirlo: la creación del contacto hoy hace `phone: channel === 'whatsapp' ? externalId : null`, y con la cascada de la decisión 1 eso metería `CO.4481978948757066` en la columna del teléfono. Ahí lo verían la interfaz, la exportación, la carga masiva y el índice único de teléfonos.

La condición pasa a ser si el `externalId` **es** un teléfono, no si el canal es WhatsApp.

## Risks / Trade-offs

- **Fusionar personas distintas por un error en la resolución** → Es el riesgo más caro del cambio, y el más difícil de deshacer: un historial mezclado no se separa solo. La mitigación es que toda la resolución nueva es por coincidencia **exacta** de identificador, y que la difusa queda explícitamente prohibida para lo que no es teléfono.
- **Duplicar a alguien que ya existe** → Menos grave y reversible con `contact_identity_links`. Aparece si el paso 2 de la decisión 3 falla o si el BSUID no se vinculó cuando debía.
- **Que el envío por `recipient` no funcione como dice la documentación** → Establecido por contraste de errores contra la API real, pero NO por un envío exitoso a un BSUID de verdad. Sigue pendiente de la verificación de punta a punta (tarea 6.4); si Meta lo rechazara, la mitad del envío cambia de forma.
- **Varias filas por contacto en `contact_channels`** → Cualquier lectura que asuma "una identidad por canal por contacto" empieza a devolver dos. Hay que buscar esas lecturas, no suponer que no existen.
- **El nombre de usuario puede cambiar** → No es una llave y no se usa como tal; es solo para mostrar. Se refresca en cada mensaje, igual que el nombre de perfil.

## Migration Plan

**Migración `522_channel_username.sql`**, que agrega `contact_channels.username` (nullable) y corrige el comentario de `external_id`. No toca datos existentes y es idempotente. La identidad en sí no necesitó nada: la 513 ya había dejado `contacts.phone` nulable y `contact_channels` con la forma necesaria.

Despliegue: **aplicar la migración ANTES de reconstruir.** Al revés, el código nuevo intentaría escribir una columna que no existe cada vez que llegue un mensaje de alguien con nombre de usuario. El mensaje se guardaría igual —`linkChannelIdentity` registra el error y sigue, no lanza—, pero su identidad NO quedaría vinculada, y sin identidad cada mensaje siguiente de esa persona crearía un contacto nuevo. Duplicados en silencio, que es justo lo que este cambio existe para evitar.

Se puede desplegar solo, sin depender de nada más.

Verificación: el caso de producción está disponible y es reproducible a voluntad —basta que esa persona escriba— así que la prueba de punta a punta es real y no simulada. Hay que verificar las dos mitades: que el mensaje entre, y que la respuesta llegue.

Reversión: revertir el commit. Deja atrás los contactos creados por BSUID y sus filas en `contact_channels`; no estorban, pero esos contactos vuelven a quedar sin poder recibir mensajes.

## Hallazgos del grupo 1 (2026-09-08)

Lo que la lectura y las pruebas dejaron establecido, para no volver a averiguarlo:

- **`contact_channels` admite dos filas del mismo canal por contacto.** El único índice único es `(account_id, channel, external_id)`; no hay unicidad por `(cuenta, canal, contacto)`. La decisión 2 es viable sin migración.
- **Meta acepta `recipient`.** Verificado por contraste: un envío con `recipient` y un BSUID inexistente devuelve `(#100) Invalid parameter`, mientras que un envío SIN destinatario devuelve `The parameter to is required`. Si el campo fuera desconocido, el primero habría dado el segundo error. Reconoce el campo y rechaza el valor.
- **Las plantillas funcionan con BSUID**, salvo las de autenticación *one-tap*, *zero-tap* y *copy-code*, que exigen teléfono. Las difusiones, entonces, los alcanzan.
- **El comentario de `contact_channels.external_id` en la 513 quedó desactualizado**: dice que para WhatsApp es el teléfono normalizado. Corregirlo pide una migración de solo comentario, que este cambio evita a propósito; queda anotado para la próxima que toque el esquema.

### El hallazgo que cambia el diseño: el BSUID NO es permanente

La documentación dice que **los BSUID se regeneran cuando la persona cambia de número de teléfono**, y que eso dispara un webhook `user_id_update`.

Eso golpea a la decisión 2. Vincular el BSUID para todos sigue siendo lo correcto —resuelve el caso frecuente—, pero deja de ser suficiente por sí solo: si el identificador cambia y no lo seguimos, la identidad guardada queda vieja y la persona vuelve a aparecer como alguien nuevo. Es exactamente el duplicado que este cambio quiere evitar, solo que por otra puerta.

No se encontró documentación pública del payload de ese webhook, así que la forma exacta está sin confirmar.

### Decisión: `user_id_update` queda FUERA de este cambio

Se cubre el salto teléfono↔BSUID, que es lo que está rompiendo hoy. La regeneración del identificador exige que la persona cambie de número — algo poco frecuente, y que **hoy, con identidad por teléfono, ya produce un contacto nuevo**. No manejarlo no es una regresión: es dejar como está algo que ya estaba así.

Pesó además que el payload no esté documentado: escribir el manejador a ciegas arriesga tener que rehacerlo cuando aparezca la forma real, y suscribir el campo es configuración del lado de Meta.

**Limitación conocida, entonces:** si un contacto cambia de número de teléfono, su BSUID se regenera y volverá a aparecer como un contacto nuevo. Merece su propio change.

Nótese que esto NO afecta al requisito de la spec sobre no duplicar: ese requisito habla del salto entre teléfono y BSUID, que sí queda cubierto.

### Limitación: las difusiones no alcanzan a un contacto sin teléfono

`broadcast-core.ts` recibe del llamador una **lista de teléfonos**, los sanea y descarta lo que no sea E.164. Un contacto identificado por BSUID no tiene número, así que no puede estar en esa lista — aunque Meta sí acepte plantillas dirigidas a un BSUID.

Incluirlos exigiría que la difusión se arme con ids de contacto en vez de teléfonos, lo que toca la interfaz de selección, la carga por CSV y el modelo de la difusión entera. Queda fuera de este cambio, anotado para el que lo aborde.

### Corrección al diseño: SÍ hay una migración

El diseño afirmaba «sin migración», y era cierto para la identidad — la 513 dejó todo listo. Lo que no previó es que el **nombre de usuario no tiene dónde vivir**: `contacts` no tiene esa columna ni campos libres.

La 522 agrega `contact_channels.username`, nullable. Va en la identidad y no en la persona porque el handle es de un canal: la misma persona puede tener uno en WhatsApp y otro en Instagram, y ponerlo en `contacts` obligaría a una columna por canal — justo lo que la 513 decidió no hacer. De paso corrige el comentario de `external_id`, que la 513 describía como «el teléfono normalizado» y ya no lo es siempre.

No sirve reusar el nombre de perfil que ya guardamos: ese lo elige cada quien y se repite, así que dos «Juan» sin teléfono serían indistinguibles. El nombre de usuario es único y estable, y es el dato que la propia persona puede dictar para que la encuentren.

## Open Questions
- ~~¿Qué muestra la interfaz donde va el teléfono?~~ **Resuelto.** La lista y la bandeja no se rompían: usan `contact.name || contact.phone`, y el nombre de perfil siempre llega. Lo que se cambió es la fila del teléfono en la barra lateral, que quedaba en blanco: ahora dice «Sin teléfono», muestra el `@usuario` y explica por qué no hay número. Un hueco se lee como un dato por completar, y manda a alguien a buscar algo que no existe.
- ¿Qué pasa con la carga masiva y la exportación de contactos? **Sin abordar.** Ninguna se rompe —un contacto sin teléfono sale con la celda vacía—, pero no hay forma de cargar uno por su identificador ni la exportación dice cuál es.
- **Verificación pendiente contra la API real.** Que Meta acepta `recipient` está establecido por contraste de errores, no por un envío exitoso a un BSUID de verdad. La tarea 6.4 lo cubre y requiere desplegar.
