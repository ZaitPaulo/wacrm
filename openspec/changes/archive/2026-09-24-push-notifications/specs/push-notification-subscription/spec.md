## ADDED Requirements

### Requirement: Suscripciones por dispositivo
El sistema SHALL guardar una fila por dispositivo en `push_subscriptions` con usuario, cuenta, endpoint (único), claves `p256dh` y `auth`, user agent y fechas. Registrar un endpoint ya existente SHALL reasignarlo al usuario que lo registra. Un usuario SHALL poder ver y borrar solo sus propias suscripciones; `anon` NO SHALL tener ningún privilegio sobre la tabla.

#### Scenario: Registrar el dispositivo
- **WHEN** un asesor con sesión envía su suscripción a `POST /api/push/subscriptions`
- **THEN** existe una fila con su `user_id`, su `account_id` y ese endpoint

#### Scenario: Otro usuario en el mismo navegador
- **WHEN** el endpoint ya estaba registrado para otro usuario y un segundo usuario lo registra
- **THEN** la fila queda a nombre del segundo usuario y el primero deja de recibir avisos en ese navegador

#### Scenario: Aislamiento por RLS
- **WHEN** un usuario autenticado consulta `push_subscriptions`
- **THEN** solo ve sus filas, y como `anon` la consulta es rechazada

### Requirement: Clave pública en tiempo de ejecución
El navegador SHALL obtener la clave pública VAPID de `GET /api/push/config` en tiempo de ejecución, para que cambiarla no exija recompilar la imagen. Si el servidor no tiene VAPID configurado, la respuesta SHALL indicarlo y la interfaz SHALL mostrar que los avisos no están disponibles.

#### Scenario: Servidor sin VAPID
- **WHEN** faltan `VAPID_PUBLIC_KEY` o `VAPID_PRIVATE_KEY`
- **THEN** `GET /api/push/config` responde `{ enabled: false }`

### Requirement: Activación solo por gesto del usuario
La tarjeta "Avisos en este dispositivo" SHALL pedir el permiso de notificaciones únicamente al pulsar su botón de activar, nunca al cargar la página. SHALL mostrar uno de estos estados: no compatible; iPhone/iPad sin instalar en la pantalla de inicio (con los pasos para instalar); desactivado (con botón de activar); bloqueado por el navegador (con instrucciones para desbloquear); activado (con "Enviar aviso de prueba" y "Desactivar"); servidor sin configurar.

#### Scenario: iPhone en Safari sin instalar
- **WHEN** se abre la página desde Safari en un iPhone sin haber agregado el CRM a la pantalla de inicio
- **THEN** la tarjeta explica que en iPhone los avisos solo funcionan con el CRM agregado a la pantalla de inicio (iOS 16.4 o posterior) y cómo hacerlo, sin botón de activar

#### Scenario: Permiso bloqueado
- **WHEN** el permiso de notificaciones del sitio está en `denied`
- **THEN** la tarjeta muestra que el navegador bloqueó los avisos y cómo desbloquearlos desde el candado de la barra de direcciones o los ajustes del sitio

#### Scenario: Activar
- **WHEN** el asesor pulsa "Activar avisos" y concede el permiso
- **THEN** se registra el service worker, se crea la suscripción push, se guarda en el servidor y la tarjeta pasa a "Activados"

### Requirement: Aviso de prueba
"Enviar aviso de prueba" SHALL enviar un push solo al endpoint de este dispositivo, que SHALL pertenecer al usuario que lo pide, y el aviso SHALL mostrarse aunque la pestaña esté visible.

#### Scenario: Prueba desde el celular
- **WHEN** el asesor pulsa "Enviar aviso de prueba" con los avisos activados
- **THEN** su dispositivo muestra un aviso del sistema de prueba

#### Scenario: Endpoint ajeno
- **WHEN** se pide una prueba para un endpoint que no es del usuario
- **THEN** la respuesta es 404 y no se envía nada

### Requirement: Desactivar y cerrar sesión
Desactivar los avisos SHALL cancelar la suscripción del navegador y borrar su fila. Cerrar sesión SHALL hacer lo mismo con la suscripción de ese dispositivo antes de terminar la sesión, para que un navegador compartido no siga recibiendo mensajes de clientes del usuario anterior.

#### Scenario: Cerrar sesión
- **WHEN** el asesor cierra sesión en un dispositivo con avisos activos
- **THEN** la fila de ese endpoint desaparece de `push_subscriptions`

### Requirement: CRM instalable
Las pantallas del CRM y del login SHALL enlazar un manifest con nombre, `start_url` en la bandeja, `display: standalone` e iconos de 192 y 512 px (incluido uno `maskable`), y declarar los metadatos de aplicación web de Apple. La vitrina pública NO SHALL enlazar el manifest.

#### Scenario: Manifest solo en el CRM
- **WHEN** se carga `/inbox`
- **THEN** el HTML incluye `<link rel="manifest">` apuntando al manifest del CRM, y la portada pública no lo incluye
