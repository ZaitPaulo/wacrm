## Context

Hoy una difusión del asistente se envía desde la pestaña del navegador (`src/hooks/use-broadcast-sending.ts`), que va llamando a `/api/whatsapp/broadcast` de a 10 destinatarios por segundo. Esa ruta llama a Meta directamente y **no escribe nada en la base**: ni conversación ni mensaje. El estado de cada destinatario vive en `broadcast_recipients`, con la escalera `pending → sent → delivered → read → replied` más la rama `failed`, que el webhook nunca hace retroceder (`src/app/api/whatsapp/webhook/route.ts:565`).

Lo que ya existe y este cambio aprovecha:

- **`template_params` congelados por destinatario** (migración 038). Una reanudación del lado del servidor ya reproduce el envío original sin volver a resolver variables.
- **`deliverBroadcast`** (`src/lib/whatsapp/broadcast-core.ts`) sabe mandar una plantilla con reintento por variantes de teléfono, y **`resolveRecipientId`** (`src/lib/outbound/gate.ts:250`) resuelve el destino de un contacto, incluido quien solo tiene BSUID.
- **La marca de respuesta**: `flagBroadcastReplyIfAny` (`src/lib/inbound/core.ts:701`) pasa a `replied` la fila **más reciente** del contacto que esté en `sent`, `delivered` o `read`.
- **El cron del VPS** (`deploy/cron/crontab`) llama por la red interna de Docker con `tick.sh` y el secreto `AUTOMATION_CRON_SECRET`.
- **El horario de atención** (migración 523). `fueraDeHorario` (`gate.ts:313`) decide si un envío por iniciativa propia tiene que esperar.

Lo que falta es que alguien, pasado el plazo, vuelva a escribirles a quienes no contestaron. Una automatización no sirve: nada la dispara cuando sale una difusión, y su paso `send_template` exige una conversación existente (`src/lib/automations/engine.ts:536`), justo lo que no tiene quien nunca respondió.

## Goals / Non-Goals

**Goals:**

- Un recordatorio por destinatario, enviado solo desde el servidor, a quien recibió el mensaje y no escribió después.
- Nunca dos recordatorios a la misma persona por la misma difusión, aunque las pasadas se solapen o se caigan.
- Respetar el horario de atención.
- Que las respuestas al recordatorio sigan contando en la difusión original.
- Cancelar los recordatorios pendientes desde el detalle.

**Non-Goals:**

- Cadenas de varios recordatorios.
- Seguimiento en la API pública (`/api/v1/broadcasts`).
- Mover el envío inicial de la difusión al servidor. Sigue siendo del navegador.
- Reflejar los envíos de difusión como mensajes en la bandeja.
- Rastrear si el recordatorio fue entregado o leído. Solo se registra si salió o falló.

## Decisions

### 1. El estado del recordatorio vive en la misma fila del destinatario

Columnas nuevas en `broadcast_recipients`: `follow_up_status` (`NULL` = todavía no; `sending`, `sent`, `failed`, `skipped`), `follow_up_sent_at`, `follow_up_message_id` y `follow_up_error`.

**Por qué no una difusión hija con su propia fila.** `flagBroadcastReplyIfAny` marca la fila más reciente del contacto. Si el recordatorio fuera otra difusión, la respuesta caería en la hija y la original seguiría "sin respuesta": las métricas quedarían partidas y la difusión original parecería peor de lo que fue. En la misma fila, el destinatario sigue en `sent`/`delivered`/`read` hasta que responde, y la marca existente lo pasa a `replied` sin tocar `core.ts`.

`follow_up_message_id` se guarda solo para trazabilidad. El webhook de estados empareja por `whatsapp_message_id`, que sigue siendo el del mensaje original, así que las entregas y lecturas del recordatorio no mueven la escalera de la fila. Es intencional: la escalera describe el mensaje original.

### 2. La configuración vive en la difusión

Columnas nuevas en `broadcasts`: `follow_up_template_name`, `follow_up_template_language`, `follow_up_delay_hours` y `follow_up_cancelled_at`. Si `follow_up_template_name` es `NULL`, la difusión no tiene seguimiento.

El plazo se guarda **en horas** aunque la interfaz lo pida en días: permite probar con plazos cortos y no ata el esquema a la unidad que hoy muestra la interfaz. Hay un `CHECK` de rango en la base.

**Alternativa descartada:** una tabla `broadcast_follow_ups`. Sería la forma natural de tener varios pasos, pero para uno solo agrega un join en cada lectura. Si algún día hacen falta cadenas, se migra.

### 3. Elegir y reclamar en una sola sentencia, dentro de una función SQL

Hay una función `claim_due_broadcast_follow_ups(p_limit)`, `SECURITY DEFINER` y ejecutable solo por `service_role`, que en una transacción hace lo siguiente:

1. Toma los destinatarios cuya difusión tiene seguimiento sin cancelar, que están en `sent`, `delivered` o `read`, tienen `follow_up_status IS NULL` y `sent_at <= now() - follow_up_delay_hours`.
2. Marca `skipped` a los que no deben recibirlo: contacto borrado, o contacto que escribió después del envío. Esto último es un `EXISTS` sobre `messages` con `sender_type = 'customer'`, unido por `conversations.contact_id` y con `created_at > sent_at`.
3. Pasa a `sending` el resto, hasta `p_limit`, con `UPDATE … WHERE follow_up_status IS NULL … RETURNING`, y devuelve id, cuenta, contacto, parámetros congelados y la plantilla del recordatorio.

**Por qué en SQL y no con el cliente de Supabase.** "Vencido" depende del plazo de cada difusión, y "escribió después" es un `NOT EXISTS` con join; PostgREST no expresa ninguna de las dos cosas sin traer filas de más. Y el reclamo tiene que ser atómico. El `WHERE follow_up_status IS NULL` del `UPDATE` es el mismo patrón de reclamo condicional que `claimBroadcastDelivery` (migración 038): la pasada que llega segunda no encuentra la fila.

**Por qué comprobar los mensajes y no solo `replied`.** La marca de respuesta solo se aplica a la difusión más reciente del contacto. Un dueño que está en dos difusiones y contestó recibiría el recordatorio de la vieja.

### 4. Una fila en `sending` nunca se reenvía

Si el proceso muere entre el reclamo y el registro del resultado, la fila queda en `sending`. La misma función, al principio de cada pasada, pasa a `failed` las filas que llevan en `sending` más de 30 minutos, con el motivo "envío interrumpido; no se reintenta para no duplicar". Es la misma ventana de `DELIVERY_LOCK_STALE_MS`.

**Por qué no reintentar.** Un mensaje de WhatsApp no se puede recuperar, y no hay forma de saber si Meta llegó a aceptarlo. Perder un recordatorio es mejor que mandar dos.

### 5. El envío reutiliza el de las difusiones

De `deliverBroadcast` se extrae `sendTemplateWithVariants(...)`, el bucle de variantes de teléfono con `sendTemplateMessage`, para que lo usen el envío de la difusión y el recordatorio. Así hay un solo lugar donde se reintenta un número, y `deliverBroadcast` no cambia de comportamiento.

El destino se resuelve con `resolveRecipientId` **en el momento del recordatorio**: si el teléfono del contacto se corrigió entre medio, vale el corregido. Los parámetros son los `template_params` congelados si la plantilla del recordatorio tiene variables, y ninguno si no tiene. El asistente ya garantiza que no hay otra combinación (decisión 7).

Se mantiene el ritmo del asistente: 10 envíos por segundo, y un tope de 100 recordatorios por pasada.

### 6. Una ruta de cron propia, fuera de horario no se reclama nada

Hay una ruta nueva, `GET /api/broadcasts/cron`, con la misma verificación de secreto que `/api/automations/cron`, y una línea `*/5 * * * *` en el crontab. Va separada porque así lo pide el crontab: "que una fallando no bloquee la otra". Cada cinco minutos alcanza de sobra para un plazo que se mide en días.

`fueraDeHorario` se exporta desde `gate.ts`, sin cambiar su comportamiento. Antes de reclamar, la ruta consulta qué cuentas tienen recordatorios vencidos y **no reclama los de una cuenta fuera de horario**: esas filas siguen vencidas y salen en la primera pasada dentro del horario. Así no hace falta calcular la próxima apertura, y un recordatorio nunca queda en `sending` esperando. La función SQL recibe como parámetro las cuentas que están en horario.

**Alternativa descartada:** colgar el recordatorio de `automation_pending_executions`. Obligaría a crear una automatización oculta por difusión y a resolver el mismo problema de la conversación inexistente.

### 7. El asistente valida la plantilla del recordatorio

El paso 4 gana una sección "Seguimiento": un interruptor, la plantilla (solo aprobadas) y el plazo en días (1 a 7, por defecto 2). Rechaza la plantilla si tiene encabezado multimedia, encabezado de texto con variable o un botón URL con variable, o si su número de variables del cuerpo no es 0 ni igual al de la plantilla original. `COPY_CODE` se acepta porque, sin valor, el builder usa el `example` de la plantilla. La validación es una función pura, `checkFollowUpTemplate` en `src/lib/whatsapp/follow-up-template.ts`, con sus pruebas, que se apoya en `extractVariableIndices` y en `buttonRequiresCallerValue`, un helper nuevo de `template-send-builder.ts`.

La configuración se guarda en el `insert` de `broadcasts` que ya hace `createAndSendBroadcast`.

### 8. Métricas calculadas al leer y cancelación con una marca de tiempo

El detalle de la difusión calcula, con conteos sobre `broadcast_recipients`: pendientes (`follow_up_status IS NULL` en `sent`/`delivered`/`read`), enviados, fallidos, omitidos y "respondieron después del recordatorio" (`status = 'replied' AND replied_at > follow_up_sent_at`). **No** se agregan columnas de conteo a `broadcasts`: las de hoy son propiedad del trigger de las migraciones 003 y 005, y mezclarlas con conteos del recordatorio complica ese trigger sin necesidad.

Cancelar pone `follow_up_cancelled_at = now()`, un `UPDATE` sobre la propia difusión que la RLS ya permite. La función SQL ignora las difusiones canceladas. Lo que ya estaba en `sending` termina su envío.

## Risks / Trade-offs

- **[El contenedor del cron no toma el crontab nuevo]** → los recordatorios nunca salen y nadie se entera. *Mitigación:* la tarea de despliegue incluye recrear el contenedor y verificar en su log la línea `ok /api/broadcasts/cron`. Además, el detalle muestra "pendientes vencidos", que delata un cron parado.
- **[Horario de atención apagado en la cuenta]** → un recordatorio puede salir de noche si el envío original se hizo de noche o si el cron estuvo caído. *Mitigación:* el plazo cuenta desde `sent_at`, así que por lo normal sale a la misma hora que el original. Se recomienda activar el horario, y la interfaz lo menciona.
- **[La plantilla del recordatorio deja de estar aprobada o se borra]** → todos los recordatorios fallan. *Mitigación:* cada fallo queda con el motivo de Meta y se puede cancelar el seguimiento; no hay reintentos que empeoren el cuadro.
- **[Meta recategoriza la plantilla como marketing]** → se aplican límites de frecuencia por usuario y algunos envíos fallan. *Mitigación:* quedan registrados como fallidos con su motivo. No se mitiga más allá de eso.
- **[Un contacto responde en el mismo minuto en que sale su recordatorio]** → recibe el recordatorio igual. Es aceptable: la ventana dura segundos y el mensaje sigue siendo coherente.
- **[Se pierde el recordatorio de una pasada interrumpida]** → es el costo aceptado de la decisión 4.
- **[Colisión de número de migración]** → dos migraciones con el mismo número se saltan en silencio al desplegar. *Mitigación:* elegir el número comprobando `develop` y `main`; hoy la última es la 523.

## Migration Plan

1. Migración aditiva: columnas nulas en `broadcasts` y `broadcast_recipients`, un índice parcial para los vencidos y la función `claim_due_broadcast_follow_ups`. No toca datos existentes: las difusiones viejas quedan sin seguimiento.
2. Desplegar la app (`git pull` y `up -d --build`, como en `docs/self-hosting.md`).
3. Recrear el contenedor del cron para que lea el crontab nuevo, y verificar la línea `ok` de `/api/broadcasts/cron` en su log.
4. Probar con una difusión a un solo contacto propio, con un plazo corto puesto directo en la base, antes de la campaña real.

**Rollback:** quitar la línea del crontab y recrear el cron. Las columnas y la función pueden quedarse, porque nadie más las usa.

## Open Questions

- ¿Hace falta permitir plazos en horas desde la interfaz? Hoy no: el caso de uso es "2 o 3 días", y el esquema ya lo permitiría sin migrar.
