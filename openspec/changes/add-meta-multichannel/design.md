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

**Los plazos concretos no se fijan en esta spec a propósito.** Son política de Meta, cambian con el tiempo y difieren por canal. Al implementar hay que leerlos de la documentación vigente y dejarlos en ese único lugar. Lo que sí es requisito es el comportamiento: fuera de ventana, el sistema **no intenta enviar y falla**, sino que lo impide antes y lo explica.

### 6. La unificación de personas se sugiere, nunca se ejecuta sola

Cuando dos identidades de canales distintos parezcan la misma persona, el sistema lo señala y ofrece vincularlas. La decisión es de un humano.

*Por qué:* el costo de los dos errores es asimétrico. No unificar deja dos fichas y algo de desorden. Unificar mal mezcla el historial de dos clientes —conversaciones, documentos, vehículos— y es un daño que puede no detectarse a tiempo, con datos personales de por medio.

## Risks / Trade-offs

- **Responder por el canal equivocado** → El canal se lee de la conversación en la puerta de salida única, y la conversación lo lleva desde que se creó. Ningún camino de envío acepta un canal por parámetro suelto.
- **Un mensaje entrante de un canal no soportado tumba el webhook** → El enrutador ignora en silencio lo que no reconoce y lo registra, en lugar de fallar. Meta reintenta ante error y un fallo se convierte en una tormenta de reintentos.
- **La migración de identidades deja contactos sin identidad** → El backfill se verifica contando: tantas identidades de WhatsApp como contactos con teléfono. Si no cuadra, no se sigue.
- **Instagram y Messenger requieren permisos y revisión de la app en Meta** → No es trabajo de código y puede tomar semanas de calendario. Debe empezarse antes que el desarrollo, no después.
- **El asistente con IA responde por un canal con reglas distintas** → La ventana se consulta por canal antes de que la IA responda; hoy `ai/reply-window.ts` asume las de WhatsApp.

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

- **¿Un mismo negocio puede tener varias cuentas de Instagram o páginas de Facebook?** Si es así, la identidad del lado del negocio también necesita modelarse, no solo la del cliente.
- **¿Qué se hace con una respuesta fuera de ventana en Instagram o Messenger?** En WhatsApp existen las plantillas aprobadas; en los otros canales el equivalente es distinto y hay que decidir si se ofrece algo o simplemente se impide.
- **¿La atribución de la vitrina aplica a Instagram?** El código de referencia viaja hoy en el texto prellenado de WhatsApp. Desde Instagram no hay un mecanismo equivalente evidente.
- **¿Se factura por canal?** Si `package-commercial-offering` avanza con topes por plan, habría que decidir si un mensaje de Instagram cuenta igual que uno de WhatsApp.
