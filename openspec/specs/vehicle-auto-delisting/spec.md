# vehicle-auto-delisting Specification

## Purpose
TBD - created by archiving change baja-de-vehiculos-por-propietario. Update Purpose after archive.
## Requirements
### Requirement: Paso de automatización "Ocultar el vehículo del contacto"

Las automatizaciones SHALL tener un paso "Ocultar el vehículo del contacto", sin configuración. Cuando el contacto del disparo es propietario de **exactamente un** vehículo disponible, el paso SHALL pasarlo a oculto. Cuando no es propietario de ninguno, o lo es de más de uno, el paso MUST NOT ocultar nada y SHALL dejar el motivo en el registro de la automatización, sin marcar la corrida como fallida. El paso MUST NOT enviar mensajes ni cambiar la asignación de la conversación, y MUST NOT tocar vehículos reservados, vendidos u ocultos.

#### Scenario: El dueño toca NO y tiene un solo vehículo
- **WHEN** la automatización del botón `NO` corre para un contacto propietario de un solo vehículo disponible
- **THEN** ese vehículo pasa a oculto, deja de verse en la vitrina y el bot deja de ofrecerlo

#### Scenario: El dueño tiene dos vehículos
- **WHEN** el paso corre para un contacto propietario de dos vehículos disponibles
- **THEN** no oculta ninguno, y el registro dice que el contacto tiene dos vehículos y no se tocó ninguno

#### Scenario: El contacto no es propietario
- **WHEN** el paso corre para un contacto que no es propietario de ningún vehículo disponible
- **THEN** no oculta nada y los pasos siguientes de la automatización se ejecutan igual

#### Scenario: La conversación sigue llegando a una persona
- **WHEN** el dueño toca `NO` y otra automatización asigna sus mensajes a Angélica
- **THEN** el vehículo se oculta y la conversación queda asignada a Angélica, como sin este paso

### Requirement: Baja por silencio configurable en la difusión

Al crear una difusión, el usuario SHALL poder activar la baja por silencio y elegir el plazo entre 30, 45, 60 y 90 días, con 60 por defecto. El plazo SHALL contarse desde el envío del mensaje original a cada destinatario, no desde el recordatorio. La baja por silencio SHALL ser opcional e independiente del recordatorio: una difusión puede tener una, la otra, las dos o ninguna.

#### Scenario: Activar la baja por silencio
- **WHEN** el usuario crea la difusión a los propietarios con la baja por silencio activa y el plazo por defecto
- **THEN** la difusión queda guardada con un plazo de 60 días

#### Scenario: El plazo cuenta desde el primer mensaje
- **WHEN** a un destinatario la consulta le llegó el 14 de septiembre y el recordatorio el 16
- **THEN** su plazo de 60 días vence el 13 de noviembre

### Requirement: La baja por silencio oculta los vehículos de quien no respondió

Vencido el plazo, el sistema SHALL ocultar todos los vehículos disponibles de los que sea propietario cada destinatario cuyo mensaje original salió (estado `sent`, `delivered` o `read`) y que no escribió nada después de ese envío, ni con un botón ni con texto. A un destinatario que respondió, que escribió algo después del envío o cuyo mensaje original falló, MUST NOT ocultársele nada. La baja SHALL aplicarse aunque la cuenta esté fuera de su horario de atención, porque no envía ningún mensaje.

#### Scenario: Dos meses de silencio
- **WHEN** a un propietario de dos vehículos disponibles le llegaron la consulta y el recordatorio, y no escribió nada en 60 días
- **THEN** sus dos vehículos pasan a ocultos

#### Scenario: Respondió SI
- **WHEN** el propietario tocó `SI` al tercer día
- **THEN** a los 60 días no se le oculta ningún vehículo

#### Scenario: Escribió un texto
- **WHEN** el propietario escribió "ya lo vendí" al décimo día sin tocar ningún botón
- **THEN** la baja por silencio no le oculta nada; ese caso lo resuelve una persona

### Requirement: Cada destinatario se revisa una sola vez

El sistema SHALL aplicar la baja por silencio como máximo una vez por destinatario y por difusión. Un vehículo que una persona vuelve a publicar después de una baja MUST NOT volver a ocultarse por esa misma difusión.

#### Scenario: Se vuelve a publicar
- **WHEN** Angélica vuelve a poner disponible un vehículo que la baja por silencio ocultó
- **THEN** ninguna pasada posterior de esa difusión lo vuelve a ocultar

### Requirement: Todo vehículo ocultado automáticamente queda explicado

Cada vez que el sistema oculta un vehículo por su cuenta, SHALL agregar a sus notas internas la fecha y el motivo ("el propietario respondió que ya no está disponible" o "el propietario no respondió en N días"), conservando lo que las notas ya decían. Ocultar SHALL ser reversible: el vehículo sigue en el inventario y vuelve a publicarse cambiando su estado.

#### Scenario: Nota del motivo
- **WHEN** la baja por silencio oculta un vehículo que ya tenía notas internas
- **THEN** las notas conservan lo anterior y agregan la fecha y el motivo de la baja

### Requirement: La baja por silencio se cancela con el seguimiento

Cancelar el seguimiento de una difusión SHALL cancelar también su baja por silencio: después de cancelar, el sistema MUST NOT ocultar ningún vehículo por el silencio en esa difusión. El detalle de la difusión SHALL mostrar cuándo vence la baja por silencio y cuántos vehículos ocultó.

#### Scenario: Cancelar antes del plazo
- **WHEN** el usuario cancela el seguimiento a los 30 días de una difusión con baja a 60 días
- **THEN** a los 60 días no se oculta ningún vehículo

#### Scenario: Ver el resultado
- **WHEN** la baja por silencio ya ocultó 12 vehículos
- **THEN** el detalle de la difusión muestra que se ocultaron 12 vehículos

