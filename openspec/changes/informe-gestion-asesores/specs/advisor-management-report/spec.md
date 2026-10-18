## ADDED Requirements

### Requirement: Solo admin o superior genera el informe de gestión

El sistema SHALL permitir descargar el informe de gestión únicamente a miembros de la cuenta con rol `admin` u `owner`. La restricción SHALL aplicarse en el servidor (`requireRole('admin')` en la ruta), además de ocultar el botón en la interfaz. El informe SHALL contener solo contactos de la cuenta de quien lo pide.

#### Scenario: El dueño descarga el informe

- **WHEN** un usuario con rol `owner` pide el informe
- **THEN** recibe un archivo `.xlsx` con los clientes de su cuenta

#### Scenario: Un asesor llama la ruta directamente

- **WHEN** un usuario con rol `agent` hace `GET /api/reports/management`
- **THEN** la respuesta es 403 y no se genera ningún archivo

#### Scenario: Un asesor abre Contactos

- **WHEN** un usuario con rol `agent` o `viewer` abre la página de Contactos
- **THEN** no ve el botón "Informe de gestión"

#### Scenario: Sin sesión

- **WHEN** alguien sin sesión pide el informe
- **THEN** la respuesta es 401

### Requirement: Una fila por cliente con los datos de la gestión

El informe SHALL traer una fila por contacto de la cuenta que no esté fusionado (`merged_into_contact_id` nulo), con estas columnas: cliente (nombre, o el teléfono si no tiene nombre), teléfono, canal de la conversación más reciente, fecha de llegada, asesor, embudo, etapa, estado del negocio, etiquetas, último mensaje del cliente (fecha), último mensaje del asesor (fecha), mensajes del cliente, mensajes del asesor, mensajes del bot, citas agendadas, citas a las que asistió, citas a las que no asistió, citas canceladas, próxima cita, última nota (fecha, autor y texto), resumen del traspaso del bot y resumen de gestión.

Las filas SHALL ordenarse por fecha de llegada, de la más reciente a la más antigua. Las fechas SHALL escribirse como fechas de Excel, no como texto, en la zona horaria de la cuenta.

#### Scenario: Cliente con toda la información

- **WHEN** un cliente llegó el 2026-10-01, tiene una conversación asignada a Angélica, un negocio abierto en la etapa "Cita agendada", las etiquetas `crédito` y `propietario`, una cita a la que asistió y una nota
- **THEN** su fila trae la fecha 2026-10-01, la asesora Angélica, el embudo y la etapa "Cita agendada", las dos etiquetas, una cita asistida y la nota con su fecha y autor

#### Scenario: Cliente que no ha hecho nada

- **WHEN** un cliente no tiene conversaciones, negocios, citas ni notas
- **THEN** aparece igual en el informe, con el asesor "Sin asignar", las columnas de negocio vacías y los contadores en 0

#### Scenario: Contacto fusionado

- **WHEN** un contacto fue fusionado en otro
- **THEN** el contacto fusionado no aparece y el que lo absorbió sí

### Requirement: Fecha de llegada

La fecha de llegada de un cliente SHALL ser la fecha de creación del contacto (`contacts.created_at`).

#### Scenario: Cliente que escribió por primera vez hace dos semanas

- **WHEN** el contacto se creó al llegar su primer mensaje el 2026-10-03
- **THEN** su fecha de llegada en el informe es 2026-10-03

### Requirement: Asesor que atiende al cliente

El asesor de un cliente SHALL ser el asignado (`assigned_agent_id`) de su conversación más reciente, es decir, la de `last_message_at` mayor. Si esa conversación no tiene asesor, o el cliente no tiene conversaciones, SHALL tomarse el asignado (`assigned_to`) de su negocio más reciente. Si tampoco hay, el asesor SHALL ser "Sin asignar". El nombre SHALL salir de `profiles.full_name`.

#### Scenario: Conversación con asesor

- **WHEN** la conversación más reciente del cliente está asignada a Juan
- **THEN** el asesor del informe es Juan

#### Scenario: Conversación sin asesor pero negocio asignado

- **WHEN** la conversación más reciente no tiene asesor y el negocio más reciente está asignado a Angélica
- **THEN** el asesor del informe es Angélica

#### Scenario: Nadie lo atiende

- **WHEN** ni la conversación ni el negocio tienen asesor
- **THEN** el asesor del informe es "Sin asignar"

### Requirement: Estado en el negocio

El negocio que se reporta SHALL ser el negocio abierto más reciente del cliente (`updated_at` mayor). Si no tiene negocios abiertos, SHALL ser su negocio más reciente en cualquier estado. De ese negocio se reportan el nombre del embudo, el nombre de la etapa y el estado (abierto, ganado o perdido). Además, la columna de etiquetas SHALL traer todas las etiquetas del contacto separadas por coma y en orden alfabético.

#### Scenario: Un negocio abierto y uno perdido

- **WHEN** un cliente tiene un negocio perdido de agosto y uno abierto en "Negociación" de octubre
- **THEN** el informe muestra "Negociación" con el estado abierto

#### Scenario: Solo negocios cerrados

- **WHEN** todos los negocios de un cliente están cerrados y el último se ganó
- **THEN** el informe muestra la etapa de ese negocio con el estado ganado

### Requirement: Resumen de gestión sin IA

El resumen de gestión SHALL armarse de forma determinista con los datos del cliente, sin llamar a ningún modelo de IA. SHALL ser un texto corto, de una a tres líneas, con este orden, y SHALL omitir cada parte que no tenga datos:

1. la última acción del asesor: "Último mensaje del asesor hace N días" o "El asesor no le ha escrito";
2. si el cliente espera respuesta, porque su último mensaje es posterior al último del asesor: "Cliente sin respuesta desde <fecha>";
3. las citas: "Citas: N (asistió A, no asistió B)" y, si hay una próxima, "próxima <fecha>";
4. la última nota, recortada a 200 caracteres;
5. si no hay nota, el resumen del traspaso del bot, recortado a 200 caracteres.

Las columnas con los datos sueltos SHALL incluirse siempre, aunque el resumen también los mencione.

#### Scenario: Cliente esperando respuesta

- **WHEN** el último mensaje del cliente fue el 2026-10-15 y el asesor le escribió por última vez el 2026-10-10
- **THEN** el resumen incluye "Cliente sin respuesta desde 15/10/2026"

#### Scenario: Sin notas pero con traspaso del bot

- **WHEN** el cliente no tiene notas y su conversación tiene `ai_handoff_summary`
- **THEN** el resumen termina con el texto del traspaso, recortado a 200 caracteres

#### Scenario: El asesor nunca escribió

- **WHEN** ningún mensaje de la conversación tiene `sender_type = 'agent'` con `sender_id` no nulo
- **THEN** el resumen empieza con "El asesor no le ha escrito"

### Requirement: Mensajes del asesor cuentan solo los de una persona

Un mensaje SHALL contarse como del asesor solo si tiene `sender_type = 'agent'` y `sender_id` no nulo. Los mensajes de automatizaciones, flujos, recordatorios y la API v1 (`agent` sin `sender_id`) y los del bot (`sender_type = 'bot'`) SHALL contarse en la columna de mensajes del bot, y no SHALL contar como gestión del asesor.

#### Scenario: Solo hubo recordatorio de cita automático

- **WHEN** el único mensaje saliente de la conversación es el recordatorio automático de la cita
- **THEN** la columna de mensajes del asesor es 0 y la del bot es 1

### Requirement: Filtros de la descarga

La descarga SHALL aceptar como filtros un rango de fecha de llegada (`from` y `to`, fechas inclusive en la zona horaria de la cuenta) y un asesor (`agent`: el id de un miembro, `unassigned`, o vacío para todos). Si no se envía rango, SHALL usarse los últimos 30 días hasta hoy. El filtro de asesor SHALL aplicarse sobre el asesor que se calcula en el informe. Un rango invertido o una fecha inválida SHALL responder 400. El filtro de asesor SHALL compararse contra miembros de la cuenta, y un id que no sea miembro SHALL responder 400.

#### Scenario: Informe de un asesor en un mes

- **WHEN** el dueño pide `from=2026-09-01`, `to=2026-09-30` y `agent=<id de Angélica>`
- **THEN** el archivo trae solo los clientes que llegaron en septiembre y cuyo asesor es Angélica

#### Scenario: Clientes sin asignar

- **WHEN** el dueño pide `agent=unassigned`
- **THEN** el archivo trae solo los clientes cuyo asesor es "Sin asignar"

#### Scenario: Rango invertido

- **WHEN** `from` es posterior a `to`
- **THEN** la respuesta es 400 con un mensaje en español

### Requirement: Formato del archivo

El archivo SHALL ser un `.xlsx` llamado `informe-gestion-AAAA-MM-DD.xlsx`, con la fecha de generación. SHALL tener una hoja "Clientes" con la fila de encabezados fija, filtro automático y anchos de columna legibles, y una hoja "Parámetros" con la fecha de generación, quién lo generó, el rango, el asesor filtrado y el total de clientes. Si el resultado supera el máximo de filas (10.000), el informe SHALL traer solo las primeras 10.000 y la hoja "Parámetros" SHALL decir que está recortado y que se debe acotar el rango.

#### Scenario: Descarga normal

- **WHEN** el dueño descarga el informe el 2026-10-17
- **THEN** recibe `informe-gestion-2026-10-17.xlsx` con las hojas "Clientes" y "Parámetros"

#### Scenario: Resultado demasiado grande

- **WHEN** el rango cubre más de 10.000 clientes
- **THEN** la hoja "Clientes" trae 10.000 filas y "Parámetros" avisa que el informe está recortado

#### Scenario: Ningún cliente en el rango

- **WHEN** ningún cliente llegó en el rango pedido
- **THEN** se descarga igual el archivo, con los encabezados, sin filas y con el total 0 en "Parámetros"
