## ADDED Requirements

### Requirement: Una difusión puede configurar un seguimiento

Al crear una difusión desde el asistente, el usuario SHALL poder activar un seguimiento indicando una plantilla y un plazo en días enteros entre 1 y 7. El seguimiento SHALL ser opcional: una difusión sin él MUST comportarse exactamente igual que antes de este cambio. La configuración SHALL quedar guardada en la difusión en el momento de crearla.

#### Scenario: Activar el seguimiento
- **WHEN** el usuario crea una difusión con la plantilla `consulta_vehiculo_disponible`, activa el seguimiento, elige la plantilla de recordatorio y un plazo de 2 días
- **THEN** la difusión queda guardada con esa plantilla de recordatorio, su idioma y un plazo de 48 horas

#### Scenario: Difusión sin seguimiento
- **WHEN** el usuario crea una difusión sin activar el seguimiento
- **THEN** ningún destinatario de esa difusión recibe nunca un recordatorio

#### Scenario: Solo plantillas aprobadas
- **WHEN** el usuario abre el selector de plantilla del recordatorio
- **THEN** solo aparecen las plantillas de la cuenta con estado aprobado

### Requirement: La plantilla del recordatorio debe poder enviarse sin datos nuevos

La plantilla del recordatorio SHALL poder enviarse con los datos que la difusión ya tiene congelados por destinatario. El asistente MUST rechazar una plantilla de recordatorio que tenga encabezado de imagen, video o documento, encabezado de texto con variable, o un botón que pida un valor al enviar (un botón URL con variable), y MUST rechazarla también cuando su número de variables del cuerpo no sea cero ni igual al de la plantilla original. Cuando lo acepta, el recordatorio SHALL enviarse con los mismos valores de variables que recibió ese destinatario en el mensaje original, o sin ninguno si la plantilla del recordatorio no tiene variables.

#### Scenario: Recordatorio sin variables
- **WHEN** la plantilla original tiene `{{1}}` y la del recordatorio no tiene variables
- **THEN** el asistente la acepta y el recordatorio sale sin parámetros

#### Scenario: Mismo número de variables
- **WHEN** la plantilla original y la del recordatorio tienen `{{1}}`, y a un destinatario el original le llegó con `{{1}} = "Mazda 2"`
- **THEN** el recordatorio de ese destinatario sale con `{{1}} = "Mazda 2"`

#### Scenario: Número de variables incompatible
- **WHEN** la plantilla original no tiene variables y la del recordatorio tiene `{{1}}`
- **THEN** el asistente no permite crear la difusión con ese seguimiento y explica por qué

#### Scenario: Encabezado multimedia
- **WHEN** la plantilla elegida para el recordatorio tiene encabezado de imagen
- **THEN** el asistente no permite crear la difusión con ese seguimiento

### Requirement: El recordatorio solo le llega a quien recibió el mensaje y no respondió

Vencido el plazo, el sistema SHALL enviar el recordatorio únicamente a los destinatarios cuyo mensaje original salió (estado `sent`, `delivered` o `read`) y que no escribieron nada después de ese envío. Que el contacto escribió después SHALL comprobarse contra sus mensajes entrantes, no solo contra el estado del destinatario. Un destinatario `pending`, `failed` o `replied`, o cuyo contacto fue borrado, MUST NOT recibir recordatorio.

#### Scenario: No respondió
- **WHEN** a un destinatario el original le llegó (estado `read`) hace más de 2 días y el contacto no ha escrito desde entonces
- **THEN** se le envía el recordatorio

#### Scenario: Respondió con el botón
- **WHEN** el contacto tocó "SI" en el mensaje original y su destinatario quedó en `replied`
- **THEN** no se le envía el recordatorio

#### Scenario: Respondió, pero la respuesta se atribuyó a otra difusión
- **WHEN** el contacto está en dos difusiones, escribió después del envío de la primera, y la respuesta quedó marcada solo en la segunda
- **THEN** no se le envía el recordatorio de la primera, porque escribió después del envío original

#### Scenario: El original falló
- **WHEN** el envío original de un destinatario quedó `failed`
- **THEN** no se le envía el recordatorio

### Requirement: Cada destinatario recibe como máximo un recordatorio

El sistema MUST enviar como máximo un recordatorio por destinatario y por difusión, incluso si dos pasadas del proceso programado se solapan o si una pasada se interrumpe a mitad del envío. Ante la duda sobre si un recordatorio salió, el sistema MUST preferir no reenviarlo.

#### Scenario: Pasadas solapadas
- **WHEN** dos pasadas del proceso programado encuentran al mismo destinatario vencido al mismo tiempo
- **THEN** solo una de ellas le envía el recordatorio

#### Scenario: Pasada interrumpida
- **WHEN** una pasada reclamó a un destinatario y el proceso murió antes de registrar el resultado
- **THEN** ese destinatario no se reenvía, y pasado un tiempo prudencial queda marcado como fallido con un motivo que lo explica

### Requirement: El recordatorio sale solo, por el servidor y en horario de atención

Los recordatorios SHALL enviarse desde el servidor, por un proceso programado, sin que nadie tenga abierta la aplicación. Son envíos por iniciativa propia: cuando la cuenta tiene activo el horario de atención y el momento cae fuera de él, el sistema MUST aplazarlos hasta que vuelva a estar en horario.

#### Scenario: Plazo vencido en horario
- **WHEN** el plazo de un destinatario venció y la cuenta está en horario de atención
- **THEN** el recordatorio sale en la siguiente pasada del proceso programado

#### Scenario: Plazo vencido fuera de horario
- **WHEN** el plazo venció un domingo y la cuenta tiene el domingo cerrado
- **THEN** el recordatorio no sale el domingo y sale en la primera pasada dentro del horario siguiente

#### Scenario: Horario de atención apagado
- **WHEN** la cuenta no tiene activo el horario de atención
- **THEN** el recordatorio sale en cuanto vence el plazo, a cualquier hora

### Requirement: El seguimiento se puede cancelar

El usuario SHALL poder cancelar el seguimiento de una difusión desde su detalle. Cancelado, el sistema MUST NOT enviar ningún recordatorio que no hubiera salido todavía. Los que ya salieron SHALL seguir contando en las métricas.

#### Scenario: Cancelar a mitad del plazo
- **WHEN** el usuario cancela el seguimiento un día después de enviar la difusión, con un plazo de 2 días
- **THEN** ningún destinatario de esa difusión recibe recordatorio

#### Scenario: Cancelar con recordatorios ya enviados
- **WHEN** ya salieron 40 recordatorios y el usuario cancela
- **THEN** no salen más, y el detalle sigue mostrando los 40 enviados

### Requirement: La respuesta al recordatorio cuenta en la difusión original

Una respuesta que llegue después del recordatorio SHALL marcar como respondido al destinatario de la difusión original, igual que una respuesta al mensaje original, sin crear otra difusión. El detalle de la difusión SHALL mostrar cuántos recordatorios faltan por salir, cuántos salieron, cuántos fallaron y cuántos contactos respondieron después de su recordatorio.

#### Scenario: Responde al recordatorio
- **WHEN** un contacto que no había respondido toca "NO" en el recordatorio
- **THEN** su destinatario en la difusión original pasa a `replied` y el contador de respuestas de esa difusión sube

#### Scenario: Métricas del seguimiento
- **WHEN** el usuario abre el detalle de una difusión con seguimiento en la que salieron 30 recordatorios y 12 de esos contactos respondieron después
- **THEN** el detalle muestra 30 recordatorios enviados y 12 respuestas posteriores al recordatorio

### Requirement: Un recordatorio fallido no afecta a los demás

Si el envío de un recordatorio falla, el sistema SHALL registrar el fallo y su motivo en ese destinatario y SHALL seguir con los demás. Un recordatorio fallido MUST NOT reintentarse de forma automática ni cambiar el estado del mensaje original.

#### Scenario: Meta rechaza un recordatorio
- **WHEN** Meta rechaza el recordatorio de un destinatario porque la plantilla dejó de estar aprobada
- **THEN** ese destinatario queda con el recordatorio fallido y el motivo, su estado original no cambia, y los demás destinatarios de la pasada se procesan igual
