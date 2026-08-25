## ADDED Requirements

### Requirement: Un contacto tiene un solo negocio abierto por embudo

El paso `create_deal` SHALL crear el negocio únicamente cuando el contacto no tenga ya un negocio con `status = 'open'` en ese embudo. Si lo tiene, el paso NO debe insertar otro, MUST reportar que lo omitió y la corrida MUST continuar con los pasos siguientes.

La comprobación SHALL alcanzar solo al embudo configurado en el paso: un contacto puede tener a la vez un negocio abierto en `Ventas` y otro en un embudo de posventa sin que uno bloquee al otro.

#### Scenario: El contacto todavía no tiene negocio

- **WHEN** una automatización con un paso `create_deal` corre para un contacto sin negocios abiertos en ese embudo
- **THEN** se inserta el negocio en la etapa configurada, con el título y el valor del paso
- **AND** el registro de la corrida anota el paso como exitoso

#### Scenario: El contacto ya tiene un negocio abierto en ese embudo

- **WHEN** dos automatizaciones distintas ejecutan `create_deal` sobre el mismo contacto y el mismo embudo
- **THEN** la segunda no inserta nada
- **AND** el registro anota el paso como exitoso indicando que ya existía un negocio abierto
- **AND** los pasos posteriores de esa automatización se ejecutan igual

#### Scenario: El negocio anterior ya se cerró

- **WHEN** el contacto solo tiene negocios con `status` distinto de `'open'` en ese embudo
- **THEN** `create_deal` crea uno nuevo, porque un cliente que vuelve es una oportunidad nueva

### Requirement: Una automatización puede mover el negocio de etapa

El motor SHALL ofrecer un paso `move_deal_stage` que mueva el negocio abierto del contacto a la etapa configurada. El paso MUST recibir embudo y etapa, y la etapa MUST pertenecer a ese embudo.

Cuando el contacto tenga más de un negocio abierto en el embudo, el paso SHALL mover **el más reciente por fecha de creación**, y esa regla MUST quedar registrada en el resultado del paso.

#### Scenario: El negocio avanza

- **WHEN** corre un paso `move_deal_stage` para un contacto con un negocio abierto en el embudo configurado
- **THEN** ese negocio queda en la etapa indicada
- **AND** el registro de la corrida anota el nombre de la etapa a la que se movió

#### Scenario: El negocio ya estaba en esa etapa

- **WHEN** el negocio abierto del contacto ya está en la etapa configurada
- **THEN** el paso no falla y la corrida sigue
- **AND** el registro lo anota como sin cambios

#### Scenario: El contacto no tiene negocio abierto

- **WHEN** corre `move_deal_stage` para un contacto sin negocios abiertos en ese embudo
- **THEN** el paso NO crea un negocio
- **AND** el paso no interrumpe la corrida: se anota que no había nada que mover y los pasos siguientes se ejecutan

#### Scenario: La etapa no pertenece al embudo

- **WHEN** la etapa configurada no pertenece al embudo configurado, o pertenece a otra cuenta
- **THEN** el paso falla con un error explícito y no modifica ningún negocio

### Requirement: El paso se configura desde el constructor

El constructor de automatizaciones SHALL ofrecer `move_deal_stage` entre las acciones que se pueden agregar, con el mismo selector de embudo y etapa que usa `create_deal`.

La validación previa a activar una automatización MUST señalar el paso como incompleto si le falta el embudo o la etapa, con el mismo mecanismo que ya usan los demás pasos.

#### Scenario: Se agrega el paso desde la UI

- **WHEN** un administrador agrega el paso a una automatización
- **THEN** puede elegir embudo y etapa, y las etapas ofrecidas son las del embudo elegido

#### Scenario: Se intenta activar con el paso incompleto

- **WHEN** se intenta activar una automatización cuyo paso `move_deal_stage` no tiene embudo o no tiene etapa
- **THEN** la activación se rechaza señalando ese paso

#### Scenario: El paso se muestra en los tres idiomas

- **WHEN** la interfaz se muestra en español, inglés o coreano
- **THEN** el paso y su configuración aparecen traducidos, sin claves crudas ni texto en otro idioma
