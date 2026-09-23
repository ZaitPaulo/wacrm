## ADDED Requirements

### Requirement: Configuración del plazo de asignación automática

Cada cuenta SHALL poder configurar un plazo de X **horas** (entero de 1 a 720, o nulo = desactivado) en `stale_assign_after_hours`, validado en la API (`code = "stale_hours_invalid"`) y en la base. La base SHALL registrar el instante en que la regla se activa (`stale_assign_enabled_at`) y SHALL mantenerlo ella misma: se fija al pasar de nulo a un valor, se conserva al cambiar el valor, y se borra al desactivar. El cliente no puede escribirlo.

Al desplegar, cada cuenta existente SHALL quedar con la regla **activada a 3 horas**, con la marca de activación en el instante del despliegue.

#### Scenario: Activar la regla

- **WHEN** un admin fija X = 3 en una cuenta que la tenía desactivada
- **THEN** `stale_assign_enabled_at` queda en el instante de la activación

#### Scenario: Cambiar el plazo no reinicia la marca

- **WHEN** un admin cambia X de 3 a 5 horas
- **THEN** `stale_assign_enabled_at` no cambia

#### Scenario: Plazo fuera de rango

- **WHEN** un admin guarda X = 0 o X = 721
- **THEN** la API responde 400 con `code = "stale_hours_invalid"` y la base también lo rechaza

#### Scenario: Despliegue

- **WHEN** se aplica la migración 539 en producción
- **THEN** la cuenta queda con X = 3 horas y la marca de activación en ese instante

### Requirement: Asignar solo lo que quedó sin asesor después de activar

Un job periódico SHALL asignar con la asignación automática unificada (origen `stale_job`) cada conversación no cerrada sin asesor vigente que tenga **al menos un mensaje entrante del cliente** y cuyo `espera_desde` cumpla las dos condiciones:

- `espera_desde >= stale_assign_enabled_at`, y
- `ahora − espera_desde >= X horas`,

donde `espera_desde = max(sin_asesor_desde, primer entrante del cliente)` y `sin_asesor_desde` es el último cambio en `conversation_assignments`, o la creación de la conversación si nunca tuvo asesor.

Las conversaciones que ya estaban sin asesor al activar la regla NO SHALL asignarse nunca por este job; las asigna un admin a mano si quiere. Una que un admin suelte después de la activación sí entra.

Una conversación que solo tiene salientes (p. ej. creada por una difusión) no es un lead y NO SHALL asignarse. Cuando el cliente responde, entra con la cuenta normal de horas, contada desde su primer entrante y nunca desde antes de la activación.

#### Scenario: El rezago no se toca nunca

- **WHEN** una cuenta con 177 conversaciones sin asignar desde hace semanas activa X = 3
- **THEN** el job no asigna ninguna de ellas, ni al activar ni pasadas las 3 horas

#### Scenario: Lead nuevo olvidado

- **WHEN** una conversación creada después de la activación lleva más de 3 horas sin asesor
- **THEN** el job la asigna por continuidad o por porcentajes, y nace su negocio

#### Scenario: Lead nuevo reciente

- **WHEN** una conversación creada después de la activación lleva 1 hora sin asesor
- **THEN** el job no la asigna todavía

#### Scenario: Conversación soltada después de activar

- **WHEN** un admin deja sin asesor una conversación después de la activación y pasan 3 horas
- **THEN** el job la asigna

#### Scenario: Difusión sin respuesta

- **WHEN** una difusión creó hace 5 horas una conversación que solo tiene el saliente de la difusión
- **THEN** el job no la asigna ni crea negocio, pasen las horas que pasen

#### Scenario: Difusión respondida

- **WHEN** a una difusión enviada antes de activar la regla el cliente respondió hace 4 horas
- **THEN** el job la asigna: el reloj corre desde el primer entrante del cliente

#### Scenario: Difusión respondida hace poco

- **WHEN** a una difusión de hace 5 horas el cliente respondió hace 1 hora
- **THEN** el job todavía no la asigna

#### Scenario: Conversación cerrada

- **WHEN** una conversación sin asesor está cerrada
- **THEN** el job no la asigna

### Requirement: El job es idempotente y seguro ante ejecuciones concurrentes

El job SHALL poder correr varias veces y en paralelo sin asignar dos veces la misma conversación ni saltarse la cuota: SHALL tomar un candado de ejecución (si otra ejecución lo tiene, termina sin hacer nada), SHALL bloquear cada conversación antes de asignarla y SHALL volver a comprobar que sigue sin asesor. Cada ejecución SHALL procesar como máximo un lote acotado. El cron SHALL invocarlo cada 5 minutos.

La ruta del job SHALL autenticarse con el mismo secreto `x-cron-secret` que las demás rutas de cron.

#### Scenario: Dos ejecuciones simultáneas

- **WHEN** dos ejecuciones del job arrancan a la vez
- **THEN** una asigna y la otra devuelve `skipped: true` sin tocar nada

#### Scenario: Sin secreto

- **WHEN** se llama a la ruta del job sin el encabezado `x-cron-secret` correcto
- **THEN** responde 401 y no asigna nada
