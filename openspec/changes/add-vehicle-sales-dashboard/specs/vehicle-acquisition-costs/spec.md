## ADDED Requirements

### Requirement: El costo de adquisición se registra por vehículo

El sistema SHALL permitir registrar, por cada vehículo del inventario, el costo al que fue comprado y la fecha de adquisición. Estos datos SHALL vivir en una tabla propia (`vehicle_acquisitions`) scopeada por `account_id`, con a lo sumo un registro por vehículo, y NO como columnas de `inventory_vehicles`.

El costo SHALL ser un monto no negativo. La fecha de adquisición SHALL ser opcional: un vehículo puede tener costo conocido sin fecha exacta.

#### Scenario: Se registra la compra de un vehículo

- **WHEN** un usuario con rol `admin` o superior guarda un vehículo indicando costo de adquisición y fecha
- **THEN** el sistema persiste un registro de adquisición asociado a ese vehículo y a la cuenta

#### Scenario: Vehículo cargado sin datos de compra

- **WHEN** se crea un vehículo sin indicar costo de adquisición
- **THEN** el vehículo se guarda correctamente y queda sin registro de adquisición, sin asumir costo cero

#### Scenario: Se corrige el costo de un vehículo ya registrado

- **WHEN** un usuario con rol `admin` o superior modifica el costo de un vehículo que ya tenía adquisición registrada
- **THEN** el registro existente se actualiza en vez de crearse uno nuevo

#### Scenario: Se elimina el vehículo

- **WHEN** un vehículo del inventario es eliminado
- **THEN** su registro de adquisición se elimina junto con él

### Requirement: El costo de adquisición sólo es legible por admin o superior

El acceso de lectura a los datos de adquisición SHALL estar restringido, **a nivel de base de datos**, a miembros con rol `admin` o superior mediante `is_account_member(account_id, 'admin')`. La escritura SHALL exigir el mismo rol.

Ocultar el dato únicamente en la interfaz NO SHALL considerarse suficiente: un miembro con rol `agent` o `viewer` no debe poder obtener el costo por ninguna vía de la API.

#### Scenario: Un vendedor consulta el inventario

- **WHEN** un miembro con rol `agent` o `viewer` consulta los vehículos por la API
- **THEN** la respuesta no incluye ningún dato de adquisición, ni siquiera indicando que existe

#### Scenario: Un vendedor intenta leer la tabla directamente

- **WHEN** un miembro con rol `agent` o `viewer` consulta la tabla de adquisiciones directamente
- **THEN** la política de seguridad devuelve un conjunto vacío, sin filtrar la existencia de registros de otras cuentas

#### Scenario: Un vendedor intenta registrar un costo

- **WHEN** un miembro con rol `agent` intenta crear o modificar un registro de adquisición
- **THEN** la operación es rechazada por la política de escritura

#### Scenario: El dueño consulta el inventario

- **WHEN** un miembro con rol `admin` o `owner` consulta los vehículos
- **THEN** la respuesta incluye el costo de adquisición de los vehículos que lo tengan registrado

### Requirement: El costo de adquisición no se expone al bot ni a la vitrina

Los datos de adquisición SHALL quedar fuera de todo contenido de cara al público o al asistente automático: no SHALL incluirse en los documentos del knowledge base que alimentan al bot RAG, ni en las respuestas de la vitrina pública.

#### Scenario: Se sincroniza un vehículo con el knowledge base

- **WHEN** un vehículo con costo de adquisición registrado se sincroniza al knowledge base
- **THEN** el documento generado no contiene el costo ni la fecha de adquisición

#### Scenario: Un visitante consulta la vitrina pública

- **WHEN** un visitante anónimo carga la vitrina o la ficha de un vehículo
- **THEN** la respuesta no contiene datos de adquisición
