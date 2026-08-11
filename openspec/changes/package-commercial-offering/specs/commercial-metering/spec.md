## ADDED Requirements

### Requirement: Se mide por cuenta lo que se factura

El sistema SHALL registrar por cuenta y por periodo las magnitudes que sostienen la facturación: usuarios activos, vehículos en inventario, mensajes enviados y consumo de IA.

El consumo de IA ya se registra en `ai_usage_log`; el resto SHALL medirse con el mismo criterio de cuenta y periodo para que puedan leerse juntos.

#### Scenario: Cierre de un periodo

- **WHEN** termina un periodo de facturación
- **THEN** puede obtenerse, por cuenta, cuánto se consumió de cada magnitud en ese periodo

#### Scenario: Cuenta sin actividad

- **WHEN** una cuenta no tuvo movimiento en el periodo
- **THEN** su consumo se reporta en cero, y no como ausencia de datos

### Requirement: El cliente ve su consumo antes de recibir la factura

Los miembros con rol `admin` o superior SHALL poder consultar, dentro de la aplicación, el consumo de su cuenta en el periodo en curso frente a los topes de su plan.

Una factura nunca debería ser la primera noticia de cuánto se usó.

#### Scenario: Consulta del consumo propio

- **WHEN** un miembro con rol `admin` o superior abre la vista de plan y consumo
- **THEN** ve cuánto lleva usado de cada tope en el periodo en curso

#### Scenario: Consumo cerca del tope

- **WHEN** una cuenta se aproxima a alguno de sus topes
- **THEN** se le advierte antes de alcanzarlo, no al momento del rechazo

#### Scenario: Un asesor consulta la aplicación

- **WHEN** un miembro con rol `agent` o `viewer` navega la aplicación
- **THEN** no ve información de plan, consumo ni facturación

### Requirement: La medición no interrumpe la operación

El registro de consumo SHALL ser best-effort: un fallo al medir SHALL quedar registrado como advertencia y NO SHALL impedir la operación que se estaba midiendo.

#### Scenario: Falla el registro de consumo

- **WHEN** ocurre un error al registrar una unidad de consumo
- **THEN** la acción del usuario se completa igual y el fallo queda en el registro
