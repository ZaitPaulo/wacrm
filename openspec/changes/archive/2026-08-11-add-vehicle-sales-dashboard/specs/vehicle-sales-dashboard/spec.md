## ADDED Requirements

### Requirement: El tablero muestra el estado del inventario

El dashboard SHALL presentar un bloque de inventario con, como mínimo: la cantidad de vehículos por estado (`available`, `reserved`, `sold`, `hidden`), el **valor inmovilizado** —la suma de precios de lista de los vehículos disponibles— y la distribución del stock por marca y por carrocería.

Estas métricas SHALL calcularse sólo sobre los vehículos de la cuenta activa.

#### Scenario: Cuenta con inventario cargado

- **WHEN** un miembro abre el dashboard en una cuenta con vehículos
- **THEN** ve el conteo por estado, el valor inmovilizado del stock disponible y la distribución por marca y carrocería

#### Scenario: Cuenta sin vehículos

- **WHEN** un miembro abre el dashboard en una cuenta sin ningún vehículo
- **THEN** el bloque de inventario se muestra en estado vacío, con una invitación a cargar el primer vehículo, en vez de gráficas en cero

### Requirement: El tablero muestra el envejecimiento del stock

El dashboard SHALL mostrar cuántos vehículos disponibles llevan 0-30, 31-60, 61-90 y más de 90 días en inventario, para exponer el capital inmovilizado en unidades que no rotan.

La antigüedad SHALL contarse desde la fecha de adquisición cuando exista, y desde la fecha de alta en el sistema cuando no. El tramo de más de 90 días SHALL destacarse visualmente como señal de alerta.

#### Scenario: Vehículo con fecha de adquisición registrada

- **WHEN** un vehículo disponible tiene fecha de adquisición
- **THEN** su antigüedad se calcula desde esa fecha

#### Scenario: Vehículo sin fecha de adquisición

- **WHEN** un vehículo disponible no tiene fecha de adquisición
- **THEN** su antigüedad se calcula desde su fecha de alta en el sistema y se lo incluye igual en el tramo correspondiente

#### Scenario: Stock envejecido

- **WHEN** hay vehículos disponibles con más de 90 días en inventario
- **THEN** ese tramo se muestra destacado como alerta

#### Scenario: Los vendidos no cuentan como stock

- **WHEN** se calcula el envejecimiento del inventario
- **THEN** los vehículos en estado `sold` quedan excluidos

### Requirement: El tablero muestra el desempeño comercial

El dashboard SHALL presentar un bloque comercial con, como mínimo: unidades vendidas e ingresos del período, **ticket promedio** de venta y **días promedio en inventario** de las unidades vendidas (de adquisición a venta).

El período SHALL ser seleccionable, reutilizando los rangos que ya ofrece el tablero.

#### Scenario: Período con ventas

- **WHEN** un miembro consulta un período en el que hubo ventas
- **THEN** ve unidades vendidas, ingresos, ticket promedio y días promedio en inventario de ese período

#### Scenario: Período sin ventas

- **WHEN** un miembro consulta un período sin ventas registradas
- **THEN** el bloque comercial indica que no hubo ventas en el período, sin mostrar promedios calculados sobre cero unidades

#### Scenario: Vendido sin fecha de adquisición

- **WHEN** un vehículo vendido no tiene fecha de adquisición registrada
- **THEN** queda excluido del promedio de días en inventario, y el tablero indica sobre cuántas unidades se calculó ese promedio

### Requirement: Las métricas de margen sólo se muestran a admin o superior

El margen bruto —por unidad, del período y por marca— SHALL calcularse como precio final de venta menos costo de adquisición, y SHALL mostrarse únicamente a miembros con rol `admin` o superior.

Las consultas que alimentan estas métricas SHALL ejecutarse bajo la sesión del usuario, nunca con credenciales de servicio, de modo que la restricción de acceso al costo la imponga la base de datos y no la interfaz.

#### Scenario: El dueño abre el tablero

- **WHEN** un miembro con rol `admin` u `owner` abre el dashboard
- **THEN** ve la utilidad del período, el margen por unidad y el margen por marca

#### Scenario: Un vendedor abre el tablero

- **WHEN** un miembro con rol `agent` o `viewer` abre el dashboard
- **THEN** ve el bloque de inventario y el comercial sin ninguna métrica de margen ni de costo, y sin espacios vacíos donde estarían

#### Scenario: Ventas sin costo de adquisición registrado

- **WHEN** se calcula el margen de un período en el que algunas unidades vendidas no tienen costo registrado
- **THEN** esas unidades se excluyen del cálculo y el tablero indica sobre cuántas de las vendidas se computó el margen, sin tratarlas como costo cero

### Requirement: El tablero muestra el interés generado por vehículo

El dashboard SHALL mostrar los vehículos más consultados desde la vitrina, según las consultas atribuidas, y la proporción de consultas que terminaron en venta.

#### Scenario: Vehículos con consultas atribuidas

- **WHEN** existen consultas atribuidas en el período
- **THEN** el tablero lista los vehículos con más consultas y la proporción de ellas que terminó en venta

#### Scenario: Sin consultas atribuidas

- **WHEN** no hay ninguna consulta atribuida en el período
- **THEN** la sección se muestra vacía explicando que aún no hay consultas provenientes de la vitrina

### Requirement: El tablero conserva las métricas de conversación

El dashboard SHALL seguir mostrando las métricas de WhatsApp existentes —volumen de conversaciones, tiempo de respuesta y feed de actividad— y SHALL conservar la vista de pipeline, que baja de jerarquía visual sin eliminarse.

#### Scenario: Pipeline sin negocios cargados

- **WHEN** la cuenta no tiene ningún negocio en el pipeline
- **THEN** esa sección se muestra en estado vacío, sin ocupar la posición principal del tablero

#### Scenario: Las métricas de conversación siguen disponibles

- **WHEN** un miembro abre el dashboard rediseñado
- **THEN** sigue teniendo acceso al volumen de conversaciones, al tiempo de respuesta y al feed de actividad

### Requirement: Cada sección del tablero carga y falla de forma independiente

Cada bloque de métricas SHALL cargarse por separado, mostrando su propio indicador de carga, y el fallo de una consulta NO SHALL impedir que el resto del tablero se muestre.

#### Scenario: Falla una consulta de métricas

- **WHEN** la consulta de una sección falla
- **THEN** esa sección muestra su estado de error y las demás se renderizan con normalidad

#### Scenario: Una consulta tarda más que las otras

- **WHEN** una sección tarda en responder
- **THEN** las secciones ya resueltas se muestran sin esperarla
