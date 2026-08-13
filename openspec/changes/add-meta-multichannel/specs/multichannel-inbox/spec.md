## ADDED Requirements

### Requirement: Cada conversación declara el canal por el que existe

Toda conversación SHALL registrar el canal al que pertenece. SHALL haber una conversación por combinación de contacto y canal: los hilos de canales distintos no se mezclan.

Las conversaciones anteriores a este cambio SHALL quedar registradas como WhatsApp.

#### Scenario: Mensaje entrante de un canal nuevo para ese contacto

- **WHEN** un contacto que ya tiene conversación en un canal escribe por primera vez por otro
- **THEN** se abre una conversación distinta para el canal nuevo, y la anterior queda intacta

#### Scenario: Conversaciones anteriores al cambio

- **WHEN** se despliega el cambio sobre una instalación existente
- **THEN** todas las conversaciones existentes quedan como WhatsApp y siguen funcionando igual

### Requirement: Todo mensaje es atribuible a un canal

Cualquier mensaje, entrante o saliente, SHALL poder atribuirse al canal por el que ocurrió, de modo que el consumo pueda medirse por canal y no solo en total.

Este cambio NO SHALL definir topes ni precios: solo garantiza que el dato exista para quien los defina.

#### Scenario: Se mide el consumo de una cuenta

- **WHEN** se cuentan los mensajes de una cuenta en un periodo
- **THEN** el resultado puede desglosarse por canal

#### Scenario: Mensajes anteriores al cambio

- **WHEN** se cuentan mensajes anteriores a este cambio
- **THEN** aparecen atribuidos a WhatsApp, igual que sus conversaciones

### Requirement: La respuesta sale siempre por el canal de la conversación

El canal de salida SHALL leerse de la conversación. NUNCA SHALL inferirse del contenido, del contacto ni de un valor por defecto.

Esta regla aplica por igual a las respuestas de un asesor, de las automatizaciones, de los flujos y del asistente con IA.

#### Scenario: Un asesor responde desde la bandeja

- **WHEN** un asesor responde una conversación
- **THEN** el mensaje sale por el canal de esa conversación

#### Scenario: Una automatización responde

- **WHEN** una automatización, un flujo o el asistente con IA generan una respuesta
- **THEN** sale por el canal de la conversación que la originó

#### Scenario: Contacto con conversaciones en dos canales

- **WHEN** un contacto tiene hilos abiertos en dos canales y se responde en uno
- **THEN** el mensaje llega por ese canal y el otro hilo no se ve afectado

### Requirement: La bandeja muestra y permite filtrar por canal

La lista de conversaciones SHALL indicar visiblemente el canal de cada una y SHALL permitir filtrar por canal.

#### Scenario: Bandeja con varios canales

- **WHEN** un asesor abre la bandeja con conversaciones de distintos canales
- **THEN** distingue el canal de cada una sin abrirlas

#### Scenario: Filtro por canal

- **WHEN** un asesor filtra por un canal
- **THEN** ve únicamente las conversaciones de ese canal

#### Scenario: Instalación con un solo canal

- **WHEN** la cuenta solo opera WhatsApp
- **THEN** la bandeja no se llena de indicadores ni filtros que no aportan nada

### Requirement: El webhook reconoce el tipo de evento y no asume el canal

El punto de entrada de mensajes SHALL determinar a qué canal corresponde cada evento recibido antes de procesarlo, y SHALL derivarlo al manejador adecuado.

Un evento de un canal no soportado o de forma desconocida SHALL registrarse y descartarse **sin producir un error**, porque un fallo provoca reintentos en cadena desde el proveedor.

La dirección del webhook ya registrada SHALL seguir siendo válida, para no obligar a reconfigurar las instalaciones existentes.

#### Scenario: Evento de WhatsApp

- **WHEN** llega un evento de WhatsApp
- **THEN** se procesa exactamente como antes de este cambio

#### Scenario: Evento de otro canal soportado

- **WHEN** llega un evento de Instagram o Messenger
- **THEN** se procesa y produce contacto, conversación y mensaje del canal correspondiente

#### Scenario: Evento no reconocido

- **WHEN** llega un evento de un canal no soportado o con una forma desconocida
- **THEN** se registra y se descarta respondiendo con éxito, sin generar un error ni interrumpir el procesamiento del resto del lote

#### Scenario: Un lote con eventos mezclados

- **WHEN** un mismo envío contiene eventos de varios canales
- **THEN** cada uno se deriva a su manejador y el fallo de uno no impide procesar los demás
