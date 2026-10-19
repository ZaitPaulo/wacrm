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

Cuando la IA traspasa una conversación con motivo `vende_su_carro` o `permuta`, `ai_handoff_assign` SHALL elegir al asesor en este orden:

1. **Conservar:** si la conversación tiene un asesor vigente, se queda con él.
2. **Continuidad:** si el contacto tiene asesor de continuidad (`contact_continuity_agent`), va a ese asesor.
3. **Ventas y permutas:** si la cuenta tiene un asesor para ventas y permutas que sigue siendo miembro vigente, va a ese asesor.
4. **Porcentajes:** el reparto normal.

El asesor de ventas y permutas NUNCA SHALL reemplazar a un asesor vigente ni al de continuidad del contacto. Un cliente que ya tiene asesor solo puede pasar a otro a mano, por un owner o admin.

La asignación del paso 3 SHALL registrarse en el historial con `source = 'reason'` y origen `ai_handoff`, y NO SHALL contar para la cuota del reparto por porcentajes.

Con cualquier otro motivo, sin asesor configurado o con uno que ya no es miembro vigente, el traspaso SHALL seguir el orden normal sin el paso 3.

#### Scenario: Cliente nuevo que quiere vender su carro

- **WHEN** la IA traspasa con motivo `vende_su_carro` la conversación de un contacto sin historial, y el ajuste tiene a Angélica
- **THEN** la conversación queda asignada a Angélica con `source = 'reason'`
- **AND** el cliente recibe el aviso de asignación con el nombre de Angélica

#### Scenario: Cliente que ya tenía asesor pide una permuta

- **WHEN** la IA traspasa con motivo `permuta` una conversación asignada a Juan (rol `agent`), y el ajuste tiene a Angélica
- **THEN** la conversación sigue con Juan, con resultado `kept`
- **AND** Juan recibe el aviso de "Tu cliente pidió un asesor"

#### Scenario: El contacto ya tiene asesor por otro canal

- **WHEN** la IA traspasa con motivo `vende_su_carro` la conversación de Instagram de un contacto cuya conversación de WhatsApp atendió Brayan, y el ajuste tiene a Angélica
- **THEN** la conversación se asigna a Brayan con `source = 'continuity'`

#### Scenario: Motivo de compra normal

- **WHEN** la IA traspasa con motivo `credito` la conversación de un contacto sin historial
- **THEN** se aplica el reparto por porcentajes

#### Scenario: Ajuste desactivado

- **WHEN** la IA traspasa con motivo `vende_su_carro` y el ajuste está vacío
- **THEN** se aplica el orden normal

#### Scenario: La persona configurada dejó la cuenta

- **WHEN** la IA traspasa con motivo `permuta` y el usuario del ajuste ya no es miembro de la cuenta
- **THEN** se aplica el orden normal

#### Scenario: No consume cuota

- **WHEN** Angélica recibe tres traspasos por venta o permuta
- **THEN** el siguiente reparto por porcentajes se calcula como si esos tres no hubieran existido

