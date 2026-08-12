## ADDED Requirements

### Requirement: El negocio conecta su cuenta de Instagram desde los ajustes

El sistema SHALL permitir vincular una cuenta de Instagram por cuenta del CRM, y SHALL guardar sus credenciales cifradas, con el mismo tratamiento que reciben hoy las credenciales de WhatsApp.

Las credenciales NUNCA SHALL exponerse al cliente ni devolverse en ninguna respuesta de la API.

#### Scenario: Se conecta una cuenta válida

- **WHEN** un miembro con rol `admin` o superior conecta una cuenta de Instagram apta para publicación
- **THEN** la conexión queda registrada como activa y el sistema muestra a qué cuenta quedó vinculado

#### Scenario: Se intenta conectar una cuenta no apta

- **WHEN** la cuenta indicada no es una cuenta de Instagram habilitada para publicación
- **THEN** la conexión se rechaza explicando el requisito, en vez de guardarse y fallar después al publicar

#### Scenario: Un asesor abre los ajustes

- **WHEN** un miembro con rol `agent` o `viewer` accede a los ajustes
- **THEN** no puede conectar, desconectar ni ver las credenciales

#### Scenario: Se desconecta la cuenta

- **WHEN** un miembro con rol `admin` o superior desconecta la cuenta
- **THEN** las credenciales dejan de estar disponibles, las publicaciones ya hechas no se ven afectadas y las pendientes quedan a la espera de una cuenta conectada

### Requirement: Un fallo de credenciales se distingue de un fallo de contenido

Cuando Instagram rechace una operación por credenciales inválidas o expiradas, el sistema SHALL indicarlo como un problema de conexión y SHALL señalar que la cuenta necesita reconectarse.

Un token vencido y una foto inválida se arreglan de formas distintas; confundirlos manda al usuario a buscar en el lugar equivocado.

#### Scenario: El token expiró

- **WHEN** una publicación falla porque las credenciales ya no son válidas
- **THEN** el sistema lo reporta como problema de conexión e invita a reconectar la cuenta, sin culpar al contenido

#### Scenario: No hay cuenta conectada

- **WHEN** se intenta publicar sin una cuenta de Instagram conectada
- **THEN** la acción se impide indicando que primero hay que conectarla
