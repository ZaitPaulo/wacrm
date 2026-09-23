## MODIFIED Requirements

### Requirement: La transferencia elige al asesor con menos carga

Cuando la IA transfiere una conversación y la cuenta no tiene un asesor de derivación configurado, el sistema SHALL asignarla al asesor que ya la tuvo asignada más recientemente, según el historial de asignaciones, siempre que ese asesor siga siendo miembro de la cuenta con rol `agent`.

Cuando la conversación no tiene historial —es su primer traspaso— o el asesor que la tuvo ya no es candidato, el sistema SHALL asignarla al miembro con menos conversaciones abiertas asignadas en ese momento.

La continuidad manda sobre la carga a propósito: un cliente que ya habló con un asesor no debe volver a empezar con otro, y la propiedad del lead no debe cambiar de manos por una diferencia de una conversación en el reparto.

Son candidatos únicamente los miembros de la cuenta con rol `agent`. Ni el `admin` ni el `owner` SHALL ser candidatos: administrar el CRM no es atender clientes.

Los empates SHALL resolverse por antigüedad en la cuenta, de modo que la elección sea determinista y reproducible.

#### Scenario: La conversación vuelve a quien ya la atendió

- **WHEN** una conversación que tuvo asignada a Juan se devuelve al bot y este la vuelve a transferir
- **THEN** se asigna a Juan, aunque en ese momento tenga más carga que sus compañeros

#### Scenario: El asesor anterior ya no está en la cuenta

- **WHEN** una conversación que tuvo asignada a Juan se vuelve a transferir y Juan ya no es miembro con rol `agent`
- **THEN** se asigna al asesor con menos conversaciones abiertas

#### Scenario: Reparto con cargas distintas

- **WHEN** la IA transfiere una conversación sin historial de asignación y un asesor tiene 3 conversaciones abiertas y otro tiene 1
- **THEN** la conversación se asigna al que tiene 1

#### Scenario: Empate entre asesores

- **WHEN** dos asesores tienen la misma cantidad de conversaciones abiertas y la conversación no tiene historial
- **THEN** se asigna al que lleva más tiempo en la cuenta

#### Scenario: Ni el owner ni el admin atienden

- **WHEN** el owner y un admin tienen 0 conversaciones abiertas y todos los `agent` tienen 2
- **THEN** la conversación se asigna a un `agent`, no al owner ni al admin

#### Scenario: La cuenta no tiene ningún agent

- **WHEN** la cuenta solo tiene miembros con rol `admin` y `owner`
- **THEN** la conversación queda en la cola compartida

#### Scenario: Solo se cuentan las conversaciones abiertas

- **WHEN** un asesor tiene 10 conversaciones cerradas y 0 abiertas, y otro tiene 2 abiertas, y la conversación no tiene historial
- **THEN** la conversación se asigna al primero

## ADDED Requirements

### Requirement: La nota del traspaso sobrevive a la reactivación

Cuando un miembro devuelve una conversación al bot, el sistema SHALL conservar la nota del traspaso anterior (`ai_handoff_summary`). Esa nota lleva el motivo y los datos de calificación, y es lo que permite que quien retome el hilo más adelante no empiece de cero.

Un traspaso posterior SHALL reemplazar la nota por la suya, de modo que siempre refleje el último traspaso y no se acumule.

#### Scenario: Reactivar conserva el contexto

- **WHEN** un asesor reactiva la IA en una conversación que traía nota de traspaso
- **THEN** la nota sigue disponible en la conversación

#### Scenario: Un traspaso nuevo reemplaza la nota

- **WHEN** el bot vuelve a transferir una conversación que ya tenía nota
- **THEN** la nota pasa a ser la del traspaso nuevo
