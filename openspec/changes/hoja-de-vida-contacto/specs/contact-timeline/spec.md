## ADDED Requirements

### Requirement: La hoja de vida reúne toda la historia del contacto

La hoja de vida SHALL presentar en una sola línea de tiempo, de lo más reciente a lo más antiguo, los eventos de estas fuentes:
- primer contacto y su origen (anuncio de referencia si lo hubo);
- conversaciones, una entrada por hilo;
- asignaciones y traspasos;
- citas y sus eventos (agendada, movida, reasignada, confirmada por el cliente, asistió, no asistió, cancelada);
- negocios creados, sus cambios de etapa y su cierre;
- consultas por un vehículo;
- vehículos vendidos al contacto;
- vehículos que el contacto dejó en consignación;
- vehículos comprados o recibidos en retoma al contacto;
- documentos;
- notas;
- interacciones registradas.

La hoja de vida SHALL calcularse a partir de las tablas de origen al consultarla. Una edición o un borrado en el origen SHALL reflejarse sin pasos adicionales.

#### Scenario: Cliente con historia variada
- **WHEN** un usuario abre la hoja de vida de un contacto que escribió por WhatsApp, tuvo una cita a la que asistió y compró un vehículo
- **THEN** ve, ordenados por fecha descendente, la venta, la cita con su asistencia y la conversación de WhatsApp

#### Scenario: Se cancela una cita
- **WHEN** una cita del contacto se cancela en la Agenda
- **THEN** al volver a abrir la hoja de vida, la cita figura como cancelada

#### Scenario: Contacto sin historia
- **WHEN** un usuario abre la hoja de vida de un contacto recién creado sin actividad
- **THEN** ve un estado vacío que lo invita a registrar una interacción o una nota

### Requirement: Las conversaciones se resumen por hilo

Cada conversación SHALL aparecer como una sola entrada con su canal, la fecha del primer y del último mensaje, la cantidad de mensajes, el asesor que la atiende y si hubo traspaso del bot. La entrada SHALL permitir abrir el hilo completo en solo lectura.

#### Scenario: Hilo largo
- **WHEN** un contacto tiene una conversación de WhatsApp con 240 mensajes
- **THEN** la hoja de vida muestra una sola entrada para ese hilo, con el conteo de 240

#### Scenario: Leer un hilo ajeno
- **WHEN** un `agent` abre desde la hoja de vida el hilo de una conversación asignada a otro asesor
- **THEN** ve los mensajes y adjuntos en solo lectura, con el nombre del asesor que atiende, sin compositor ni acciones sobre los mensajes

#### Scenario: El asignado salta a la bandeja
- **WHEN** el asesor asignado abre desde la hoja de vida un hilo suyo
- **THEN** se le ofrece "Abrir en la bandeja", que lo lleva a esa conversación con el compositor disponible

### Requirement: Los cambios de etapa de los negocios quedan registrados

Cada cambio de etapa o de estado de un negocio SHALL registrarse con la etapa o estado de origen, el de destino, la fecha y quién lo hizo (vacío si lo hizo un proceso automático). El registro SHALL hacerse en la base, para que cualquier camino que cambie la etapa (embudo, automatizaciones, API) quede cubierto. Los cambios anteriores a esta entrega no se reconstruyen.

#### Scenario: Se mueve un negocio en el embudo
- **WHEN** un asesor mueve el negocio de un contacto de "Prospecto" a "Negociación"
- **THEN** la hoja de vida del contacto muestra "Prospecto → Negociación" con su fecha y el nombre del asesor

#### Scenario: Una automatización mueve el negocio
- **WHEN** una automatización cambia la etapa de un negocio
- **THEN** el cambio aparece en la hoja de vida sin autor humano

### Requirement: Todo miembro de la cuenta ve la hoja de vida completa

Cualquier miembro de la cuenta, sin importar su rol ni a quién esté asignado el contacto, SHALL ver todos los eventos de la hoja de vida de cualquier contacto de su cuenta. Ningún miembro SHALL ver eventos de contactos de otra cuenta.

#### Scenario: El asesor ve lo que hizo otro asesor
- **WHEN** un `agent` abre la hoja de vida de un contacto que antes atendió otro asesor
- **THEN** ve las citas, los negocios y las conversaciones de ese otro asesor con el contacto

#### Scenario: Otra cuenta
- **WHEN** un miembro pide la hoja de vida de un contacto de otra cuenta, aunque conozca su id
- **THEN** recibe cero eventos

### Requirement: El costo de adquisición no aparece en la hoja de vida para quien no es admin

Los eventos de compra o retoma SHALL mostrar el vehículo, la fecha y el tipo (compra o retoma) a todo miembro. El costo de adquisición SHALL incluirse solo para miembros con rol `admin` u `owner`. La exclusión SHALL hacerse en la base: la respuesta que recibe un `agent` o `viewer` NO SHALL contener el costo.

#### Scenario: El asesor ve la compra sin el precio
- **WHEN** un `agent` abre la hoja de vida de un contacto al que el negocio le compró un Chevrolet Spark 2015
- **THEN** ve "Le compramos Chevrolet Spark 2015" con la fecha, y la respuesta de la API no contiene el costo

#### Scenario: El dueño ve el costo
- **WHEN** un `owner` abre la misma hoja de vida
- **THEN** ve la compra con su costo de adquisición

### Requirement: La hoja de vida se filtra y se pagina

La hoja de vida SHALL permitir filtrar por tipo de evento (citas, llamadas e interacciones, conversaciones, negocios, vehículos, documentos y notas) y SHALL cargar los eventos por páginas, trayendo los más antiguos a pedido. El orden SHALL ser estable aunque dos eventos tengan la misma fecha.

#### Scenario: Ver solo las citas
- **WHEN** un usuario elige el filtro "Citas"
- **THEN** la línea de tiempo muestra únicamente las citas y sus eventos

#### Scenario: Cargar más
- **WHEN** el contacto tiene más eventos de los que caben en una página y el usuario llega al final
- **THEN** se cargan los siguientes más antiguos, sin repetir ni saltar ninguno

### Requirement: La hoja de vida tiene un resumen del cliente

Encima de la línea de tiempo SHALL mostrarse un resumen con: cliente desde (fecha del primer evento), asesor que lo atiende por canal, citas totales y asistidas, vehículos que compró, vehículos que nos vendió o entregó en retoma, vehículos en consignación y negocios abiertos.

#### Scenario: Resumen de un cliente recurrente
- **WHEN** un contacto tuvo 3 citas (2 asistidas), compró un vehículo y entregó otro en retoma
- **THEN** el resumen muestra 3 citas, 2 asistidas, 1 comprado y 1 recibido en retoma
