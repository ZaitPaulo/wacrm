# weighted-auto-assignment Specification

## Purpose
TBD - created by archiving change sticky-weighted-assignment. Update Purpose after archive.
## Requirements
### Requirement: Configuración de porcentajes por cuenta

Cada cuenta SHALL poder guardar una lista de asesores con rol `agent` y un porcentaje entero para cada uno. La lista SHALL cumplir, validado en la API y en la base: porcentajes entre 1 y 100, sin asesores repetidos, todos miembros de la cuenta con rol `agent`, y suma exactamente 100. Una lista vacía es válida en la base y significa "sin configurar".

Solo `owner` y `admin` SHALL leer y escribir la configuración. El reemplazo de la lista SHALL ser atómico y SHALL registrar el instante del cambio (`weights_updated_at`).

#### Scenario: Suma distinta de 100

- **WHEN** un admin guarda 50 % para Juan y 40 % para Brayan
- **THEN** la API responde 400 con `code = "weights_sum"` y la configuración no cambia

#### Scenario: La base rechaza una suma inválida aunque se salte la API

- **WHEN** se inserta directamente en la base un conjunto de porcentajes que suma 90
- **THEN** la transacción falla al confirmar

#### Scenario: Un asesor que no es agent

- **WHEN** un admin incluye en la lista a un miembro con rol `admin`
- **THEN** la API responde 400 con `code = "weights_not_agent"`

#### Scenario: Un agent no ve ni cambia la configuración

- **WHEN** un `agent` pide `GET /api/assignment/settings`
- **THEN** la ruta responde 403

### Requirement: Reparto determinista por cuota

Al elegir por porcentajes, el sistema SHALL contar las asignaciones con `source = 'weighted'` registradas en `conversation_assignments` desde `weights_updated_at`, y SHALL elegir al candidato con mayor déficit `percent × (N + 1) − n × P`, donde `n` son las asignaciones del candidato, `N` la suma de las de todos los candidatos y `P` la suma de sus porcentajes. Los empates SHALL resolverse por mayor porcentaje, luego por antigüedad del perfil en la cuenta y luego por `user_id`.

Son candidatos los asesores de la lista que siguen siendo miembros con rol `agent`. Si la lista está vacía, o ninguno sigue siendo candidato, SHALL repartirse en partes iguales entre todos los `agent` de la cuenta. Si la cuenta no tiene ningún `agent`, no se asigna.

La elección SHALL ser segura ante concurrencia: dos elecciones simultáneas en la misma cuenta se serializan y cada una ve la anterior.

#### Scenario: Reparto 34/33/33 en seis leads

- **WHEN** entran seis leads nuevos sin asesor con porcentajes 34 % (A, más antiguo), 33 % (B) y 33 % (C)
- **THEN** se asignan en el orden A, B, C, A, B, C

#### Scenario: Un asesor al 100 %

- **WHEN** la lista tiene a una sola persona con 100 %
- **THEN** todas las asignaciones por porcentaje van a ella

#### Scenario: Cambiar los porcentajes reinicia la cuenta

- **WHEN** un admin guarda porcentajes nuevos
- **THEN** las asignaciones anteriores a ese instante no cuentan para la cuota

#### Scenario: Concurrencia

- **WHEN** dos traspasos de la misma cuenta eligen asesor al mismo tiempo
- **THEN** el resultado es el mismo que si hubieran ocurrido uno después del otro

### Requirement: Asignación automática unificada

Todo camino automático que asigna —traspaso de la IA, acción "asignar" de las automatizaciones, derivación de los flujos y el job de conversaciones olvidadas— SHALL resolver al asesor con una única función de base de datos, en este orden:

1. Si la conversación tiene un asesor vigente, se conserva.
2. Continuidad: el asesor de continuidad del contacto (ver `sticky-contact-assignment`).
3. Un asesor preferido que indique el camino (el `agent_id` de la automatización, el `assign_to` del flujo), si es miembro vigente.
4. Porcentajes, salvo que el camino lo desactive (la derivación de un flujo sin asesor configurado no reparte, como hasta ahora).

Cada asignación SHALL quedar en el historial con su `source` (`continuity`, `preferred`, `weighted`) y su `origin` (`ai_handoff`, `automation`, `flow`, `stale_job`, `inheritance`).

#### Scenario: Continuidad antes que porcentajes

- **WHEN** la IA traspasa una conversación sin asesor de un contacto cuyo historial nombra a Juan (`agent`)
- **THEN** la conversación se asigna a Juan aunque los porcentajes elegirían a otro

#### Scenario: Automatización en modo reparto

- **WHEN** corre una automatización con acción "asignar" en modo `round_robin` sobre un contacto sin asesor ni historial
- **THEN** la conversación se asigna por porcentajes, no al primer perfil de la cuenta

#### Scenario: Automatización con asesor explícito sobre un contacto sin historial

- **WHEN** corre una automatización que asigna a Brayan sobre un contacto sin asesor ni historial
- **THEN** la conversación se asigna a Brayan con `source = 'preferred'`

### Requirement: Migración de la configuración existente

Al desplegar, cada cuenta SHALL recibir una configuración que reproduzca su comportamiento: si `ai_configs.handoff_agent_id` apunta a un `agent`, 100 % a esa persona; si no, reparto en partes iguales entre sus `agent` (el resto de la división se reparte de a un punto empezando por el más antiguo). El reparto automático SHALL dejar de leer `handoff_agent_id`.

#### Scenario: Cuenta de producción sin asesor fijo y con tres agent

- **WHEN** se aplica la migración en una cuenta sin `handoff_agent_id` y con tres `agent`
- **THEN** la configuración queda en 34 %, 33 % y 33 %, con el 34 % para el más antiguo

#### Scenario: Cuenta con asesor fijo

- **WHEN** se aplica la migración en una cuenta con `handoff_agent_id` apuntando a un `agent`
- **THEN** la configuración queda en 100 % para ese asesor

