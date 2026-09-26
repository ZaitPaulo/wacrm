## MODIFIED Requirements

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
