# handoff-reason-routing Specification

## Purpose
A quién va un traspaso de la IA según su motivo: los clientes que quieren vender su carro o entregarlo en permuta van siempre al asesor configurado para ventas y permutas, por encima del orden normal de asignación.
## Requirements
### Requirement: La cuenta configura un asesor para ventas y permutas

Cada cuenta SHALL poder configurar, en `assignment_settings`, un **asesor para ventas y permutas**. Solo owner y admin SHALL leerlo y cambiarlo, desde Ajustes → Asignación, con `GET/PUT /api/assignment/settings`.

El asesor elegido SHALL ser un miembro vigente de la cuenta (rol `owner`, `admin` o `agent`). La API SHALL rechazar a quien no lo sea con un código de error propio. El valor `null` SHALL significar que el ajuste está desactivado.

#### Scenario: El admin elige a Angélica

- **WHEN** un admin guarda el ajuste con Angélica (rol `admin`)
- **THEN** el ajuste queda guardado y GET lo devuelve con su nombre

#### Scenario: Persona que no es de la cuenta

- **WHEN** el PUT trae un usuario que no es miembro de la cuenta
- **THEN** la API responde 400 con el código de asesor no válido y no guarda nada

#### Scenario: Desactivar

- **WHEN** un admin guarda el ajuste vacío
- **THEN** el ajuste queda en `null` y los traspasos siguen el orden normal

#### Scenario: Un agent intenta cambiarlo

- **WHEN** un usuario con rol `agent` llama al PUT
- **THEN** recibe 403

### Requirement: El traspaso por venta o permuta va al asesor configurado

Cuando la IA traspasa una conversación con motivo `vende_su_carro` o `permuta`, y la cuenta tiene un asesor para ventas y permutas que sigue siendo miembro vigente, `ai_handoff_assign` SHALL asignarle la conversación **antes** de aplicar el orden normal (conservar → continuidad → porcentajes). Esto SHALL cumplirse aunque la conversación ya tenga otro asesor vigente.

La asignación SHALL registrarse en el historial con `source = 'reason'` y origen `ai_handoff`, y NO SHALL contar para la cuota del reparto por porcentajes.

Con cualquier otro motivo, sin asesor configurado o con uno que ya no es miembro vigente, el traspaso SHALL seguir el orden normal sin cambios.

#### Scenario: Cliente nuevo que quiere vender su carro

- **WHEN** la IA traspasa con motivo `vende_su_carro` la conversación de un contacto sin historial, y el ajuste tiene a Angélica
- **THEN** la conversación queda asignada a Angélica con `source = 'reason'`
- **AND** el cliente recibe el aviso de asignación con el nombre de Angélica

#### Scenario: Cliente que ya tenía asesor pide una permuta

- **WHEN** la IA traspasa con motivo `permuta` una conversación asignada a Juan (rol `agent`), y el ajuste tiene a Angélica
- **THEN** la conversación pasa a Angélica
- **AND** el historial registra el cambio de Juan a Angélica con `source = 'reason'`

#### Scenario: Ya estaba con Angélica

- **WHEN** la IA traspasa con motivo `permuta` una conversación que ya tiene asignada a Angélica
- **THEN** el resultado es `kept` y Angélica recibe el aviso de "Tu cliente pidió un asesor"

#### Scenario: Motivo de compra normal

- **WHEN** la IA traspasa con motivo `credito` una conversación de un contacto cuyo último asesor fue Angélica por una permuta anterior
- **THEN** se aplica el orden normal

#### Scenario: Ajuste desactivado

- **WHEN** la IA traspasa con motivo `vende_su_carro` y el ajuste está vacío
- **THEN** se aplica el orden normal

#### Scenario: La persona configurada dejó la cuenta

- **WHEN** la IA traspasa con motivo `permuta` y el usuario del ajuste ya no es miembro de la cuenta
- **THEN** se aplica el orden normal

#### Scenario: No consume cuota

- **WHEN** Angélica recibe tres traspasos por venta o permuta
- **THEN** el siguiente reparto por porcentajes se calcula como si esos tres no hubieran existido

### Requirement: El asesor anterior se entera de que perdió la conversación

Cuando un traspaso por venta o permuta le quita la conversación a un asesor vigente para dársela al asesor configurado, el sistema SHALL insertarle al asesor anterior una notificación de tipo `conversation_assigned` con el título "Tu cliente pasó a <primer nombre del asesor configurado>" y un cuerpo que nombre al contacto y el motivo ("quiere vender su carro" o "permuta"). La notificación SHALL escribirse dentro de la misma transacción del traspaso, y su fallo NO SHALL impedir la asignación.

Si la conversación no tenía asesor, o ya la tenía el asesor configurado, NO SHALL enviarse este aviso.

#### Scenario: Juan pierde una permuta

- **WHEN** un traspaso por `permuta` le pasa a Angélica una conversación de Juan
- **THEN** Juan recibe la notificación "Tu cliente pasó a Angélica", con el nombre del contacto y el motivo "permuta"

#### Scenario: Lead nuevo

- **WHEN** un traspaso por `vende_su_carro` le llega a Angélica y la conversación no tenía asesor
- **THEN** solo Angélica recibe aviso

### Requirement: El negocio abierto sigue a quien atiende la venta o permuta

Cuando un traspaso por venta o permuta le asigna la conversación al asesor configurado, los negocios abiertos del contacto que estaban asignados al asesor anterior SHALL pasar al asesor configurado. Si el contacto no tenía negocio abierto, SHALL crearse con el título del traspaso, como en cualquier traspaso.

Un fallo al mover o crear el negocio NO SHALL impedir la asignación de la conversación.

#### Scenario: El negocio de Juan pasa a Angélica

- **WHEN** un traspaso por permuta le quita la conversación a Juan, y el contacto tiene un negocio abierto asignado a Juan
- **THEN** ese negocio queda asignado a Angélica

#### Scenario: Negocio de otro asesor

- **WHEN** el contacto tiene un negocio abierto asignado a Brayan, que no era el asesor de la conversación
- **THEN** ese negocio no cambia

#### Scenario: Sin negocio abierto

- **WHEN** un traspaso por `vende_su_carro` le llega a Angélica y el contacto no tiene negocio abierto
- **THEN** se crea un negocio asignado a Angélica con el título "Nombre — datos del carro"

