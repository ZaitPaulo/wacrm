# in-app-notification-alerts Specification

## Purpose
TBD - created by archiving change push-notifications. Update Purpose after archive.
## Requirements
### Requirement: Aviso emergente con el CRM abierto
Con una pestaña del CRM visible, cada notificación nueva sin leer del usuario, y cada notificación `new_message` refrescada, SHALL mostrar un aviso emergente dentro de la app con título, cuerpo y una acción para abrir la conversación, y SHALL reproducir un sonido corto. NO SHALL mostrarse ni sonar si el usuario ya está mirando esa misma conversación en la bandeja, ni si la pestaña está oculta.

#### Scenario: Mensaje con la bandeja abierta en otra conversación
- **WHEN** llega un mensaje de la conversación B mientras el asesor tiene abierta la conversación A
- **THEN** aparece el aviso emergente de B con sonido

#### Scenario: Mensaje de la conversación que ya está mirando
- **WHEN** llega un mensaje de la conversación A mientras el asesor la tiene abierta
- **THEN** no aparece aviso emergente ni suena

### Requirement: Sin avisos duplicados
Con una pestaña del CRM visible, el service worker NO SHALL mostrar el aviso del sistema operativo para un push de notificación (el aviso emergente de la app lo reemplaza), salvo en navegadores WebKit (Safari, iOS), que exigen mostrar un aviso por cada push. En esos navegadores, si este dispositivo tiene los avisos activados, la app NO SHALL mostrar su propio aviso emergente ni sonido. El aviso de prueba SHALL mostrarse siempre.

#### Scenario: Chrome con la pestaña visible
- **WHEN** llega un push en Chrome con una pestaña del CRM visible
- **THEN** no se muestra el aviso del sistema y sí el emergente de la app

#### Scenario: CRM cerrado
- **WHEN** llega un push y no hay ninguna pestaña del CRM visible
- **THEN** se muestra el aviso del sistema con sonido/vibración

### Requirement: Tocar el aviso abre la conversación
Tocar el aviso del sistema SHALL enfocar una pestaña del CRM ya abierta y navegarla al destino del aviso, o abrir una nueva en ese destino si no hay ninguna. El destino SHALL ser `/inbox?c=<id>` para los avisos de conversación, `/agenda?cita=<id>` para los avisos de una cita (`appointment_assigned` y `appointment_change_requested`) y `/agenda?vista=dia` para el resumen diario (`appointment_digest`). La campana y el aviso emergente dentro de la app SHALL llevar al mismo destino.

#### Scenario: Pestaña ya abierta
- **WHEN** el asesor toca el aviso con el CRM abierto en segundo plano
- **THEN** esa pestaña pasa al frente mostrando la conversación, sin abrir otra

#### Scenario: Aviso de cita asignada
- **WHEN** el asesor toca el aviso «Nueva cita: Laura Gómez, lunes 6, 9:00 a. m.»
- **THEN** el CRM abre la Agenda en el lunes 6 con el detalle de esa cita

#### Scenario: Resumen diario desde la campana
- **WHEN** el asesor toca en la campana el resumen «Tus visitas de hoy: 2»
- **THEN** el CRM abre la Agenda en la vista Día de hoy

### Requirement: Abrir la conversación limpia sus avisos
Al abrir una conversación en la bandeja, el sistema SHALL marcar leídas las notificaciones `new_message` sin leer de esa conversación del usuario y SHALL cerrar el aviso del sistema de esa conversación en este dispositivo.

#### Scenario: Abrir desde la bandeja
- **WHEN** el asesor abre la conversación C que tenía una notificación de mensaje sin leer
- **THEN** esa notificación queda leída y el contador de la campana baja

