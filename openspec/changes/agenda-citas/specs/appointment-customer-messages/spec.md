## ADDED Requirements

### Requirement: Configuración de los mensajes al cliente
La cuenta SHALL tener una configuración de Agenda, editable solo por owner y admin, con: mensajes al cliente activados o no (desactivados por defecto), la plantilla de confirmación, la plantilla de recordatorio, la hora del recordatorio (10:00 por defecto), la hora del resumen diario (07:30 por defecto) y la duración por defecto de las citas (30 minutos). Los mensajes NO SHALL poder activarse sin las dos plantillas elegidas.

#### Scenario: Activar sin plantillas
- **WHEN** un admin intenta activar los mensajes al cliente sin haber elegido la plantilla de recordatorio
- **THEN** Ajustes no lo permite y explica que falta la plantilla

#### Scenario: Asesor
- **WHEN** un asesor abre Ajustes
- **THEN** no puede cambiar la configuración de la Agenda

### Requirement: Contrato de las plantillas
Una plantilla SHALL poder elegirse para la Agenda solo si está aprobada, no tiene encabezado con multimedia ni con variable, y su cuerpo usa de cero a cuatro variables, siempre las primeras N en este orden: 1 nombre del cliente, 2 fecha y hora de la cita, 3 nombre completo del asesor, 4 vehículos. La plantilla de recordatorio, además, SHALL tener exactamente dos botones de respuesta rápida: el primero confirma y el segundo pide cambiar la hora.

#### Scenario: Recordatorio sin botones
- **WHEN** el admin elige como recordatorio una plantilla sin botones
- **THEN** Ajustes la rechaza indicando que necesita los dos botones

#### Scenario: Variables salteadas
- **WHEN** el admin elige una plantilla cuyo cuerpo usa `{{1}}` y `{{3}}` pero no `{{2}}`
- **THEN** Ajustes la rechaza

### Requirement: Confirmación al agendar o reagendar
Al crear o reagendar una cita con «Avisar al cliente» marcado y los mensajes activos, el sistema SHALL dejarla pendiente de confirmación y enviarla en menos de dos minutos, sin depender de que el navegador siga abierto. Con la ventana de 24 horas abierta SHALL enviarse como texto libre con la fecha, la hora, el vehículo, la dirección del negocio y el nombre del asesor. Con la ventana cerrada, en WhatsApp SHALL enviarse la plantilla de confirmación, pero solo dentro del horario de atención (si está fuera, espera a la apertura). Si la conversación no es de WhatsApp (Instagram o Facebook, por donde el CRM todavía no envía por iniciativa propia) NO SHALL enviarse y la cita SHALL quedar marcada como no enviada. Cada resultado (enviada, omitida o fallida) SHALL quedar en el historial de la cita.

#### Scenario: Agendar desde el chat
- **WHEN** el asesor agenda una visita para un cliente que escribió hace 10 minutos
- **THEN** el cliente recibe un texto con «Tu visita quedó agendada», la fecha y hora y el nombre del asesor

#### Scenario: Ventana cerrada fuera de horario
- **WHEN** se agenda a las 20:00 para un cliente que no escribe hace 3 días, con el horario abierto hasta las 18:00
- **THEN** la plantilla de confirmación sale a la apertura del día siguiente

#### Scenario: Conversación de Instagram
- **WHEN** se agenda una cita cuya conversación es de Instagram
- **THEN** no se envía la confirmación y el historial de la cita dice que no se envió

#### Scenario: Sin avisar
- **WHEN** el asesor crea la cita con «Avisar al cliente» desmarcado
- **THEN** no se envía ningún mensaje

### Requirement: Recordatorio el día anterior
Con los mensajes activos, el sistema SHALL enviar la plantilla de recordatorio por WhatsApp a cada cita `scheduled` o `confirmed` del día siguiente, una sola vez, a partir de la hora configurada y dentro del horario de atención. NO SHALL enviarse si la hora vigente de la cita se fijó el mismo día del envío (ya recibió su confirmación), si la cita no es de WhatsApp, o si ya se le envió recordatorio para esa hora. Dos pasadas solapadas del proceso NO SHALL enviarle dos recordatorios a la misma cita.

#### Scenario: Recordatorio normal
- **WHEN** son las 10:00 del lunes y Jorge tiene cita el martes a las 14:00, agendada el sábado
- **THEN** Jorge recibe el recordatorio con los botones «Confirmo» y «Necesito cambiar la hora»

#### Scenario: Agendada hoy para mañana
- **WHEN** la cita del martes se agendó el lunes a las 15:00
- **THEN** no se envía recordatorio el lunes

#### Scenario: Reagendada después del recordatorio
- **WHEN** una cita que ya recibió recordatorio se mueve el domingo a otro día de la semana siguiente
- **THEN** recibe un recordatorio nuevo el día anterior a la fecha nueva

### Requirement: Respuesta del cliente al recordatorio
Cuando el cliente toca un botón del recordatorio, el sistema SHALL procesarlo antes de los flujos, las automatizaciones por contenido y el bot de IA, y ninguno de ellos SHALL responder a ese toque. Si la cita sigue activa, es de ese contacto y su hora no cambió desde el recordatorio: «Confirmo» SHALL pasarla a `confirmed` y responderle al cliente con un acuse que repite la fecha y la hora; «Necesito cambiar la hora» SHALL marcar que el cliente pidió un cambio, avisar al asesor y responder que el asesor le escribirá. Si la cita se canceló o cambió de hora, NO SHALL modificarse y SHALL responderse que el asesor confirmará los detalles.

#### Scenario: Confirma
- **WHEN** Jorge toca «Confirmo» en el recordatorio de su cita del martes a las 14:00
- **THEN** la cita queda `confirmed` y Jorge recibe «¡Listo! Te esperamos el martes 7 de octubre a las 2:00 p. m.»

#### Scenario: Pide cambiar
- **WHEN** Jorge toca «Necesito cambiar la hora»
- **THEN** la cita registra el pedido de cambio, Angélica recibe un aviso y Jorge recibe un mensaje de que Angélica le escribirá

#### Scenario: Botón de un recordatorio viejo
- **WHEN** Jorge toca «Confirmo» en un recordatorio de una cita que luego se movió a otra hora
- **THEN** la cita no cambia y Jorge recibe que su asesor le confirmará los detalles

#### Scenario: El bot no contesta
- **WHEN** el cliente toca cualquiera de los dos botones con el bot de IA activo en la conversación
- **THEN** el bot no genera respuesta para ese mensaje
