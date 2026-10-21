## ADDED Requirements

### Requirement: Presupuesto de respuestas en horario laboral configurable

Cada cuenta SHALL tener en la configuración del bot un presupuesto de respuestas en horario laboral: encendido/apagado (apagado por defecto al migrar; se enciende para LoraMotors al desplegar) y un número N de respuestas (3 por defecto, entero entre 1 y 20). Solo owner y admin MUST poder cambiarlo. El horario laboral es el de `accounts.business_hours` con los festivos colombianos excluidos; una cuenta sin horario configurado nunca está "en horario" para esta regla.

#### Scenario: Valores por defecto

- **WHEN** se aplica la migración en una cuenta existente
- **THEN** el presupuesto queda apagado con N = 3

#### Scenario: N fuera de rango

- **WHEN** un admin guarda N = 0
- **THEN** la configuración se rechaza con un error de validación

#### Scenario: Un asesor intenta cambiarlo

- **WHEN** un usuario con rol de asesor intenta guardar el presupuesto
- **THEN** la solicitud se rechaza

### Requirement: Agotado el presupuesto en horario, el bot cierra hacia el traspaso

Con el presupuesto encendido, cuando el bot va a responder dentro del horario laboral y la conversación ya lleva N o más respuestas del bot (`ai_reply_count >= N`, contando todas las respuestas desde el último reinicio del contador), el sistema SHALL agregar al prompt, después del prefijo estable, una instrucción para que el bot deje de explorar opciones y se dedique a completar los datos que el traspaso exige para el motivo, uno a la vez, y a traspasar en cuanto los tenga, con el motivo que corresponda (`otro` si ninguno aplica).

El control de datos del traspaso MUST NOT relajarse: si faltan datos, el traspaso se rechaza como hoy y el bot sigue pidiéndolos. Las reglas vigentes del bot (perfil de crédito, regla de antigüedad para crédito, nombre una sola vez, enlaces de vehículos, traspaso urgente por `reclamo` o `pide_humano`) se aplican igual.

#### Scenario: Tercera respuesta con datos completos

- **WHEN** un martes a las 10:00 el bot ya respondió 3 veces y el cliente tiene nombre, presupuesto, interés y crédito declarados
- **THEN** la respuesta lleva el marcador de traspaso y la conversación pasa al asesor

#### Scenario: Presupuesto agotado con datos incompletos

- **WHEN** en horario el bot ya respondió 3 veces y el cliente no ha dado su presupuesto
- **THEN** el bot pide el presupuesto
- **AND** no traspasa hasta tenerlo, igual que hoy

#### Scenario: Fuera de horario

- **WHEN** la conversación lleva 8 respuestas del bot y el cliente escribe a las 21:00
- **THEN** el bot atiende normalmente, sin la instrucción de cierre

#### Scenario: Conversación que empezó de noche

- **WHEN** una conversación con 5 respuestas nocturnas recibe un mensaje a las 9:00 de un día hábil
- **THEN** el bot recibe la instrucción de cierre desde esa respuesta

#### Scenario: Cliente molesto antes del tope

- **WHEN** en horario el cliente se queja en el primer mensaje
- **THEN** el bot traspasa con `motivo=reclamo` como hoy, sin esperar al tope

#### Scenario: Presupuesto apagado

- **WHEN** el presupuesto está apagado
- **THEN** el prompt no lleva la instrucción de cierre en ningún horario

### Requirement: La instrucción de cierre no rompe el caché

La instrucción de cierre SHALL ir en la parte variable del prompt, después del prefijo estable definido en `ai-token-economy`, para que encenderla no cambie el prefijo que Gemini puede cachear.

#### Scenario: Dos llamadas, con y sin cierre

- **WHEN** se arman el prompt de una conversación con el presupuesto agotado y el de otra sin agotar, en la misma cuenta
- **THEN** ambos prompts comparten el mismo prefijo estable carácter por carácter
