## ADDED Requirements

### Requirement: Una persona puede tener una identidad por canal

El sistema SHALL permitir que un contacto tenga varias identidades, una por canal, cada una con el identificador que ese canal usa para la persona. Un identificador SHALL ser único dentro de la combinación de cuenta y canal.

El teléfono SHALL seguir siendo la identidad de WhatsApp y SHALL conservarse en el contacto, pero NO SHALL seguir siendo el único medio de identificar a una persona.

#### Scenario: Llega un mensaje de un canal sin teléfono

- **WHEN** entra un mensaje de un canal que no entrega número telefónico y el remitente no existe en el sistema
- **THEN** se crea un contacto con su identidad de ese canal, sin teléfono, y la conversación queda asociada a él

#### Scenario: Vuelve a escribir la misma persona por el mismo canal

- **WHEN** entra un mensaje cuyo identificador de canal ya está registrado
- **THEN** se reutiliza el contacto existente, sin crear uno nuevo

#### Scenario: El mismo identificador en dos cuentas distintas

- **WHEN** el mismo identificador de canal aparece en dos cuentas diferentes
- **THEN** cada cuenta tiene su propio contacto, sin que ninguna alcance información de la otra

#### Scenario: Contactos anteriores a este cambio

- **WHEN** se despliega el cambio sobre una instalación existente
- **THEN** cada contacto con teléfono queda con su identidad de WhatsApp registrada, y el conteo de identidades creadas coincide con el de contactos con teléfono

### Requirement: La búsqueda de un contacto no asume teléfono

La resolución del contacto a partir de un mensaje entrante SHALL hacerse por canal e identificador. NO SHALL depender de que exista un número telefónico.

#### Scenario: Resolución por identidad de canal

- **WHEN** llega un mensaje de cualquier canal soportado
- **THEN** el contacto se resuelve por la identidad correspondiente a ese canal

#### Scenario: Persona con identidades en varios canales

- **WHEN** un contacto tiene identidad de WhatsApp y de otro canal, y escribe por el segundo
- **THEN** se resuelve el mismo contacto, sin duplicarlo

### Requirement: La unificación de identidades requiere decisión humana

Cuando dos identidades de canales distintos parezcan corresponder a la misma persona, el sistema SHALL señalarlo y SHALL ofrecer vincularlas. NO SHALL fusionarlas por su cuenta.

Unificar mal mezcla el historial, los documentos y las operaciones de dos clientes distintos; el daño es mayor y más difícil de revertir que el de mantener dos fichas separadas.

#### Scenario: Coincidencia probable

- **WHEN** el sistema detecta que dos identidades podrían ser la misma persona
- **THEN** lo presenta como sugerencia y las fichas siguen separadas hasta que alguien confirme

#### Scenario: Un usuario confirma la vinculación

- **WHEN** un miembro con permiso de escritura confirma que dos identidades son la misma persona
- **THEN** quedan bajo un mismo contacto, conservando el historial completo de ambas conversaciones

#### Scenario: Vinculación hecha por error

- **WHEN** se vinculan dos identidades que no correspondían a la misma persona
- **THEN** la vinculación puede deshacerse, y cada conversación vuelve al contacto que le corresponde
