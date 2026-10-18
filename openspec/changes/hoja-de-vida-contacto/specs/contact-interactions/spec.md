## ADDED Requirements

### Requirement: Se pueden registrar interacciones con un contacto

Desde la ficha del contacto, un miembro con rol `agent` o superior SHALL poder registrar una interacción con:
- tipo: llamada saliente, llamada entrante, visita sin cita u otra;
- fecha y hora: por defecto ahora, se puede poner una pasada pero no futura;
- resultado (solo para llamadas): contestó, no contestó, buzón o número equivocado;
- duración en minutos, opcional;
- nota, opcional.

La interacción SHALL quedar a nombre de quien la registra y SHALL aparecer en la hoja de vida.

#### Scenario: Registrar una llamada saliente
- **WHEN** un asesor registra una llamada saliente contestada de 4 minutos con la nota "pide financiación"
- **THEN** la hoja de vida del contacto muestra la llamada con su resultado, duración, nota y el nombre del asesor

#### Scenario: Registrar después
- **WHEN** un asesor registra a las 5 p. m. una llamada que hizo a las 10 a. m.
- **THEN** la llamada queda ubicada a las 10 a. m. en la hoja de vida

#### Scenario: Fecha futura
- **WHEN** un asesor intenta registrar una interacción con fecha posterior a la actual
- **THEN** el sistema la rechaza y le indica que las visitas futuras se agendan en la Agenda

#### Scenario: Visita sin cita
- **WHEN** un asesor registra una visita sin cita con la nota "vino a ver la CX-30"
- **THEN** la visita aparece en la hoja de vida sin resultado ni duración

### Requirement: Cualquier asesor registra sobre cualquier contacto

El registro de interacciones SHALL estar disponible para todo miembro con rol `agent` o superior sobre cualquier contacto de su cuenta, aunque el contacto esté asignado a otro asesor. El rol `viewer` NO SHALL poder registrar interacciones.

#### Scenario: Llama el cliente de un compañero
- **WHEN** un cliente asignado a Angélica llama a Juan y Juan registra la llamada entrante
- **THEN** la llamada queda registrada a nombre de Juan en la hoja de vida del cliente

#### Scenario: Un viewer no registra
- **WHEN** un miembro con rol `viewer` abre la ficha de un contacto
- **THEN** no se le ofrece registrar interacciones, y una llamada directa a la API es rechazada

### Requirement: Solo el autor o un admin corrige una interacción

Una interacción SHALL poder editarse o borrarse solo por quien la registró, o por un miembro con rol `admin` u `owner`. La regla SHALL aplicarse en la base.

#### Scenario: Otro asesor intenta borrarla
- **WHEN** un `agent` intenta borrar una interacción registrada por otro asesor
- **THEN** la operación es rechazada y la interacción se conserva

#### Scenario: El autor corrige la duración
- **WHEN** el asesor que registró una llamada cambia su duración de 4 a 6 minutos
- **THEN** la hoja de vida muestra 6 minutos
