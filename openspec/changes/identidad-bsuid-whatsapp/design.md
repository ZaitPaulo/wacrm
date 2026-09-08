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
- **No** se cambia el modelo de datos. Si hiciera falta una migración, es señal de que el alcance se desbordó.

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
- **Que el envío por `recipient` no funcione como dice la documentación** → No está probado contra la API real. Hay que verificarlo con el caso de producción que ya tenemos (`CO.4481978948757066`) antes de dar el cambio por bueno; si Meta lo rechaza, la mitad del envío cambia de forma y conviene saberlo temprano.
- **Varias filas por contacto en `contact_channels`** → Cualquier lectura que asuma "una identidad por canal por contacto" empieza a devolver dos. Hay que buscar esas lecturas, no suponer que no existen.
- **El nombre de usuario puede cambiar** → No es una llave y no se usa como tal; es solo para mostrar. Se refresca en cada mensaje, igual que el nombre de perfil.

## Migration Plan

Sin migración de base: la 513 dejó `contacts.phone` nulable y `contact_channels` con la forma necesaria.

Despliegue: reconstrucción normal. Se puede desplegar solo, sin depender de nada más.

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

## Open Questions
- ¿Qué muestra la interfaz hoy donde va el teléfono, y qué debería mostrar cuando no hay? Afecta la bandeja, la ficha del contacto y la lista.
- ¿Qué pasa con la carga masiva y la exportación de contactos, que hoy giran alrededor del teléfono?
