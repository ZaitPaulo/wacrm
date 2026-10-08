## ADDED Requirements

### Requirement: Indicadores de citas por asesor y período
El panel SHALL mostrar a owner y admin un bloque «Citas y asistencia» con una fila por asesor que tuvo citas en el período elegido en el selector de período del panel. Cada fila SHALL mostrar: citas (con inicio en el período, sin contar las canceladas), asistió, no asistió, sin marcar (citas activas cuya hora de fin ya pasó), canceladas y porcentaje de asistencia. Los roles agent y viewer NO SHALL ver el bloque, y la base NO SHALL devolverles datos aunque los pidan.

#### Scenario: Mes con citas
- **WHEN** un admin elige 30 días y Carlos tuvo 10 citas: 6 asistió, 2 no asistió, 1 sin marcar y 1 programada a futuro, además de 1 cancelada
- **THEN** la fila de Carlos muestra 10 citas, 6 asistió, 2 no asistió, 1 sin marcar, 1 cancelada y 75 % de asistencia

#### Scenario: Asesor
- **WHEN** un asesor abre el panel
- **THEN** no ve el bloque de citas y asistencia

### Requirement: El porcentaje de asistencia ignora lo que falta marcar
El porcentaje de asistencia SHALL calcularse como asistió entre asistió más no asistió. Las citas sin marcar, las futuras y las canceladas NO SHALL contar. Sin citas marcadas, el porcentaje SHALL mostrarse vacío y no 0 %.

#### Scenario: Nada marcado
- **WHEN** un asesor tiene 3 citas en el período y ninguna marcada
- **THEN** su porcentaje se muestra como «—» y sus 3 citas aparecen como sin marcar

### Requirement: Ventas que vinieron de una visita
Cada fila SHALL mostrar las ventas que vinieron de una visita: vehículos con fecha de venta en el período cuyo comprador registrado tuvo una cita `attended` entre 0 y 30 días antes de la venta. Cada venta SHALL atribuirse una sola vez, al asesor de la cita asistida más reciente anterior a la venta. Las ventas sin comprador registrado NO SHALL contarse. El bloque SHALL explicar esta condición en pantalla.

#### Scenario: Venta después de una visita
- **WHEN** Jorge asistió el 7 de octubre con Angélica y el 15 de octubre se marca vendida la Tracker con Jorge como comprador
- **THEN** la venta cuenta para Angélica en un período que incluya el 15 de octubre

#### Scenario: Dos visitas antes de la venta
- **WHEN** Jorge visitó con Carlos el 1 y con Angélica el 10, y compró el 12
- **THEN** la venta cuenta solo para Angélica

#### Scenario: Venta sin comprador
- **WHEN** un carro se marca vendido sin vincular comprador
- **THEN** no cuenta como venta de visita

#### Scenario: Visita muy anterior
- **WHEN** la última visita del comprador fue 45 días antes de la venta
- **THEN** no cuenta como venta de visita
