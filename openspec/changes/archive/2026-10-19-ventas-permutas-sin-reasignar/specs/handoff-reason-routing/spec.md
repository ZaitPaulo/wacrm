## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: El asesor anterior se entera de que perdió la conversación

**Reason**: El traspaso por venta o permuta ya no le quita la conversación a ningún asesor (decisión del Director del 2026-09-26), así que no hay a quién avisar.
**Migration**: Nada que migrar. Si un admin reasigna a mano, el aviso de asignación de siempre (521) le llega al asesor nuevo.

### Requirement: El negocio abierto sigue a quien atiende la venta o permuta

**Reason**: Sin reasignación automática, el negocio abierto del contacto queda con su asesor. Si no hay negocio, el traspaso lo crea como cualquier otro, a nombre del asesor elegido.
**Migration**: Si un admin reasigna a mano, mueve también el negocio desde el embudo.
