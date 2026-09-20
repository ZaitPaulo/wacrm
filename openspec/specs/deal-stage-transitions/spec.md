# deal-stage-transitions Specification

## Purpose
TBD - created by archiving change cambiar-etapa-negocio-desde-bandeja. Update Purpose after archive.
## Requirements
### Requirement: Reglas de transición por embudo
El sistema SHALL guardar, por embudo, las transiciones permitidas entre sus etapas como pares (etapa origen, etapa destino). Ambas etapas MUST pertenecer al mismo embudo y MUST ser distintas. Un par no se puede repetir.

#### Scenario: Regla válida
- **WHEN** un admin guarda la regla Cotizado → Negociación del embudo Ventas
- **THEN** la regla queda registrada para ese embudo

#### Scenario: Etapas de otro embudo
- **WHEN** se intenta guardar una regla cuyo destino pertenece a otro embudo
- **THEN** la base rechaza la regla

#### Scenario: Borrado de una etapa
- **WHEN** se borra una etapa del embudo
- **THEN** se borran también todas las reglas donde esa etapa es origen o destino

### Requirement: Acceso a las reglas por cuenta
Los miembros de la cuenta dueña del embudo SHALL poder leer sus reglas. Solo los admins de esa cuenta SHALL poder crearlas, cambiarlas o borrarlas.

#### Scenario: Agente lee las reglas
- **WHEN** un agente de la cuenta abre la bandeja
- **THEN** puede leer las reglas de los embudos de su cuenta

#### Scenario: Agente intenta modificar reglas
- **WHEN** un agente sin rol admin intenta insertar o borrar una regla
- **THEN** la base lo rechaza por RLS

#### Scenario: Otra cuenta
- **WHEN** un usuario de otra cuenta consulta las reglas
- **THEN** no ve ninguna

### Requirement: Cálculo de etapas destino permitidas
El sistema SHALL calcular las etapas destino permitidas de un negocio a partir de su etapa actual, las etapas del embudo y las reglas del embudo. Si el embudo tiene al menos una regla, los destinos son exactamente los de las reglas cuyo origen es la etapa actual. Si el embudo no tiene ninguna regla, los destinos son todas las demás etapas del embudo. Los destinos SHALL devolverse ordenados por la posición de la etapa y nunca incluyen la etapa actual.

#### Scenario: Embudo con reglas
- **WHEN** el negocio está en Cotizado del embudo Ventas sembrado
- **THEN** los destinos son Seguimiento, Negociación y No viable, en ese orden

#### Scenario: Etapa final
- **WHEN** el negocio está en No viable o en Cerrado del embudo Ventas
- **THEN** no hay destinos permitidos

#### Scenario: Embudo sin reglas
- **WHEN** el negocio está en una etapa de un embudo sin reglas
- **THEN** los destinos son todas las demás etapas del embudo, por posición

### Requirement: Cambiar la etapa desde la bandeja
El panel lateral de la bandeja SHALL ofrecer, en cada negocio de la sección "Negocios", un selector de etapa con solo los destinos permitidos. Al elegir uno, el sistema SHALL actualizar la etapa del negocio y reflejarla en la tarjeta sin recargar la página. Si no hay destinos permitidos, el selector no SHALL ofrecer opciones de cambio.

#### Scenario: Mover a un destino permitido
- **WHEN** el asesor elige Negociación en un negocio que está en Seguimiento
- **THEN** el negocio pasa a Negociación y la tarjeta muestra la nueva etapa con su color

#### Scenario: Destino no permitido
- **WHEN** el negocio está en Seguimiento
- **THEN** el selector no ofrece Prospecto, Contactado ni Cotizado

#### Scenario: Error al guardar
- **WHEN** la actualización de la etapa falla
- **THEN** se muestra un aviso de error y la tarjeta conserva la etapa anterior

#### Scenario: Etapa final
- **WHEN** el negocio está en Cerrado
- **THEN** la tarjeta muestra la etapa sin opciones para cambiarla

### Requirement: Editar las reglas en los ajustes del embudo
Los ajustes del embudo SHALL permitir a un admin marcar, para cada etapa, a qué otras etapas del mismo embudo puede pasar, y guardar esas reglas.

#### Scenario: Guardar reglas
- **WHEN** el admin marca Prospecto → Contactado y guarda
- **THEN** la regla queda en la base y la bandeja la respeta en la siguiente carga

#### Scenario: Quitar todas las reglas
- **WHEN** el admin desmarca todas las transiciones de un embudo y guarda
- **THEN** el embudo vuelve a permitir mover a cualquier etapa desde la bandeja

### Requirement: La restricción es exclusiva de la bandeja
Las reglas de transición SHALL aplicarse solo al selector de la bandeja. El tablero de Embudos y el paso `move_deal_stage` de las automatizaciones MUST seguir moviendo negocios a cualquier etapa.

#### Scenario: Arrastrar en el tablero
- **WHEN** un usuario arrastra un negocio de Cerrado a Prospecto en el tablero
- **THEN** el negocio se mueve como antes

#### Scenario: Automatización
- **WHEN** una automatización mueve un negocio a una etapa sin regla desde su etapa actual
- **THEN** el negocio se mueve como antes

### Requirement: Siembra del embudo Ventas
La migración SHALL crear las reglas del embudo "Ventas" buscando las etapas por nombre: Prospecto → Contactado; Contactado → Cotizado, No viable; Cotizado → Seguimiento, Negociación, No viable; Seguimiento → Negociación, No viable; Negociación → No viable, Cerrado. La siembra MUST ser idempotente y MUST omitir en silencio los pares cuyo embudo o etapas no existan.

#### Scenario: Base de producción
- **WHEN** se aplica la migración en una base con el embudo Ventas y esas seis etapas
- **THEN** quedan creadas las 10 reglas

#### Scenario: Base sin el embudo
- **WHEN** se aplica la migración en una base sin el embudo Ventas
- **THEN** la migración termina sin error y no crea reglas

#### Scenario: Segunda aplicación
- **WHEN** la siembra corre dos veces
- **THEN** no se duplican reglas
