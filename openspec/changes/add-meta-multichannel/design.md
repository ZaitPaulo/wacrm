## Context

El producto nació como CRM de WhatsApp y esa decisión está grabada en tres capas: la identidad de las personas es su teléfono, el webhook entiende una sola forma de cuerpo, y la conversación no sabe por dónde llegó.

Lo que hay hoy, verificado en el código:

```
Entrada    /api/whatsapp/webhook  →  recorre entry[].changes[]
Identidad  contacts.phone NOT NULL  →  findExistingContact() normaliza el número
Hilo       conversations  →  sin columna de canal
Salida     send-message.ts + automations/meta-send.ts + flows/meta-send.ts
Ventana    ai/reply-window.ts  →  la regla de WhatsApp, como si fuera universal
```

Ese último punto merece atención antes de empezar: **ya existen tres caminos de envío en paralelo**, los tres apuntando a la API de WhatsApp. Añadir canales sin resolver eso primero triplica la superficie del problema.

**Lo que exige Meta**, leído de su documentación vigente el 2026-08-12:

```
Ventana        24 h en los tres canales, desde el último mensaje del cliente
Fuera de ella  WhatsApp   → plantilla aprobada
               IG / MSGR  → etiqueta human_agent, hasta 7 días
human_agent    "to provide human agent support" — es para RESPUESTAS
               HUMANAS. Un bot no puede usarla.
Atribución     ig.me/m/<usuario>?ref=<param>, hasta 2083 caracteres;
               llega como evento messaging_referral (source SHORTLINKS)
```

La segunda línea de `human_agent` es la que más consecuencias tiene y se trata en la decisión 8: la ventana no depende solo del canal, depende también de quién responde.

## Goals / Non-Goals

**Goals**
- Recibir y responder mensajes de WhatsApp, Instagram y Messenger en una sola bandeja.
- Que el canal sea un dato de la conversación, no una suposición del código.
- Que las instalaciones actuales sigan funcionando sin que nadie toque nada.
- Dejar la puerta abierta a canales que no son de Meta, sin construirlos ahora.

**Non-Goals**
- Fusionar automáticamente identidades entre canales.
- Difusiones masivas por Instagram o Messenger.
- Publicar contenido o administrar las redes sociales del negocio.
- Unificar de una vez los tres caminos de envío existentes: es un refactor propio y mezclarlo aquí haría este change imposible de revisar.

## Decisions

### 1. La identidad se separa del contacto

Tabla `contact_channels`: `contact_id`, `channel`, `external_id`, con unicidad por `(account_id, channel, external_id)`. Una persona es un `contact` con una o más identidades.

`contacts.phone` **se conserva y se sigue poblando** para WhatsApp. Deja de ser la llave, no el dato.

*Alternativa descartada:* columnas por canal en `contacts` (`instagram_id`, `messenger_id`). Cada canal nuevo obligaría a una migración y a tocar todas las consultas de búsqueda.

*Alternativa descartada:* un contacto por canal, sin unificación posible. Sería lo más simple de construir, pero condena al negocio a ver a su cliente partido en tres fichas, que es justo lo que un CRM debe evitar.

**Migración de lo existente:** cada contacto actual recibe una fila de identidad con `channel = 'whatsapp'` y su teléfono normalizado como `external_id`. Nadie nota el cambio.

### 2. La conversación pertenece a un canal, y no se mezclan hilos

`conversations.channel`, con una conversación por `(contacto, canal)`. Quien escribe por WhatsApp y por Instagram tiene dos hilos, aunque sea el mismo contacto.

*Por qué no un hilo unificado:* la ventana de respuesta, lo que se puede enviar y el identificador de destino son distintos por canal. Un hilo mezclado obligaría a decidir por dónde sale cada respuesta, y ese es exactamente el error que no podemos permitirnos. Con hilos separados, **el canal de salida se lee de la conversación y nunca se infiere**.

La bandeja puede seguir mostrando ambos hilos juntos al abrir la ficha del contacto; eso es presentación, no modelo.

### 3. Un webhook que enruta por tipo de evento

Meta entrega los eventos de una misma aplicación a la URL configurada, distinguiéndolos por el campo `object` del cuerpo. El endpoint pasa a leer ese campo y derivar al manejador correspondiente; el núcleo de procesamiento (resolver contacto, resolver conversación, guardar mensaje, disparar automatizaciones e IA) se extrae y se comparte.

**La ruta actual `/api/whatsapp/webhook` se mantiene.** Ya está registrada en las cuentas de Meta de las instalaciones existentes y cambiarla obligaría a reconfigurar cada una. El nombre queda desalineado con lo que hace —deuda consciente— y se documenta en vez de romper instalaciones por estética.

*Alternativa descartada:* un endpoint por canal. Es más legible, pero multiplica la verificación de firma y obliga a reconfigurar Meta.

### 4. Una sola puerta de salida

Toda respuesta pasa por una función que recibe la conversación y el contenido, y resuelve internamente a qué API hablarle. Ni la bandeja, ni las automatizaciones, ni los flujos, ni la IA deciden el canal: lo leen de la conversación.

Los dos `meta-send.ts` de automatizaciones y flujos pasan a delegar en esa puerta. No se unifican por dentro en este change, pero dejan de hablarle directo a la API de WhatsApp.

### 5. Las reglas de ventana viven en un solo lugar y se leen de Meta

Cada canal declara su ventana de respuesta y qué se permite fuera de ella, en una tabla de reglas del código, no repartida en condicionales.

**Los plazos son política de Meta y cambian**, así que viven en ese único lugar y se actualizan ahí. Los vigentes al escribir esto están en la tabla del Context. Lo que no cambia es el comportamiento: fuera de ventana el sistema **no intenta enviar y falla**, sino que lo impide antes y lo explica.

### 6. La unificación de personas se sugiere, nunca se ejecuta sola

Cuando dos identidades de canales distintos parezcan la misma persona, el sistema lo señala y ofrece vincularlas. La decisión es de un humano.

*Por qué:* el costo de los dos errores es asimétrico. No unificar deja dos fichas y algo de desorden. Unificar mal mezcla el historial de dos clientes —conversaciones, documentos, vehículos— y es un daño que puede no detectarse a tiempo, con datos personales de por medio.

### 7. Una conexión por canal por cuenta

Un negocio conecta una cuenta de Instagram y una página de Facebook, no varias. La identidad del lado del negocio no se modela.

*Por qué:* es la regla que el producto ya tomó para WhatsApp y de forma deliberada — la migración 017 cambió `UNIQUE(user_id)` por `UNIQUE(account_id)` con el comentario *"one WhatsApp number per account"*. `ai_configs` la sigue, e `instagram_config` (migración 512) también.

*Lo que evita:* con varias cuentas por canal, la salida deja de resolverse con una pregunta y pasa a resolverse con dos —por qué canal, y por cuál de nuestras cuentas en ese canal—. Eso duplica la lógica justo donde vive el peor error del change, que es contestarle a alguien por donde no era.

*La salida cuando haga falta:* el producto es multi-cuenta desde la 017. Un negocio con dos Instagram suele ser dos sedes, y eso ya se modela como dos cuentas del CRM.

### 8. La ventana depende del canal Y de quién responde

No es una sola regla por canal, son dos dimensiones:

```
                DENTRO DE 24 h      24 h – 7 días        > 7 días
WhatsApp        cualquiera          plantilla aprobada   plantilla aprobada
Instagram       cualquiera          human_agent          nada
Messenger       cualquiera          human_agent          nada
```

Un asesor en Instagram tiene siete días para contestar a mano. El asistente con IA tiene veinticuatro horas en los tres canales, siempre.

*Por qué la IA no puede usar `human_agent`:* Meta la define para *"provide human agent support"* — casos donde el negocio estaba cerrado o el asunto necesita más de un día. Usarla para que un bot responda al quinto día es exactamente lo que la etiqueta no autoriza, y el permiso que la habilita pasa por revisión.

*Consecuencia para el código:* `ai/reply-window.ts` hoy no distingue ni canal ni autor. La comprobación pasa a recibir ambos, y la respuesta "se puede enviar" deja de ser una propiedad de la conversación para ser una de la conversación **más** quién la está por enviar.

### 9. Los mensajes se cuentan por canal

Cada mensaje queda contabilizable por canal para los topes de plan que definirá `package-commercial-offering`.

*Lo que cuesta:* nada. `messages` no tiene `account_id` — llega a la cuenta únicamente por `conversations`, así que toda medición ya está obligada a ese join para acotar por cuenta. El canal viaja en esa misma fila y se agrupa sin trabajo extra ni columna nueva.

*Por qué separado y no un total:* el costo real difiere. WhatsApp tiene precio por conversación del lado de Meta; la mensajería de Instagram y Messenger no. Un único contador escondería esa diferencia justo cuando importe.

**Este change no define topes ni precios.** Solo garantiza que el canal quede registrado en cada mensaje para que el otro pueda contarlos como decida.

### 10. La atribución de la vitrina no llega a Instagram en este change

El código de referencia del vehículo sigue viajando solo por WhatsApp.

*Existe el mecanismo y es mejor que el actual:* `ig.me/m/<usuario>?ref=<param>` entrega el valor en el evento `messaging_referral`, como campo propio. Hoy el código va **dentro del texto** del mensaje prellenado y el propio `whatsappHref` lo reconoce — *"si no borra la etiqueta, el webhook puede atribuir la conversación"*. En Instagram el cliente no podría borrarlo.

*Por qué se difiere igual:* construirlo exige la cuenta publicada, suscribir un evento más y tocar la vitrina, y nada de eso ayuda a que los mensajes de Instagram lleguen y se respondan, que es lo que este change tiene que probar primero.

*La consecuencia, para tenerla a la vista:* mientras no se haga, una consulta que entre por Instagram no se asocia a ningún vehículo, y la conversión del tablero comercial —que cruza `vehicle_inquiries` con vehículos vendidos— se vuelve parcialmente ciega a medida que Instagram tome volumen. Conviene revisarlo apenas el canal esté operando.

## Risks / Trade-offs

- **Responder por el canal equivocado** → El canal se lee de la conversación en la puerta de salida única, y la conversación lo lleva desde que se creó. Ningún camino de envío acepta un canal por parámetro suelto.
- **Un mensaje entrante de un canal no soportado tumba el webhook** → El enrutador ignora en silencio lo que no reconoce y lo registra, en lugar de fallar. Meta reintenta ante error y un fallo se convierte en una tormenta de reintentos.
- **La migración de identidades deja contactos sin identidad** → El backfill se verifica contando: tantas identidades de WhatsApp como contactos con teléfono. Si no cuadra, no se sigue.
- **Instagram y Messenger requieren permisos y revisión de la app en Meta** → No es trabajo de código y puede tomar semanas de calendario. Debe empezarse antes que el desarrollo, no después.
- **El asistente con IA responde por un canal con reglas distintas** → La ventana se consulta por canal antes de que la IA responda; hoy `ai/reply-window.ts` asume las de WhatsApp.
- **Usar `human_agent` para un envío automático** → Es el riesgo con peor desenlace de los que dependen de Meta: no produce un error, produce un uso de la etiqueta fuera de lo que autoriza, y lo que está en juego es el permiso de la app, no un mensaje. La etiqueta se decide en la puerta de salida a partir de quién envía, y nunca la elige quien construye el mensaje.

## Migration Plan

1. Migración: tabla de identidades por canal, columna de canal en `conversations` con valor por defecto `whatsapp`, y catálogo de canales soportados.
2. Backfill: una identidad de WhatsApp por cada contacto con teléfono; toda conversación existente marcada como WhatsApp. Verificar por conteo antes de continuar.
3. Extraer el núcleo del webhook sin cambiar comportamiento, y confirmar que WhatsApp sigue igual.
4. Puerta de salida única; migrar a ella los tres caminos actuales.
5. Añadir los manejadores de Instagram y Messenger.
6. Bandeja: indicador y filtro por canal.
7. Sugerencia de vinculación de identidades.

**Rollback:** los pasos 1 a 4 son internos y no cambian comportamiento visible; revertir el código deja tablas y columnas huérfanas sin efecto. A partir del paso 5 hay conversaciones de canales nuevos: revertir dejaría esos hilos sin poder responderse, así que ese es el punto de no retorno práctico.

## Open Questions

Las cuatro se resolvieron el 2026-08-12 y viven arriba como decisiones: una conexión por canal por cuenta (7), la ventana por canal y por autor (8), conteo de mensajes por canal (9) y la atribución de la vitrina diferida (10).

Queda sin decidir, y no bloquea:

- **Cuándo revisar la atribución por Instagram.** La decisión 10 la difiere, no la descarta, y anota qué se pierde mientras tanto.
- **Si el `human_agent` se ofrece en la bandeja como una acción explícita** ("responder fuera de ventana") o se aplica solo por estar respondiendo un humano. Lo segundo es más simple; lo primero deja constancia de que alguien lo eligió. Se define al construir la bandeja.
