## ADDED Requirements

### Requirement: Todo mensaje saliente registra a su autor

El sistema SHALL guardar en `messages.sender_id` el usuario que originó cada mensaje saliente enviado por una persona. Sin ese dato no hay forma de saber quién respondió, y el tiempo de respuesta por asesor no es calculable.

Los mensajes de la IA y de las automatizaciones SHALL seguir distinguiéndose por `sender_type` y `ai_generated`, que ya cumplen esa función.

#### Scenario: El asesor responde desde la bandeja

- **WHEN** un asesor envía un mensaje a un cliente
- **THEN** el mensaje queda con `sender_type` de asesor y `sender_id` igual a su usuario

#### Scenario: Los mensajes históricos no se inventan

- **WHEN** se consultan mensajes anteriores a este cambio, que tienen `sender_id` vacío
- **THEN** quedan fuera del cálculo por asesor en vez de atribuirse a alguien

### Requirement: El dashboard muestra el rendimiento por asesor

El sistema SHALL mostrar en el dashboard una tabla con una fila por persona que atiende clientes en la cuenta, y para cada una: la cantidad de clientes en gestión, el desglose de sus negocios por etapa del embudo y su tiempo promedio de primera respuesta.

Atiende clientes, a efectos de esta tabla, todo miembro con rol `agent` —aunque no tenga nada asignado— y **todo miembro con cartera asignada**, sea cual sea su rol. Un administrador no es un asesor, pero si lleva conversaciones es trabajo suyo y no trabajo sin dueño: en la cuenta de producción hay una administradora con 70 conversaciones de la campaña de propietarios, y contarlas como huérfanas daría una lectura falsa. Un miembro sin rol `agent` y sin cartera NO SHALL aparecer, para no llenar la tabla de filas en cero de gente que no atiende.

Que la condición valga para cualquier rol, y no solo para `owner` y `admin`, es lo que sostiene el cuadre: si a un `viewer` se le asignara una conversación, esa conversación dejaría de ser huérfana —su dueño es miembro vigente— y sin fila donde caer la suma dejaría de cuadrar en silencio.

La suma de los clientes en gestión de todas las filas SHALL ser igual al total de conversaciones abiertas de la cuenta. Ese cuadre es la comprobación de que ninguna conversación se pierde ni se cuenta dos veces.

La tabla SHALL indicar el rol de cada fila, para que se entienda por qué alguien que no es asesor aparece en ella.

#### Scenario: El cuadre no se rompe

- **WHEN** se suman los clientes en gestión de todas las filas, incluida "Sin asignar"
- **THEN** el resultado es igual al total de conversaciones abiertas de la cuenta

Los clientes en gestión SHALL contarse como las conversaciones abiertas que tiene asignadas en ese momento.

La tabla NO SHALL acotarse a una ventana de tiempo: muestra **todo** lo asignado a cada asesor, sin importar cuándo entró. Un lead abierto desde hace tres meses cuenta igual que uno de hoy, porque sigue siendo trabajo en gestión.

#### Scenario: Tabla con tres asesores

- **WHEN** un `owner` abre el dashboard y la cuenta tiene tres asesores
- **THEN** ve tres filas, una por asesor, con sus tres métricas

#### Scenario: Asesor sin clientes asignados

- **WHEN** un asesor no tiene ninguna conversación abierta asignada
- **THEN** aparece en la tabla con cero clientes en gestión, no se omite

#### Scenario: Lead antiguo todavía en gestión

- **WHEN** un asesor tiene asignada una conversación abierta desde hace tres meses
- **THEN** esa conversación cuenta entre sus clientes en gestión

### Requirement: Lo que no tiene asesor se ve en su propia fila

El sistema SHALL mostrar en la tabla una fila adicional, "Sin asignar", con las conversaciones abiertas que no tienen asesor y los negocios que cuelgan de ellas.

Una conversación asignada a alguien que ya NO es miembro vigente de la cuenta SHALL contarse también en esa fila: si nadie la atiende, es trabajo sin dueño y debe verse como tal. El que se fue NO SHALL aparecer con fila propia.

Esa fila SHALL calcularse con el mismo criterio que las de los asesores para clientes en gestión y desglose por etapa. Su tiempo de respuesta SHALL presentarse como ausente, porque no hay nadie a quien medir.

Sin esa fila el trabajo sin dueño queda fuera de la vista del dueño de la cuenta: hoy son 105 conversaciones abiertas que ninguna métrica cuenta y que los asesores tampoco ven, por la restricción de visibilidad por asignación.

#### Scenario: Conversaciones sin dueño

- **WHEN** la cuenta tiene 108 conversaciones abiertas sin nadie asignado
- **THEN** la tabla muestra una fila "Sin asignar" con esas 108 como clientes en gestión

#### Scenario: Una administradora con cartera

- **WHEN** un miembro con rol `admin` tiene 70 conversaciones abiertas asignadas
- **THEN** aparece con fila propia y sus 70 clientes en gestión, y esas 70 NO se cuentan en "Sin asignar"

#### Scenario: Un administrador sin cartera

- **WHEN** un miembro con rol `admin` no tiene ninguna conversación ni negocio asignado
- **THEN** no aparece en la tabla

#### Scenario: La fila sin asignar no mide tiempo

- **WHEN** se muestra la fila "Sin asignar"
- **THEN** su tiempo promedio de respuesta aparece vacío, no como cero

#### Scenario: No queda nada sin dueño

- **WHEN** todas las conversaciones abiertas de la cuenta tienen asesor
- **THEN** la fila "Sin asignar" muestra cero clientes en gestión

#### Scenario: Un asesor deja la cuenta

- **WHEN** un asesor con 12 conversaciones abiertas asignadas deja de ser miembro de la cuenta
- **THEN** esas 12 pasan a contarse en la fila "Sin asignar" y el asesor desaparece de la tabla

#### Scenario: A un asesor le cambian el rol pero sigue en la cuenta

- **WHEN** un asesor con 12 conversaciones abiertas asignadas pasa a rol `viewer` sin salir de la cuenta
- **THEN** conserva su fila con esas 12, porque sigue siendo su cartera, y "Sin asignar" no se mueve

#### Scenario: El historial del que se fue no se borra

- **WHEN** un asesor deja la cuenta
- **THEN** sus filas en el historial de asignaciones se conservan, aunque ya no tenga fila propia en la tabla

### Requirement: El tiempo de respuesta mide al asesor, no al bot

El tiempo promedio de primera respuesta SHALL calcularse emparejando cada mensaje entrante del cliente con el siguiente mensaje saliente **de ese asesor**, e ignorando los salientes de la IA y de las automatizaciones.

Un mensaje entrante SHALL contarse una sola vez, para que una ráfaga del cliente no infle la muestra.

Un saliente con estado fallido (`status = 'failed'`) NO SHALL contar como respuesta: no cierra la espera del cliente ni genera muestra, porque nunca le llegó.

El cálculo SHALL abarcar todo el historial disponible, sin ventana de tiempo, igual que el resto de la tabla.

Cuando un asesor no tiene ninguna muestra, su tiempo promedio SHALL presentarse como ausente y NO SHALL mostrarse como cero.

#### Scenario: El bot contesta antes que el asesor

- **WHEN** un cliente escribe, la IA responde en 16 segundos y el asesor responde tres horas después
- **THEN** el tiempo del asesor para ese mensaje es de tres horas, no de 16 segundos

#### Scenario: Ráfaga del cliente

- **WHEN** un cliente manda cinco mensajes seguidos y el asesor responde una vez
- **THEN** se registra una sola muestra, no cinco

#### Scenario: El primer intento de respuesta falló

- **WHEN** un cliente escribe, el asesor responde al minuto pero el envío falla, y a los diez minutos del mensaje del cliente responde de nuevo y esta vez sale
- **THEN** se registra una sola muestra, de diez minutos

#### Scenario: Asesor que nunca respondió

- **WHEN** un asesor no tiene ningún mensaje saliente con autoría suya
- **THEN** su tiempo promedio se muestra vacío, no como cero minutos

### Requirement: La tabla de rendimiento es de owner y admin

El sistema SHALL mostrar la tabla de rendimiento por asesor únicamente a los miembros con rol `owner` o `admin`, aplicando el mismo criterio en la interfaz y en el acceso a los datos.

Un miembro con rol `agent` NO SHALL ver la tabla ni SHALL poder obtener sus datos por otra vía.

#### Scenario: El dueño ve la tabla

- **WHEN** un miembro con rol `owner` abre el dashboard
- **THEN** la tabla de rendimiento por asesor está presente

#### Scenario: El asesor no ve la tabla

- **WHEN** un miembro con rol `agent` abre el dashboard
- **THEN** la tabla no se muestra, y una petición directa a sus datos no devuelve información de otros asesores

### Requirement: Las métricas nacen vacías y se declaran así

Cuando no hay datos suficientes para una métrica —porque el historial empezó a capturarse después, o porque todavía no hay negocios—, el sistema SHALL presentarla como vacía de forma explícita en vez de mostrar un cero que se lea como un resultado medido.

#### Scenario: Cuenta sin negocios

- **WHEN** la cuenta todavía no tiene ningún negocio creado
- **THEN** el desglose por etapas se presenta como sin datos, no como todas las etapas en cero
