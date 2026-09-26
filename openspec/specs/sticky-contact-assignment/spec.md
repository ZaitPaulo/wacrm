# sticky-contact-assignment Specification

## Purpose
TBD - created by archiving change sticky-weighted-assignment. Update Purpose after archive.
## Requirements
### Requirement: El asesor vigente de una conversación no lo cambia ningún camino automático

Un asesor es **vigente** mientras sea miembro de la cuenta con rol `owner`, `admin` o `agent`. Cuando una conversación tiene un asesor vigente, ningún camino automático —traspaso de la IA, motor de automatizaciones, motor de flujos, job de conversaciones olvidadas, API con service-role ni SQL a mano— SHALL cambiarlo ni dejarlo en NULL.

La única excepción SHALL ser el traspaso de la IA por venta o permuta hacia el asesor para ventas y permutas de la cuenta (`handoff-reason-routing`). Ese traspaso SHALL pasar la guarda de forma explícita, con `crm.assignment_override = 'on'` dentro de la transacción de `ai_handoff_assign`, y solo para esa escritura.

La garantía SHALL vivir en la base de datos además de en el código: un trigger `BEFORE UPDATE OF assigned_agent_id` sobre `conversations` SHALL conservar el asesor anterior cuando la escritura no trae sesión de usuario (`auth.uid()` NULL) y el asesor anterior es vigente. No SHALL abortar la sentencia: el resto de la fila (estado, pausa del bot, nota) se escribe igual.

Un operador que necesite corregir a mano por SQL SHALL poder saltarse la guarda de forma explícita con `SET LOCAL crm.assignment_override = 'on'`.

#### Scenario: Una automatización intenta reasignar un hilo con asesor

- **WHEN** una automatización con acción "asignar" corre sobre un contacto cuya conversación ya tiene a Juan (rol `agent`) asignado
- **THEN** la conversación sigue asignada a Juan

#### Scenario: El asesor anterior ya no es miembro

- **WHEN** un camino automático asigna una conversación cuyo asesor ya no es miembro de la cuenta
- **THEN** la asignación nueva se aplica

#### Scenario: Escritura con service-role que no pasa por el código

- **WHEN** se ejecuta con service-role `UPDATE conversations SET assigned_agent_id = <otro>` sobre una conversación asignada a un asesor vigente
- **THEN** la fila conserva el asesor anterior y las demás columnas de la sentencia se escriben

#### Scenario: Corrección explícita de un operador

- **WHEN** un operador ejecuta la misma sentencia con `crm.assignment_override = 'on'` en la transacción
- **THEN** el cambio se aplica

#### Scenario: Traspaso por permuta a la asesora de ventas y permutas

- **WHEN** la IA traspasa con motivo `permuta` una conversación asignada a Juan, y la cuenta tiene a Angélica como asesora de ventas y permutas
- **THEN** la conversación pasa a Angélica

#### Scenario: El override no se filtra fuera del traspaso

- **WHEN** dentro de la misma sesión de base, después de un traspaso por permuta, una automatización intenta reasignar otra conversación con asesor vigente
- **THEN** esa conversación conserva a su asesor

### Requirement: Solo owner o admin cambian el asesor a mano

`PATCH /api/conversations/[id]/assignee` SHALL exigir rol `owner` o `admin`. Un `agent` SHALL recibir 403 al intentar reasignar o soltar, incluso sobre una conversación propia. La escritura SHALL hacerse con la sesión del usuario, nunca con service-role, para que la RLS y el aviso con nombre de quien asigna sigan funcionando.

#### Scenario: El admin reasigna

- **WHEN** un `admin` asigna a Brayan una conversación que tenía Juan
- **THEN** la conversación queda asignada a Brayan y Brayan recibe el aviso con el nombre del admin

#### Scenario: El agent no reasigna

- **WHEN** un `agent` pide asignar a un compañero una conversación que tiene asignada
- **THEN** la ruta responde 403 y la asignación no cambia

### Requirement: Una conversación nueva hereda el asesor del contacto

Cuando se crea una conversación sin asesor para un contacto que ya tiene un **asesor de continuidad** —el último asesor nombrado en el historial de asignaciones de cualquiera de sus conversaciones, siempre que siga siendo miembro con rol `agent`—, la base SHALL asignarle ese asesor al insertar la fila, cualquiera que sea el camino que la cree.

La herencia no SHALL pausar al bot: el cliente que escribe por un canal nuevo lo atiende primero la IA y, cuando traspasa, va a su asesor.

#### Scenario: El cliente de WhatsApp escribe por Instagram

- **WHEN** un contacto cuya conversación de WhatsApp está asignada a Juan (`agent`) abre una conversación por Instagram
- **THEN** la conversación de Instagram nace asignada a Juan, con la IA activa

#### Scenario: El asesor anterior fue ascendido a admin

- **WHEN** el asesor de continuidad del contacto ya no tiene rol `agent`
- **THEN** la conversación nueva nace sin asesor

#### Scenario: El historial registra el origen

- **WHEN** una conversación nace heredando asesor
- **THEN** `conversation_assignments` registra el cambio con `source = 'continuity'` y `origin = 'inheritance'`

