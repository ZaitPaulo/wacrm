## MODIFIED Requirements

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
