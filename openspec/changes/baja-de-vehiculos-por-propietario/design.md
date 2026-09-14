## Context

El CRM ya sabe cuándo alguien no respondió una difusión: el cambio `seguimiento-automatico-de-difusiones` (en `develop`, sin desplegar) definió "no respondió" como "no hay ningún mensaje `customer` después del `sent_at` del destinatario", y lo resuelve en SQL para no confiar en el estado `replied`, que solo se marca en la difusión más reciente del contacto. También dejó un cron cada 5 minutos (`/api/broadcasts/cron`) y la opción de cancelar el seguimiento (`broadcasts.follow_up_cancelled_at`).

Lo que no sabe es **de quién es cada vehículo**. `inventory_vehicles` tiene `sold_to_contact_id` (el comprador, migración 508) y nada del vendedor. `vehicle_acquisitions` registra compras de la casa, con costo `NOT NULL` y permiso de administrador: no sirve para los carros en consignación, que no tienen costo de compra.

Ocultar ya tiene todo resuelto río abajo: la vitrina (`src/lib/showcase/data.ts`) y el índice de inventario del bot (`src/lib/ai/inventory-index.ts`) filtran por `status = 'available'`, y `syncVehicleKnowledge` (`src/lib/inventory/knowledge-sync.ts`) borra la ficha del bot en la base de conocimiento de todo vehículo que no esté `available`. Solo hay que cambiar el estado y llamar a esa función.

Decisiones del cliente (2026-09-14): ocultar (no marcar vendido); plazo de 60 días desde el primer mensaje; un "NO" oculta al instante; el recordatorio sigue con selector y 2 días por defecto.

## Goals / Non-Goals

**Goals:**

- Un propietario por vehículo, editable desde el formulario del vehículo y cargado para los existentes desde la lista del cliente.
- Un paso de automatización que oculte el vehículo del contacto, para colgarlo del botón `NO`.
- Una baja por silencio por difusión, que corre sola en el cron existente.
- Que cada baja quede explicada en el vehículo y sea reversible.

**Non-Goals:**

- Volver a publicar automáticamente si el dueño aparece después.
- Retirar publicaciones ya hechas en redes sociales.
- Propietario desde la ficha del contacto, o varios propietarios por vehículo.
- Resolver con IA a qué vehículo se refiere un dueño con varios.

## Decisions

### 1. Columna `owner_contact_id` en `inventory_vehicles`

Una FK a `contacts` con `ON DELETE SET NULL` y un índice `(account_id, owner_contact_id)`. Borrar el contacto deja el vehículo intacto y sin propietario.

**Alternativas descartadas.** Una tabla de relación permitiría varios propietarios, pero hoy no hay ese caso y agregaría un join a cada lectura del inventario. Reusar `vehicle_acquisitions` mezclaría consignaciones con compras de la casa y obligaría a inventar un costo, que es justo lo que se decidió no hacer en la carga del 2026-08-26.

La API del inventario valida que el contacto sea de la cuenta antes de guardarlo: la FK solo comprueba que el contacto exista, no de quién es.

### 2. Ocultar es una función SQL, y el KB se sincroniza después

`hide_owner_vehicles(p_account_id, p_vehicle_ids, p_note)`, `SECURITY DEFINER` y solo para `service_role`, hace en una sentencia: `status = 'hidden'` **solo donde siga `available`**, y agrega a `internal_notes` una línea fechada con el motivo. Devuelve los ids que de verdad cambió.

En SQL porque agregar texto a las notas existentes (`coalesce(internal_notes, '') || …`) no se puede expresar con el cliente de Supabase sin leer y reescribir cada fila, con la carrera que eso trae contra una edición humana. La condición `status = 'available'` es lo que garantiza que nunca se pisa un vehículo reservado o vendido a mano.

Por cada id devuelto se llama a `syncVehicleKnowledge`. Un fallo del KB se registra y no deshace la baja: el vehículo ya no sale en la vitrina, y el índice del bot filtra por estado igual. Es el mismo trato que le da la API del inventario.

El helper TypeScript `hideVehicles(accountId, vehicleIds, reason)` en `src/lib/inventory/auto-delist.ts` envuelve las dos cosas y lo usan los dos caminos.

### 3. El "NO" es un paso de automatización, no una regla de la difusión

Hay un paso nuevo, `hide_owner_vehicle`, sin configuración. Busca los vehículos `available` del contacto:

- **uno** → lo oculta, con la nota "el propietario respondió que ya no está disponible";
- **cero** → no hace nada;
- **más de uno** → no hace nada: no hay forma de saber de cuál habla el dueño, y ocultar el equivocado le quita a la vitrina un carro que sí está en venta.

En los tres casos el paso termina **con éxito**, con el detalle en el registro. Si fallara, `executeStepsFrom` cortaría la corrida (`break`), y los pasos siguientes de la automatización —la etiqueta, por ejemplo— no correrían por algo que no es un error.

**Por qué un paso y no una regla de la difusión.** El plan acordado ya clasifica las respuestas con automatizaciones (`interactive_reply` `NO` con condición de etiqueta `propietario`). Un paso se cuelga de esa misma automatización, lo ve y lo apaga cualquiera desde el editor, y sirve para otros disparadores. Una regla en la difusión obligaría a enseñarle a la difusión qué botón significa "no". `automation_steps.step_type` es `TEXT` sin `CHECK`, así que no hace falta migración para el tipo nuevo.

### 4. La baja por silencio es una segunda fase del cron de difusiones

Columnas nuevas:

- `broadcasts.no_reply_hide_after_days`: `NULL` = sin baja; `CHECK` entre 1 y 365; la interfaz ofrece 30, 45, 60 y 90.
- `broadcast_recipients.no_reply_checked_at` y `no_reply_hidden_count`.

La función `apply_due_no_reply_hides(p_limit)` toma, con `FOR UPDATE SKIP LOCKED`, los destinatarios vencidos: difusión con plazo y sin cancelar, `status` en `sent`/`delivered`/`read`, sin revisar y con `COALESCE(sent_at, created_at) <= now() - plazo`. A cada uno:

1. Si el contacto escribió después del envío (el mismo `EXISTS` sobre `messages` de la 524), lo marca revisado con 0 vehículos.
2. Si no, oculta los vehículos `available` de los que es propietario, con la nota "el propietario no respondió en N días".
3. Lo marca revisado con la cantidad.

Devuelve `(account_id, vehicle_id)` de lo ocultado, para que TypeScript sincronice el KB.

`no_reply_checked_at` es lo que garantiza "una sola vez": un vehículo que Angélica vuelve a publicar no se vuelve a ocultar, porque su destinatario ya está revisado.

**Por qué en el mismo cron.** Es el mismo dominio y la misma definición de "no respondió", y cada 5 minutos sobra para un plazo en días. La ruta llama a las dos fases por separado y un fallo de una no impide la otra. La baja **no** pasa por el filtro de horario de atención de los recordatorios: no le escribe a nadie.

**Cancelación compartida.** `follow_up_cancelled_at` cancela recordatorio y baja a la vez: para el usuario los dos son "el seguimiento de esta difusión". El botón del detalle aparece si la difusión tiene cualquiera de los dos.

### 5. Carga inicial por script, no por la interfaz

`scripts/propietarios-a-sql.mjs` lee `propietarios-referencia-*.csv` (teléfono, placa) y escribe un `.sql` con:

- un `UPDATE … FROM (VALUES …)` que asigna el propietario emparejando `upper(trim(license_plate))` con la placa y `contacts.phone_normalized` con el teléfono, **solo donde `owner_contact_id IS NULL`**;
- un `SELECT` con lo que no encontró vehículo o contacto.

El SQL se revisa antes de aplicarse en producción, y aplicarlo requiere autorización explícita.

**Alternativa descartada:** una columna `placa` en el importador de contactos. Es una sola carga, y meter un concepto de inventario en la importación de contactos la complica para siempre.

### 6. Interfaz

- **Formulario del vehículo:** un campo "Propietario" con una lista de contactos que se puede buscar (`ContactPicker` en `src/components/contacts/`, sobre el `Popover` que ya existe). Un `Select` con cientos de contactos, y con homónimos, no se puede usar. La búsqueda es una función pura (`filterContacts`): sin tildes, por palabras en cualquier orden y por teléfono desde tres dígitos, y se dibujan como máximo 50 filas. La página ya cargaba los contactos para el comprador; ahora trae también el teléfono y los carga **por páginas**, porque PostgREST corta cada respuesta en 1 000 filas sin avisar.
- **Paso 4 del asistente:** la sección "Seguimiento" gana un interruptor "Ocultar de la vitrina los vehículos de quien no responda", con plazo (30/45/60/90, por defecto 60) y un aviso de que solo afecta a contactos que sean propietarios de algún vehículo.
- **Detalle de la difusión:** la fecha en que vence la baja (el `sent_at` más temprano más el plazo), cuántos destinatarios faltan por revisar y cuántos vehículos se ocultaron.
- **Editor de automatizaciones:** el paso nuevo, con una explicación en lugar de campos.

## Risks / Trade-offs

- **[El inventario del VPS no coincide con la lista (36)]** El inventario se cargó de la (32): 16 placas de la (36) no existen en él y 60 de la (32) ya no están en la lista. Esas filas no se pueden vincular, y sus dueños no se verán afectados por ninguna baja. *Mitigación:* el informe de la carga las lista; conviene poner el inventario al día con la (36) antes de la campaña.
- **[Un dueño con varios vehículos toca NO]** No se oculta ninguno. *Mitigación:* la conversación llega a Angélica igual, y el registro de la automatización dice por qué no se tocó.
- **[Un dueño escribe "ya lo vendí" en texto]** Ni el paso del botón ni la baja por silencio lo ocultan: escribió. *Mitigación:* es justo el caso que se le asigna a Angélica.
- **[Se oculta un vehículo que sí estaba disponible]** Por ejemplo, un dueño que no leyó en dos meses. *Mitigación:* ocultar es reversible y la nota interna dice por qué y cuándo.
- **[Falla la sincronización del KB tras ocultar]** La ficha del bot sobrevive hasta la próxima edición del vehículo. *Mitigación:* el índice de inventario del bot ya filtra por estado, así que el bot no lo lista aunque la ficha siga; el fallo queda en el log.
- **[Colisión de número de migración]** *Mitigación:* la 524 es del cambio anterior; esta usa la siguiente libre, comprobada en `develop` y `main`.

## Migration Plan

1. Migración aditiva (525 o la siguiente libre): columnas nulas, dos funciones y un índice. No toca datos.
2. Se despliega **junto con o después de** `seguimiento-automatico-de-difusiones` (524 + cron recreado).
3. En producción, después de importar los contactos: generar el SQL de propietarios con el script, revisarlo y aplicarlo con autorización.
4. Agregar el paso "Ocultar el vehículo del contacto" a la automatización del botón `NO`.

**Rollback:** quitar el paso de la automatización y crear las difusiones sin baja. Las columnas y funciones pueden quedarse. Los vehículos ya ocultados se vuelven a publicar a mano; la nota interna permite encontrarlos.

## Open Questions

- ¿Cambia el plan si el cliente pone el inventario al día con la (36) antes de la campaña? No cambia el diseño, solo cuántas filas vincula la carga inicial.
